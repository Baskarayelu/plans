import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { PublicClient } from "viem";
import { z } from "zod";
import { prepareAction, ValidationError, zAddress, zBytes32 } from "./actions.js";
import { normaliseHash, type BlobStore } from "./blobs.js";
import type { Config } from "./config.js";
import type { DemoService } from "./demo/demo.js";
import { RelayError } from "./errors.js";
import type { Faucet } from "./faucet.js";
import { fxQuerySchema, readLatestFxRound, type FxRoundView, type FxService } from "./fx.js";
import type { LanePool } from "./lanes.js";
import type { Listener } from "./listener.js";
import { log, shortErr } from "./log.js";
import type { LongStop } from "./longstop.js";
import { verifyPushRegistration, type PushDispatcher } from "./push.js";
import { RateLimiter } from "./ratelimit.js";
import type { Relayer } from "./relay.js";
import { normaliseSlotId, SLOT_TTL_MAX, SLOT_TTL_MIN, type SlotStore } from "./slots.js";
import type { Store } from "./store.js";
import { mountWebPushRoutes } from "./routes/webpush.js";
import type { WebPush } from "./webpush.js";

export interface AppServices {
  cfg: Pick<Config, "http" | "chainId" | "chainName" | "isMainnet" | "push"> & {
    blobs?: Config["blobs"];
    slots?: Config["slots"];
    indexerGraphqlUrl?: string | null;
  };
  client: PublicClient;
  pool: LanePool;
  relayer: Relayer;
  store: Store;
  fx: FxService;
  push: PushDispatcher;
  /** Browser (VAPID) push; absent or disabled when WEB_PUSH_VAPID_* aren't set. */
  webPush?: WebPush | null;
  listener?: Listener;
  faucet?: Faucet;
  demo?: DemoService;
  longStop?: LongStop;
  blobs?: BlobStore;
  /** Keyed slots for browser linking (lives next to the blobs; absent when blobs are disabled). */
  slots?: SlotStore;
  version?: string;
}

const hexBlob = (max: number) => z.string().regex(/^0x([0-9a-fA-F]{2})*$/).refine((v) => (v.length - 2) / 2 <= max);

const putSlotSchema = z.object({
  data: z.string().min(1),
  ttl: z.number().int().min(SLOT_TTL_MIN).max(SLOT_TTL_MAX).optional(),
  auth: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  ifRev: z.number().int().min(0).optional(),
});

const trySettleUpSchema = z.object({
  member: zAddress,
  meta: hexBlob(512).optional(),
  creatorKeyWrap: hexBlob(512).optional(),
  inviteKeyWrap: hexBlob(512).optional(),
  inviteSecret: zBytes32.optional(),
  memos: z.array(hexBlob(512)).max(3).optional(),
});

/** Strict base64url (standard base64 alphabet and padding tolerated). */
export function decodeBase64Url(data: string): Uint8Array {
  if (!/^[A-Za-z0-9_\-+/]*={0,2}$/.test(data)) throw new RelayError(400, "INVALID_BASE64", "data must be base64url.");
  return new Uint8Array(Buffer.from(data.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), "base64url"));
}

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
    const real = c.req.header("x-real-ip");
    if (real) return real.trim();
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new RelayError(400, "INVALID_JSON", "Request body must be JSON.");
  }
}

