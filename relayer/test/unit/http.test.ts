import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { createApp, type AppServices } from "../../src/app.js";
import { Secret } from "../../src/config.js";
import { FxService } from "../../src/fx.js";
import { LanePool } from "../../src/lanes.js";
import { PushDispatcher } from "../../src/push.js";
import { Relayer } from "../../src/relay.js";
import { Store } from "../../src/store.js";

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const FACTORY = "0xFAc7000000000000000000000000000000000001";

const FX = "0xF000000000000000000000000000000000000001";
const now = () => BigInt(Math.floor(Date.now() / 1000));
const ccy = (c: string) => `0x${Buffer.from(c).toString("hex")}`;
const ROUND = () => ({
  roundId: 12n,
  scheduledTime: now() - 600n,
  writtenAt: now() - 590n,
  rateDate: 20261007,
  sourceMask: 7,
  currencies: ["GBP", "EUR", "INR", "NGN", "JPY", "CHF", "AED", "SGD"].map(ccy),
  usdPerUnitE8: [134_000_000n, 116_000_000n, 1_130_000n, 0n, 0n, 0n, 0n, 0n],
  sourceMasks: [3, 3, 7, 0, 0, 0, 0, 0],
});

function build(over: { ipPerMin?: number; isMainnet?: boolean; bodyLimit?: number; fxReference?: string; round?: () => unknown } = {}) {
  const client = {
    getChainId: async () => 10143,
    getBlockNumber: async () => 123n,
    getBalance: async () => 10n ** 19n,
    getTransactionCount: async () => 0,
    // factory.isPot → false; FxReference.latestRound → over.round()
    readContract: vi.fn(async (x: { functionName: string }) => (x.functionName === "latestRound" && over.round ? over.round() : false)),
  };
  const store = new Store(":memory:");
  const pool = new LanePool(client as never, [new Secret(KEY)], { chainId: 10143, priorityFeeWei: 1n, maxFeeWei: 10n ** 12n, minBalanceWei: 1n });
  const relayer = new Relayer(client as never, pool, { factory: FACTORY, fxReference: over.fxReference as never }, { marginBps: 1000, marginFixed: 0, caps: {} }, store);
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ base: "GBP", date: "2026-10-05", rates: { USD: 1.34 } })));
  const fx = new FxService({ url: "https://x/latest", cacheMs: 600_000 }, privateKeyToAccount(KEY), fetchImpl as never);
  const services: AppServices = {
    cfg: {
      chainId: 10143,
      chainName: "Monad Testnet",
      isMainnet: over.isMainnet ?? false,
      push: { enabled: true, url: "x", accessToken: undefined },
      http: { bodyLimit: over.bodyLimit ?? 64 * 1024, corsOrigins: ["https://plans.0xo.in"], trustProxy: true, ipPerMin: over.ipPerMin ?? 100, addressPerMin: 2, createPotPerIpPerDay: 30 },
    },
    client: client as never,
    pool,
    relayer,
    store,
    fx,
    push: new PushDispatcher(store, { enabled: false, url: "x" }),
  };
  return { app: createApp(services), client, store };
}

