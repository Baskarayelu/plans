/**
 * Web push (VAPID, RFC 8030/8291/8292) for the web app at plans.0xo.in/app: subscriptions are
 * registered with the same EIP-191 proof as Expo tokens (push.ts) and stored next to them in
 * SQLite; PushDispatcher sends each Expo notification to the account's web subscriptions too.
 * Payloads carry only the Expo push's title and body plus an app route — never memos.
 */
import type { DatabaseSync } from "node:sqlite";
import { getAddress, type Address, type Hex, type PublicClient } from "viem";
import webpush from "web-push";
import { z } from "zod";
import { zAddress } from "./actions.js";
import type { Secret } from "./config.js";
import { RelayError } from "./errors.js";

export interface WebPushConfig {
  /** VAPID public key, base64url (65-byte uncompressed P-256 point). */
  publicKey: string;
  /** base64url 32-byte P-256 private key; never logged. */
  privateKey: Secret<string>;
  /** mailto: or https: contact for the push services (RFC 8292 "sub"). */
  subject: string;
}

export interface WebSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Push services we will POST to. The endpoint comes from the browser, so without this list a
 * signed-in caller could point the relayer at any URL (SSRF). Suffix match on the hostname.
 */
export const WEB_PUSH_HOSTS = [
  "fcm.googleapis.com", // Chrome, Edge on Android, Samsung Internet, Opera, Brave
  "android.googleapis.com",
  "push.services.mozilla.com", // Firefox (updates.push.services.mozilla.com)
  "push.apple.com", // Safari macOS / iOS Home Screen apps (web.push.apple.com)
  "notify.windows.com", // Edge desktop (wns2-*.notify.windows.com)
];

export function isAllowedEndpoint(endpoint: string, hosts: readonly string[] = WEB_PUSH_HOSTS): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const h = u.hostname.toLowerCase();
  return hosts.some((s) => h === s || h.endsWith(`.${s}`));
}

const b64urlBytes = (n: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+={0,2}$/, "must be base64url")
    .refine((v) => Buffer.from(v.replace(/=+$/, ""), "base64url").length === n, `must be ${n} bytes`);

export const webSubscriptionSchema = z.object({
  endpoint: z.string().max(1024).refine((e) => isAllowedEndpoint(e), "must be a browser push service URL"),
  keys: z.object({ p256dh: b64urlBytes(65), auth: b64urlBytes(16) }),
});

/** The exact message the app signs (EIP-191 personal_sign) to register a browser subscription. */
export function webPushRegisterMessage(address: Address, sub: WebSubscription, deadline: number | bigint) {
  return [
    "Plans web push notifications",
    `Address: ${getAddress(address)}`,
    `Endpoint: ${sub.endpoint}`,
    `Keys: ${sub.keys.p256dh} ${sub.keys.auth}`,
    `Deadline: ${deadline.toString()}`,
  ].join("\n");
}

export const webPushRegisterSchema = z.object({
  address: zAddress,
  subscription: webSubscriptionSchema,
  deadline: z.number().int().positive(),
  signature: z.string().regex(/^0x([0-9a-fA-F]{2}){65,2048}$/, "must be a hex signature"),
});

export const webPushUnregisterSchema = z.object({ endpoint: z.string().min(1).max(1024) });

/** Same rules as verifyPushRegistration (push.ts): fresh deadline, signature by the account (EOA or ERC-1271). */
export async function verifyWebPushRegistration(client: PublicClient, body: unknown, nowSec = Math.floor(Date.now() / 1000)) {
  const p = webPushRegisterSchema.parse(body);
  if (p.deadline < nowSec) throw new RelayError(422, "EXPIRED", "This registration has expired. Please try again.");
  if (p.deadline > nowSec + 86_400) throw new RelayError(422, "DEADLINE_TOO_FAR", "Deadline must be within 24 hours.");
  const message = webPushRegisterMessage(p.address, p.subscription, p.deadline);
  let ok = false;
  try {
    ok = await client.verifyMessage({ address: p.address, message, signature: p.signature as Hex });
  } catch {
    ok = false;
  }
  if (!ok) throw new RelayError(401, "BAD_SIGNATURE", "The signature doesn't match this address.");
  return p;
}

type Row = Record<string, unknown>;