export function createApp(s: AppServices) {
  const app = new Hono();
  const ipLimiter = new RateLimiter(s.cfg.http.ipPerMin, 60_000);
  const addrLimiter = new RateLimiter(s.cfg.http.addressPerMin, 60_000);
  const blobPutLimiter = new RateLimiter(s.cfg.blobs?.putPerIpPerHour ?? 60, 3_600_000);
  const blobMax = s.cfg.blobs?.maxBytes ?? 2 * 1024 * 1024;
  const slotPutLimiter = new RateLimiter(s.cfg.slots?.putPerIpPerHour ?? 60, 3_600_000);
  let lastBalanceRefresh = 0;
  let fxRoundCache: { at: number; view: FxRoundView } | null = null;

  app.use(
    "*",
    cors({
      origin: s.cfg.http.corsOrigins,
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["content-type"],
      maxAge: 600,
    }),
  );
  const jsonLimit = bodyLimit({
    maxSize: s.cfg.http.bodyLimit,
    onError: (c) => c.json({ error: { code: "BODY_TOO_LARGE", message: `Request body is larger than ${s.cfg.http.bodyLimit} bytes.` } }, 413),
  });
  // JSON uploads carry base64url, ~4/3 the size of the bytes; the decoded size is checked again in BlobStore.put.
  const blobLimit = bodyLimit({
    maxSize: Math.ceil((blobMax * 4) / 3) + 4096,
    onError: (c) => c.json({ error: { code: "BLOB_TOO_LARGE", message: `Blobs are limited to ${blobMax} bytes.` } }, 413),
  });
  app.use("/v1/*", (c, next) => (c.req.path.startsWith("/v1/blobs/") ? blobLimit(c, next) : jsonLimit(c, next)));
  app.use("/v1/*", async (c, next) => {
    if (c.req.method === "POST") {
      const ip = clientIp(c, s.cfg.http.trustProxy);
      const r = ipLimiter.take(`ip:${ip}`);
      if (!r.ok) {
        c.header("retry-after", String(Math.ceil(r.retryAfterMs / 1000)));
        return c.json({ error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down.", retryAfterMs: r.retryAfterMs } }, 429);
      }
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof RelayError) return c.json({ error: err.toJSON() }, err.status as 400);
    if (err instanceof ValidationError) return c.json({ error: { code: "INVALID_PARAMS", message: err.message, issues: err.issues } }, 400);
    if (err instanceof z.ZodError) {
      const issues = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      return c.json({ error: { code: "INVALID_PARAMS", message: issues.map((i) => `${i.path}: ${i.message}`).join("; "), issues } }, 400);
    }
    log.error("unhandled error", { path: c.req.path, error: shortErr(err) });
    return c.json({ error: { code: "INTERNAL", message: "Something went wrong. Please try again." } }, 500);
  });

  app.get("/", (c) => c.json({ service: "plans-relayer", version: s.version ?? "0.1.0", docs: "/v1/health" }));

  /** Runtime endpoints for the app, so a new indexer URL needs no app rebuild. Public, no secrets. */
  app.get("/v1/config", (c) =>
    c.json(
      { chainId: s.cfg.chainId, graphqlUrl: s.cfg.indexerGraphqlUrl ?? null, webPushPublicKey: s.webPush?.enabled ? s.webPush.publicKey : null },
      200,
      { "Cache-Control": "public, max-age=60" },
    ),
  );

  app.get("/v1/health", async (c) => {
    let chainId: number | null = null;
    let block: string | null = null;
    let rpcOk = true;
    try {
      [chainId, block] = await Promise.all([s.client.getChainId(), s.client.getBlockNumber().then((b) => b.toString())]);
    } catch {
      rpcOk = false;
    }
    if (rpcOk && Date.now() - lastBalanceRefresh > 10_000) {
      lastBalanceRefresh = Date.now();
      await s.pool.refreshBalances();
    }
    const lanes = s.pool.status();
    const ok = rpcOk && chainId === s.cfg.chainId && lanes.some((l) => !l.lowBalance);
    return c.json(
      {
        ok,
        chainId,
        expectedChainId: s.cfg.chainId,
        chain: s.cfg.chainName,
        block,
        rpcOk,
        sendRawTransactionSync: s.pool.syncSupported,
        lanes,
        contracts: s.relayer.contracts,
        listener: s.listener?.status() ?? null,
        push: {
          enabled: s.cfg.push.enabled,
          sent: s.push.sent,
          failed: s.push.failed,
          queued: s.push.pending,
          web: s.webPush ? { enabled: s.webPush.enabled, subscriptions: s.webPush.store.count(), sent: s.webPush.sent, failed: s.webPush.failed, removed: s.webPush.removed } : null,
        },
        faucet: { enabled: !!s.faucet?.enabled },
        demo: { enabled: !!s.demo?.enabled },
        longStop: s.longStop ? { lastRunAt: s.longStop.lastRunAt, settled: s.longStop.settledCount } : null,
        blobs: s.blobs ? { usedBytes: s.blobs.usedBytes, slotBytes: s.slots?.usedBytes ?? 0, capBytes: s.blobs.opts.diskCapBytes } : null,
        time: Math.floor(Date.now() / 1000),
      },
      ok ? 200 : 503,
    );
  });

  app.post("/v1/relay", async (c) => {
    const body = await readJson(c);
    const prep = prepareAction(body);
    // createPot is the most expensive action anyone can trigger with throwaway keys: cap it per IP per day.
    const potQuotaKey = `createPot:ip:${clientIp(c, s.cfg.http.trustProxy)}`;
    if (prep.action === "createPot" && !s.store.takeDaily(potQuotaKey, s.cfg.http.createPotPerIpPerDay)) {
      throw new RelayError(429, "RATE_LIMITED", "Too many new plans from this network today.");
    }
    if (prep.actor) {
      const r = addrLimiter.take(`addr:${prep.actor.toLowerCase()}`);
      if (!r.ok) {
        c.header("retry-after", String(Math.ceil(r.retryAfterMs / 1000)));
        throw new RelayError(429, "RATE_LIMITED", "Too many requests for this account. Please slow down.", { retryAfterMs: r.retryAfterMs });
      }
    }
    let result;
    try {
      result = await s.relayer.relayPrepared(prep);
    } catch (err) {
      // A createPot that never reached the chain (bad signature, rule check) gives its daily slot back.
      if (prep.action === "createPot" && err instanceof RelayError && err.status < 500) s.store.refundDaily(potQuotaKey);
      throw err;
    }
    return c.json(result, 200);
  });

  app.get("/v1/fx", async (c) => {
    const q = fxQuerySchema.parse({ from: c.req.query("from"), to: c.req.query("to") });
    const quote = await s.fx.quote(q.from, q.to);
    c.header("cache-control", "public, max-age=60");
    return c.json(quote);
  });

  /** The latest onchain FxReference round (Chainlink CRE). Read-only; cached for 15 s. */
  app.get("/v1/fx/round", async (c) => {
    const fx = s.relayer.contracts.fxReference;
    if (!fx) throw new RelayError(404, "FX_REFERENCE_DISABLED", "No FxReference contract is configured on this relayer.");
    if (!fxRoundCache || Date.now() - fxRoundCache.at > 15_000 || fxRoundCache.view.fxReference !== fx) {
      try {
        fxRoundCache = { at: Date.now(), view: await readLatestFxRound(s.client, fx) };
      } catch (e) {
        throw new RelayError(503, "RPC_UNAVAILABLE", "Couldn't read the reference rate from the network. Please try again.", { detail: shortErr(e) });
      }
    }
    // Age is recomputed per request so a cached read never looks fresher than it is.
    const v = fxRoundCache.view;
    const ageSec = v.roundId === "0" ? null : Math.max(0, Math.floor(Date.now() / 1000) - v.scheduledTime);
    c.header("cache-control", "public, max-age=15");
    return c.json({ ...v, ageSec, fresh: ageSec !== null && ageSec <= v.maxAgeSec });
  });

  app.post("/v1/faucet", async (c) => {
    if (s.cfg.isMainnet || !s.faucet?.enabled) throw new RelayError(404, "FAUCET_DISABLED", "The faucet is only available on testnet.");
    const { address } = z.object({ address: zAddress }).parse(await readJson(c));
    const ip = clientIp(c, s.cfg.http.trustProxy);
    const r = await s.faucet.drip(address, ip);
    return c.json(r);
  });

  app.post("/v1/push/register", async (c) => {
    const p = await verifyPushRegistration(s.client, await readJson(c));
    s.store.addPushToken(p.address, p.expoPushToken);
    return c.json({ ok: true, address: p.address });
  });

  mountWebPushRoutes(app, s);

  app.get("/v1/tx/:hash", (c) => {
    const hash = c.req.param("hash");
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new RelayError(400, "INVALID_HASH", "Expected a 0x-prefixed 32-byte transaction hash.");
    const t = s.store.getTx(hash);
    if (!t) throw new RelayError(404, "NOT_FOUND", "This relayer didn't send that transaction.");
    return c.json({
      txHash: t.txHash,
      action: t.action,
      latencyMs: t.latencyMs,
      totalMs: t.totalMs,
      blockNumber: t.blockNumber,
      status: t.status,
      submittedAt: t.submittedAt,
    });
  });

  app.put("/v1/blobs/:sha256", async (c) => {
    if (!s.blobs) throw new RelayError(404, "BLOBS_DISABLED", "Blob storage isn't enabled on this relayer.");
    const hash = normaliseHash(c.req.param("sha256"));
    const ct = (c.req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (ct !== "application/octet-stream" && ct !== "application/json") {
      throw new RelayError(415, "UNSUPPORTED_MEDIA_TYPE", 'Upload the ciphertext as application/octet-stream, or as application/json {"data": "<base64url>"}.');
    }
    let bytes: Uint8Array;
    if (ct === "application/json") {
      const { data } = z.object({ data: z.string() }).parse(await readJson(c));
      bytes = decodeBase64Url(data);
    } else {
      bytes = new Uint8Array(await c.req.arrayBuffer());
    }
    // Re-uploads of an existing blob are still verified (in put) but don't count against the limit.
    if (!s.blobs.has(hash)) {
      const r = blobPutLimiter.take(`blob:${clientIp(c, s.cfg.http.trustProxy)}`);
      if (!r.ok) {
        c.header("retry-after", String(Math.ceil(r.retryAfterMs / 1000)));
        throw new RelayError(429, "RATE_LIMITED", "Too many uploads from this network. Please try again later.", { retryAfterMs: r.retryAfterMs });
      }
    }
    const out = await s.blobs.put(hash, bytes);
    return c.json(out, out.created ? 201 : 200);
  });

  app.get("/v1/blobs/:sha256", async (c) => {
    if (!s.blobs) throw new RelayError(404, "BLOBS_DISABLED", "Blob storage isn't enabled on this relayer.");
    const hash = normaliseHash(c.req.param("sha256"));
    const wantsJson = (c.req.header("accept") ?? "").toLowerCase().includes("application/json");
    // The JSON and raw representations differ, so the ETag does too.
    const etag = wantsJson ? `"${hash}.json"` : `"${hash}"`;
    const cacheHeaders = { etag, "cache-control": "public, max-age=31536000, immutable", vary: "Accept" };
    if (c.req.header("if-none-match") === etag) return c.body(null, 304, cacheHeaders);
    const bytes = await s.blobs.get(hash);
    if (!bytes) throw new RelayError(404, "NOT_FOUND", "No blob with that id.");
    if (wantsJson) return c.json({ data: Buffer.from(bytes).toString("base64url") }, 200, cacheHeaders);
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      vary: "Accept",
      "content-type": "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "cache-control": "public, max-age=31536000, immutable",
      etag,
      "x-content-type-options": "nosniff",
    });
  });

  /**
   * Keyed slots (browser linking, app/docs/crypto.md §9). PUT {data: base64url (≤ 8192 bytes),
   * ttl?: 60–600 s (omitted = permanent), auth?: 64 hex, ifRev?: int ≥ 0}. 201 created; 200
   * overwritten (same auth); 409 SLOT_TAKEN for an unexpired slot without matching auth; 409
   * SLOT_CONFLICT {currentRev} when ifRev is given and isn't the stored rev (0 = no slot).
   * Responses carry the new `rev`; GET returns {data, expiresAt, rev}.
   */
  app.put("/v1/slots/:id", async (c) => {
    if (!s.slots) throw new RelayError(404, "SLOTS_DISABLED", "Slot storage isn't enabled on this relayer.");
    const id = normaliseSlotId(c.req.param("id"));
    const body = putSlotSchema.parse(await readJson(c));
    const bytes = decodeBase64Url(body.data);
    const r = slotPutLimiter.take(`slot:${clientIp(c, s.cfg.http.trustProxy)}`);
    if (!r.ok) {
      c.header("retry-after", String(Math.ceil(r.retryAfterMs / 1000)));
      throw new RelayError(429, "RATE_LIMITED", "Too many uploads from this network. Please try again later.", { retryAfterMs: r.retryAfterMs });
    }
    const out = s.slots.put(id, bytes, { ttl: body.ttl, auth: body.auth, ifRev: body.ifRev });
    return c.json(out, out.created ? 201 : 200, { "cache-control": "no-store" });
  });

  app.get("/v1/slots/:id", (c) => {
    if (!s.slots) throw new RelayError(404, "SLOTS_DISABLED", "Slot storage isn't enabled on this relayer.");
    const id = normaliseSlotId(c.req.param("id"));
    const slot = s.slots.get(id);
    c.header("cache-control", "no-store");
    // ?absent=200: "not there yet" is a normal answer for this caller (e.g. a new account's device
    // list), so answer 200 {data: null, rev: 0} instead of a 404 the browser would log as an error.
    if (!slot) {
      if (c.req.query("absent") === "200") return c.json({ data: null, expiresAt: null, rev: 0 });
      throw new RelayError(404, "NOT_FOUND", "No slot with that id.");
    }
    return c.json({ data: Buffer.from(slot.data).toString("base64url"), expiresAt: slot.expiresAt, rev: slot.rev });
  });

  app.get("/v1/demo/accounts", (c) => {
    if (!s.demo) return c.json({ enabled: false, accounts: [], pots: [] });
    return c.json(s.demo.publicAccounts());
  });

  app.post("/v1/demo/try-settle-up", async (c) => {
    if (!s.demo?.enabled) throw new RelayError(404, "DEMO_DISABLED", "Demo members aren't enabled on this relayer.");
    const body = trySettleUpSchema.parse(await readJson(c));
    const ip = clientIp(c, s.cfg.http.trustProxy);
    const r = await s.demo.trySettleUp(body.member, ip, {
      meta: body.meta as `0x${string}` | undefined,
      creatorKeyWrap: body.creatorKeyWrap as `0x${string}` | undefined,
      inviteKeyWrap: body.inviteKeyWrap as `0x${string}` | undefined,
      inviteSecret: body.inviteSecret,
      memos: body.memos as `0x${string}`[] | undefined,
    });
    return c.json(r);
  });

  app.get("/v1/demo/try-settle-up/:pot", (c) => {
    if (!s.demo?.enabled) throw new RelayError(404, "DEMO_DISABLED", "Demo members aren't enabled on this relayer.");
    const pot = zAddress.parse(c.req.param("pot"));
    const st = s.demo.runStatus(pot);
    if (!st) throw new RelayError(404, "NOT_FOUND", "No demo settle-up for that plan.");
    return c.json(st);
  });

  app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "No such endpoint." } }, 404));
  return app;
}
