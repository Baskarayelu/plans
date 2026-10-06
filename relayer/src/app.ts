import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { PublicClient } from "viem";
import { z } from "zod";
import { prepareAction, ValidationError, zAddress, zBytes32 } from "./actions.js";
import type { Config } from "./config.js";
import type { DemoService } from "./demo/demo.js";
import { RelayError } from "./errors.js";
import type { Faucet } from "./faucet.js";
import { fxQuerySchema, type FxService } from "./fx.js";
import type { LanePool } from "./lanes.js";
import type { Listener } from "./listener.js";
import { log, shortErr } from "./log.js";
import type { LongStop } from "./longstop.js";
import { verifyPushRegistration, type PushDispatcher } from "./push.js";
import { RateLimiter } from "./ratelimit.js";
import type { Relayer } from "./relay.js";
import type { Store } from "./store.js";

export interface AppServices {
  cfg: Pick<Config, "http" | "chainId" | "chainName" | "isMainnet" | "push">;
  client: PublicClient;
  pool: LanePool;
  relayer: Relayer;
  store: Store;
  fx: FxService;
  push: PushDispatcher;
  listener?: Listener;
  faucet?: Faucet;
  demo?: DemoService;
  longStop?: LongStop;
  version?: string;
}

const hexBlob = (max: number) => z.string().regex(/^0x([0-9a-fA-F]{2})*$/).refine((v) => (v.length - 2) / 2 <= max);

const trySettleUpSchema = z.object({
  member: zAddress,
  meta: hexBlob(512).optional(),
  creatorKeyWrap: hexBlob(512).optional(),
  inviteKeyWrap: hexBlob(512).optional(),
  inviteSecret: zBytes32.optional(),
  memos: z.array(hexBlob(512)).max(3).optional(),
});

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
  let lastBalanceRefresh = 0;

  app.use(
    "*",
    cors({
      origin: s.cfg.http.corsOrigins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["content-type"],
      maxAge: 600,
    }),
  );
  app.use(
    "/v1/*",
    bodyLimit({
      maxSize: s.cfg.http.bodyLimit,
      onError: (c) => c.json({ error: { code: "BODY_TOO_LARGE", message: `Request body is larger than ${s.cfg.http.bodyLimit} bytes.` } }, 413),
    }),
  );
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
        push: { enabled: s.cfg.push.enabled, sent: s.push.sent, failed: s.push.failed, queued: s.push.pending },
        faucet: { enabled: !!s.faucet?.enabled },
        demo: { enabled: !!s.demo?.enabled },
        longStop: s.longStop ? { lastRunAt: s.longStop.lastRunAt, settled: s.longStop.settledCount } : null,
        time: Math.floor(Date.now() / 1000),
      },
      ok ? 200 : 503,
    );
  });

  app.post("/v1/relay", async (c) => {
    const body = await readJson(c);
    const prep = prepareAction(body);
    // createPot is the most expensive action anyone can trigger with throwaway keys: cap it per IP per day.
    if (prep.action === "createPot" && !s.store.takeDaily(`createPot:ip:${clientIp(c, s.cfg.http.trustProxy)}`, s.cfg.http.createPotPerIpPerDay)) {
      throw new RelayError(429, "RATE_LIMITED", "Too many new plans from this network today.");
    }
    if (prep.actor) {
      const r = addrLimiter.take(`addr:${prep.actor.toLowerCase()}`);
      if (!r.ok) {
        c.header("retry-after", String(Math.ceil(r.retryAfterMs / 1000)));
        throw new RelayError(429, "RATE_LIMITED", "Too many requests for this account. Please slow down.", { retryAfterMs: r.retryAfterMs });
      }
    }
    const result = await s.relayer.relayPrepared(prep);
    return c.json(result, 200);
  });

  app.get("/v1/fx", async (c) => {
    const q = fxQuerySchema.parse({ from: c.req.query("from"), to: c.req.query("to") });
    const quote = await s.fx.quote(q.from, q.to);
    c.header("cache-control", "public, max-age=60");
    return c.json(quote);
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