/** Browser subscriptions, in the relayer's SQLite file (table web_push_subs). */
export class WebPushStore {
  constructor(readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS web_push_subs (
      endpoint TEXT PRIMARY KEY, address TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS web_push_by_address ON web_push_subs(address);`);
  }

  /** An endpoint belongs to one account at a time (the last one to register it); at most 5 per account. */
  add(address: Address, sub: WebSubscription, nowSec = Math.floor(Date.now() / 1000)) {
    const addr = getAddress(address);
    this.db
      .prepare(
        `INSERT INTO web_push_subs(endpoint, address, p256dh, auth, updated_at) VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET address = excluded.address, p256dh = excluded.p256dh, auth = excluded.auth, updated_at = excluded.updated_at`,
      )
      .run(sub.endpoint, addr, sub.keys.p256dh, sub.keys.auth, nowSec);
    this.db
      .prepare(
        "DELETE FROM web_push_subs WHERE address = ? AND endpoint NOT IN (SELECT endpoint FROM web_push_subs WHERE address = ? ORDER BY updated_at DESC, rowid DESC LIMIT 5)",
      )
      .run(addr, addr);
  }

  remove(endpoint: string): boolean {
    return Number(this.db.prepare("DELETE FROM web_push_subs WHERE endpoint = ?").run(endpoint).changes) > 0;
  }

  forAddresses(addresses: Address[]): (WebSubscription & { address: Address })[] {
    if (!addresses.length) return [];
    const q = `SELECT endpoint, address, p256dh, auth FROM web_push_subs WHERE address IN (${addresses.map(() => "?").join(",")})`;
    return (this.db.prepare(q).all(...addresses.map((a) => getAddress(a))) as Row[]).map((r) => ({
      address: getAddress(String(r.address)),
      endpoint: String(r.endpoint),
      keys: { p256dh: String(r.p256dh), auth: String(r.auth) },
    }));
  }

  count(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM web_push_subs").get() as Row).n);
  }
}

/**
 * The push message body, in the Declarative Web Push format (WebKit, Safari 18.4+ / iOS 18.4+):
 * those browsers show it without running any script; everywhere else the service worker
 * (app/public/sw.js) reads the same JSON and shows it. `tag` collapses repeats of one event.
 */
export interface WebPushPayload {
  web_push: 8030;
  notification: { title: string; body: string; navigate: string; lang: "en-US" };
  tag?: string;
}

export function webPushPayload(n: { title: string; body: string; data: Record<string, string> }, appOrigin: string): WebPushPayload {
  const navigate = new URL(webRouteFor(n.data), appOrigin).href;
  return { web_push: 8030, notification: { title: n.title, body: n.body, navigate, lang: "en-US" }, tag: `${n.data.type}:${n.data.txHash ?? ""}` };
}

/** Where a click on a notification goes, from the notification's data (push.ts notificationsFor). */
export function webRouteFor(data: Record<string, string>): string {
  const pot = data.pot && /^0x[0-9a-fA-F]{40}$/.test(data.pot) ? data.pot.toLowerCase() : undefined;
  const id = data.id && /^\d{1,78}$/.test(data.id) ? data.id : undefined;
  switch (data.type) {
    case "SpendProposed":
      return pot && id ? `/app/plan/${pot}/approve/${id}` : pot ? `/app/plan/${pot}` : "/app";
    case "SpendExecuted":
    case "Contributed":
    case "Settled":
    case "Payout":
      return pot ? `/app/plan/${pot}` : "/app";
    case "Sent":
    case "Claimed":
      return "/app/activity";
    default:
      return "/app";
  }
}

export type WebPushSendResult = { statusCode: number };
export type WebPushSend = (sub: WebSubscription, payload: string, opts: { TTL: number; urgency: "high" | "normal" }) => Promise<WebPushSendResult>;

/** The real sender (the `web-push` package): encrypts the payload (aes128gcm) and signs the VAPID JWT. */
export function webPushSender(cfg: WebPushConfig): WebPushSend {
  return async (sub, payload, opts) => {
    const r = await webpush.sendNotification(sub, payload, {
      vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey.reveal() },
      TTL: opts.TTL,
      urgency: opts.urgency,
      contentEncoding: "aes128gcm",
      timeout: 10_000,
    });
    return { statusCode: r.statusCode };
  };
}

/** Status code from a failed send (web-push throws WebPushError with statusCode on non-2xx). */
export function sendErrorStatus(e: unknown): number | undefined {
  const s = (e as { statusCode?: unknown } | null)?.statusCode;
  return typeof s === "number" ? s : undefined;
}

/** The web push half of the dispatcher: config, storage and the sender. */
export class WebPush {
  sent = 0;
  failed = 0;
  removed = 0;
  readonly store: WebPushStore;

  constructor(
    db: DatabaseSync,
    readonly cfg: WebPushConfig | null,
    readonly send: WebPushSend | null = cfg ? webPushSender(cfg) : null,
    /** Where the web app lives; notification clicks open <appOrigin>/app/…. */
    readonly appOrigin = "https://plans.0xo.in",
  ) {
    this.store = new WebPushStore(db);
  }

  get enabled() {
    return !!this.cfg && !!this.send;
  }
  get publicKey() {
    return this.cfg?.publicKey ?? null;
  }
}
