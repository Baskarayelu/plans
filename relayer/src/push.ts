/**
 * Push: token registration (EIP-191 signed) and an Expo push dispatcher driven by chain events.
 * Notification text never includes memos (they are encrypted to the group) — only amounts and categories.
 */
import { getAddress, type Address, type Hex, type PublicClient } from "viem";
import { z } from "zod";
import { zAddress } from "./actions.js";
import { CATEGORIES, RelayError } from "./errors.js";
import type { ChainEvent } from "./listener.js";
import { log, shortErr } from "./log.js";
import type { Store } from "./store.js";

export const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_\-]{8,200}\]$/;

/** The exact message the app signs (EIP-191 personal_sign) to register a push token. */
export function pushRegisterMessage(address: Address, token: string, deadline: number | bigint) {
  return `Plans push notifications\nAddress: ${getAddress(address)}\nToken: ${token}\nDeadline: ${deadline.toString()}`;
}

export const pushRegisterSchema = z.object({
  address: zAddress,
  expoPushToken: z.string().regex(EXPO_TOKEN_RE, "must be an Expo push token"),
  deadline: z.number().int().positive(),
  signature: z.string().regex(/^0x([0-9a-fA-F]{2}){65,2048}$/, "must be a hex signature"),
});

export async function verifyPushRegistration(client: PublicClient, body: unknown, nowSec = Math.floor(Date.now() / 1000)) {
  const p = pushRegisterSchema.parse(body);
  if (p.deadline < nowSec) throw new RelayError(422, "EXPIRED", "This registration has expired. Please try again.");
  if (p.deadline > nowSec + 86_400) throw new RelayError(422, "DEADLINE_TOO_FAR", "Deadline must be within 24 hours.");
  const message = pushRegisterMessage(p.address, p.expoPushToken, p.deadline);
  let ok = false;
  try {
    // Handles EOAs and ERC-1271 smart accounts.
    ok = await client.verifyMessage({ address: p.address, message, signature: p.signature as Hex });
  } catch {
    ok = false;
  }
  if (!ok) throw new RelayError(401, "BAD_SIGNATURE", "The signature doesn't match this address.");
  return p;
}

export function formatUsd(amount: bigint): string {
  const neg = amount < 0n;
  const v = neg ? -amount : amount;
  const cents = (v + 5_000n) / 10_000n; // 6 decimals → cents, rounded
  const s = `$${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

export interface Notification {
  to: Address[];
  title: string;
  body: string;
  data: Record<string, string>;
}

const categoryName = (c: number) => CATEGORIES[c] ?? "Other";

/** Who gets told what, for one chain event. Pure apart from store reads. */
export function notificationsFor(ev: ChainEvent, store: Store, exclude: Set<string> = new Set()): Notification[] {
  const a = ev.args;
  const pot = ev.address;
  const data = { type: ev.name, pot, txHash: ev.txHash };
  const active = () => store.members(pot).map((m) => m.member);
  const without = (xs: Address[], ...drop: (Address | undefined)[]) => {
    const d = new Set(drop.filter(Boolean).map((x) => x!.toLowerCase()));
    return xs.filter((x) => !d.has(x.toLowerCase()) && !exclude.has(x.toLowerCase()));
  };
  switch (ev.name) {
    case "SpendProposed": {
      if (Number(a.approvalsRequired) <= 1) return [];
      return [
        {
          to: without(active(), a.proposer),
          title: "Approval needed",
          body: `A ${formatUsd(a.amount)} spend (${categoryName(Number(a.category))}) needs your approval.`,
          data: { ...data, id: String(a.id) },
        },
      ];
    }
    case "SpendExecuted": {
      const p = store.getProposal(pot, a.id);
      const what = p ? ` · ${categoryName(p.category)}` : "";
      return [
        {
          to: without(active(), p?.proposer),
          title: "Spend went through",
          body: `${formatUsd(a.amount)}${what}`,
          data: { ...data, id: String(a.id) },
        },
      ];
    }
    case "Contributed":
      return [{ to: without(active(), a.member), title: "Money added", body: `${formatUsd(a.amount)} was added to the pot.`, data }];
    case "Settled": {
      // unpaidClaims > 0: a payout was refused (e.g. a frozen account); that member can `collect` later.
      const unpaid = a.unpaidClaims !== undefined && BigInt(a.unpaidClaims) > 0n;
      const body = unpaid ? "The plan is settled. Some payouts are still owed and can be collected later." : "Everyone has been settled up.";
      return [{ to: without(store.members(pot, false).map((m) => m.member)), title: "Plan settled", body, data }];
    }
    // Pot.collect emits Payout then Collected for the same money: the Payout push covers it, so
    // Collected sends nothing (no double "You got paid").
    case "Payout":
      return [{ to: without([a.member]), title: "You got paid", body: `${formatUsd(a.amount)} from the plan is in your balance.`, data }];
    case "Sent":
      return [{ to: without([a.to], a.from), title: "Money received", body: `+${formatUsd(a.amount)}`, data: { type: "Sent", from: a.from, txHash: ev.txHash } }];
    case "Claimed": {
      const c = store.getClaim(a.id);
      if (!c) return [];
      let creator: Address | undefined = c.source;
      if (store.hasPot(c.source)) creator = store.getProposal(c.source, c.sourceSpendId)?.proposer;
      if (!creator) return [];
      return [
        {
          to: without([creator], a.recipient),
          title: "Your link was claimed",
          body: `${formatUsd(c.amount)} was claimed.`,
          data: { type: "Claimed", id: String(a.id), txHash: ev.txHash },
        },
      ];
    }
    default:
      return [];
  }
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: "default";
  priority: "high";
}

export class PushDispatcher {
  #queue: ExpoMessage[] = [];
  #timer: NodeJS.Timeout | null = null;
  sent = 0;
  failed = 0;

  constructor(
    readonly store: Store,
    readonly opts: { enabled: boolean; url: string; accessToken?: string },
    readonly exclude: Set<string> = new Set(),
    readonly fetchImpl: typeof fetch = fetch,
  ) {}

  handle = (ev: ChainEvent) => {
    if (!this.opts.enabled || !ev.live) return;
    for (const n of notificationsFor(ev, this.store, this.exclude)) {
      for (const { token } of this.store.pushTokens(n.to)) {
        this.#queue.push({ to: token, title: n.title, body: n.body, data: n.data, sound: "default", priority: "high" });
      }
    }
    if (this.#queue.length && !this.#timer) this.#timer = setTimeout(() => void this.flush(), 300);
  };

  get pending() {
    return this.#queue.length;
  }

  async flush() {
    this.#timer = null;
    while (this.#queue.length) {
      const batch = this.#queue.splice(0, 100);
      try {
        const res = await this.fetchImpl(this.opts.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            ...(this.opts.accessToken ? { authorization: `Bearer ${this.opts.accessToken}` } : {}),
          },
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`Expo push HTTP ${res.status}`);
        const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
        (json.data ?? []).forEach((t, i) => {
          if (t.status === "ok") this.sent++;
          else {
            this.failed++;
            if (t.details?.error === "DeviceNotRegistered") this.store.removePushToken(batch[i].to);
          }
        });
      } catch (e) {
        this.failed += batch.length;
        log.warn("push send failed", { error: shortErr(e), count: batch.length });
      }
    }
  }
}