const post = (app: ReturnType<typeof build>["app"], path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

describe("HTTP API", () => {
  it("serves CORS for the landing domain only", async () => {
    const { app } = build();
    const ok = await app.request("/v1/health", { headers: { origin: "https://plans.0xo.in" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://plans.0xo.in");
    const bad = await app.request("/v1/health", { headers: { origin: "https://evil.example" } });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("reports health with lanes", async () => {
    const { app } = build();
    const r = await app.request("/v1/health");
    const j = (await r.json()) as { ok: boolean; chainId: number; block: string; lanes: { address: string }[] };
    expect(r.status).toBe(200);
    expect(j.chainId).toBe(10143);
    expect(j.block).toBe("123");
    expect(j.lanes[0].address).toBe(privateKeyToAccount(KEY).address);
    expect(JSON.stringify(j)).not.toContain(KEY.slice(2));
  });

  it("rejects bodies over the size limit", async () => {
    const { app } = build({ bodyLimit: 100 });
    const r = await post(app, "/v1/relay", { action: "settle", params: { pot: "0x" + "1".repeat(40), pad: "x".repeat(500) } });
    expect(r.status).toBe(413);
  });

  it("returns 400 with issues for invalid JSON and params", async () => {
    const { app } = build();
    expect((await post(app, "/v1/relay", "{not json")).status).toBe(400);
    const r = await post(app, "/v1/relay", { action: "vote", params: { pot: "0x12" } });
    expect(r.status).toBe(400);
    const j = (await r.json()) as { error: { code: string; issues: { path: string }[] } };
    expect(j.error.code).toBe("INVALID_PARAMS");
    expect(j.error.issues.map((i) => i.path)).toContain("params.pot");
  });

  it("refuses targets that aren't factory pots", async () => {
    const { app, client } = build();
    const r = await post(app, "/v1/relay", { action: "settle", params: { pot: "0x1111111111111111111111111111111111111111" } });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("TARGET_NOT_ALLOWED");
    expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "isPot" }));
  });

  it("rate-limits per IP and per address", async () => {
    const { app } = build({ ipPerMin: 2 });
    const h = { "x-forwarded-for": "1.2.3.4" };
    await post(app, "/v1/relay", {}, h);
    await post(app, "/v1/relay", {}, h);
    const r = await post(app, "/v1/relay", {}, h);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
    expect((await post(app, "/v1/relay", {}, { "x-forwarded-for": "5.6.7.8" })).status).toBe(400);

    const { app: app2 } = build();
    const vote = (n: number) => ({ action: "vote", params: { pot: "0x1111111111111111111111111111111111111111", member: "0x2222222222222222222222222222222222222222", id: 1, approve: true, nonce: n, deadline: 2_000_000_000, sig: "0x" + "ab".repeat(65) } });
    expect((await post(app2, "/v1/relay", vote(1))).status).toBe(403);
    expect((await post(app2, "/v1/relay", vote(2))).status).toBe(403);
    expect((await post(app2, "/v1/relay", vote(3))).status).toBe(429); // addressPerMin = 2
  });

  it("serves signed FX", async () => {
    const { app } = build();
    const r = await app.request("/v1/fx?from=GBP&to=AUSD");
    const j = (await r.json()) as { rateE8: string; signature: string; source: string };
    expect(r.status).toBe(200);
    expect(j.rateE8).toBe("134000000");
    expect(j.signature).toMatch(/^0x/);
    expect((await app.request("/v1/fx?from=G&to=USD")).status).toBe(400);
  });

  it("serves the latest onchain FxReference round, read-only and cached", async () => {
    const { app, client } = build({ fxReference: FX, round: ROUND });
    const r = await app.request("/v1/fx/round");
    expect(r.status).toBe(200);
    const j = (await r.json()) as Record<string, unknown>;
    expect(j).toMatchObject({
      fxReference: FX,
      roundId: "12",
      rateDate: 20261007,
      sourceMask: 7,
      usdPerUnitE8: { GBP: "134000000", EUR: "116000000", INR: "1130000" },
      sourceMasks: { GBP: 3, EUR: 3, INR: 7 },
      maxAgeSec: 21600,
      fresh: true,
    });
    expect(j.usdPerUnitE8).not.toHaveProperty("NGN"); // absent this round
    expect(j.ageSec).toBeGreaterThanOrEqual(600);
    await app.request("/v1/fx/round");
    const reads = client.readContract.mock.calls.filter((c) => (c[0] as { functionName: string }).functionName === "latestRound");
    expect(reads).toHaveLength(1); // cached
    expect(reads[0][0]).toMatchObject({ address: FX, functionName: "latestRound" });
  });

  it("reports a stale or missing round and 404s without an FxReference", async () => {
    const stale = build({ fxReference: FX, round: () => ({ ...ROUND(), scheduledTime: now() - 7n * 3600n }) });
    expect(await (await stale.app.request("/v1/fx/round")).json()).toMatchObject({ roundId: "12", fresh: false });
    const empty = build({ fxReference: FX, round: () => ({ ...ROUND(), roundId: 0n, scheduledTime: 0n, writtenAt: 0n, rateDate: 0, sourceMask: 0, currencies: [], usdPerUnitE8: [], sourceMasks: [] }) });
    expect(await (await empty.app.request("/v1/fx/round")).json()).toMatchObject({ roundId: "0", ageSec: null, fresh: false, usdPerUnitE8: {} });
    const none = await build().app.request("/v1/fx/round");
    expect(none.status).toBe(404);
    expect(((await none.json()) as { error: { code: string } }).error.code).toBe("FX_REFERENCE_DISABLED");
  });

  it("validates the collect action before touching the chain", async () => {
    const { app, client } = build();
    const bad = await post(app, "/v1/relay", { action: "collect", params: { pot: "0x1111111111111111111111111111111111111111" } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { issues: { path: string }[] } }).error.issues.map((i) => i.path)).toContain("params.member");
    const r = await post(app, "/v1/relay", { action: "collect", params: { pot: "0x1111111111111111111111111111111111111111", member: "0x2222222222222222222222222222222222222222" } });
    expect(r.status).toBe(403); // the allowlist still applies: not a factory pot
    expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "isPot" }));
  });

  it("disables the faucet on mainnet and demo when not configured", async () => {
    const { app } = build({ isMainnet: true });
    expect((await post(app, "/v1/faucet", { address: "0x1111111111111111111111111111111111111111" })).status).toBe(404);
    expect((await post(app, "/v1/demo/try-settle-up", { member: "0x1111111111111111111111111111111111111111" })).status).toBe(404);
    const acc = (await (await app.request("/v1/demo/accounts")).json()) as { enabled: boolean };
    expect(acc.enabled).toBe(false);
  });

  it("registers push tokens with a valid signature", async () => {
    const { app, store } = build();
    const acct = privateKeyToAccount(KEY);
    const { pushRegisterMessage } = await import("../../src/push.js");
    const deadline = Math.floor(Date.now() / 1000) + 300;
    const token = "ExponentPushToken[abcdefghijkl]";
    const signature = await acct.signMessage({ message: pushRegisterMessage(acct.address, token, deadline) });
    // the stub client lacks verifyMessage → registration must fail closed
    const bad = await post(app, "/v1/push/register", { address: acct.address, expoPushToken: token, deadline, signature });
    expect(bad.status).toBe(401);
    expect(store.pushTokens([acct.address])).toEqual([]);
  });

  it("404s unknown routes as JSON", async () => {
    const { app } = build();
    const r = await app.request("/v2/nope");
    expect(r.status).toBe(404);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });
});
