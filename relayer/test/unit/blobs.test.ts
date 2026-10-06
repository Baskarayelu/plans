import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { BlobStore } from "../../src/blobs.js";
import { Secret } from "../../src/config.js";
import { FxService } from "../../src/fx.js";
import { LanePool } from "../../src/lanes.js";
import { PushDispatcher } from "../../src/push.js";
import { Relayer } from "../../src/relay.js";
import { Store } from "../../src/store.js";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "plans-blobs-"));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

function build(blobs: { maxBytes?: number; diskCapBytes?: number; putPerIpPerHour?: number } = {}) {
  const dir = tmp();
  const store = new Store(":memory:");
  const client = { getBalance: async () => 1n };
  const pool = new LanePool(client as never, [new Secret(KEY)], { chainId: 1, priorityFeeWei: 1n, maxFeeWei: 1n, minBalanceWei: 0n });
  const cfgBlobs = { dir, maxBytes: blobs.maxBytes ?? 2 * 1024 * 1024, diskCapBytes: blobs.diskCapBytes ?? 10 * 1024 * 1024, putPerIpPerHour: blobs.putPerIpPerHour ?? 60 };
  const blobStore = new BlobStore(cfgBlobs);
  const app = createApp({
    cfg: {
      chainId: 1, chainName: "Monad Testnet", isMainnet: false, push: { enabled: false, url: "x", accessToken: undefined },
      http: { bodyLimit: 64 * 1024, corsOrigins: ["https://plans.0xo.in"], trustProxy: true, ipPerMin: 1000, addressPerMin: 1000, createPotPerIpPerDay: 1 },
      blobs: cfgBlobs,
    },
    client: client as never,
    pool,
    relayer: new Relayer(client as never, pool, {}, { marginBps: 0, marginFixed: 0, caps: {} }, store),
    store,
    fx: new FxService({ url: "x", cacheMs: 1 }, privateKeyToAccount(KEY)),
    push: new PushDispatcher(store, { enabled: false, url: "x" }),
    blobs: blobStore,
  });
  return { app, store, blobStore, dir };
}

const put = (app: ReturnType<typeof build>["app"], hash: string, body: Uint8Array, headers: Record<string, string> = {}) =>
  app.request(`/v1/blobs/${hash}`, { method: "PUT", body, headers: { "content-type": "application/octet-stream", "x-forwarded-for": "1.1.1.1", ...headers } });

describe("encrypted blob store", () => {
  it("stores content-addressed ciphertext in sharded dirs and serves it immutably", async () => {
    const { app, dir } = build();
    const bytes = new Uint8Array(randomBytes(300_000));
    const h = sha(bytes);
    const r = await put(app, h, bytes);
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ sha256: h, size: 300_000, created: true });
    expect(existsSync(join(dir, h.slice(0, 2), h.slice(2, 4), h))).toBe(true);

    const g = await app.request(`/v1/blobs/${h}`);
    expect(g.status).toBe(200);
    expect(g.headers.get("content-type")).toBe("application/octet-stream");
    expect(g.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(g.headers.get("etag")).toBe(`"${h}"`);
    expect(Buffer.from(await g.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);
    expect((await app.request(`/v1/blobs/${h}`, { headers: { "if-none-match": `"${h}"` } })).status).toBe(304);

    // re-upload is idempotent, but the body is still verified
    expect((await put(app, h, bytes)).status).toBe(200);
    expect((await put(app, h, new Uint8Array([1, 2, 3]))).status).toBe(400);
  });

  it("accepts JSON {data: base64url} uploads and serves JSON when Accept includes application/json", async () => {
    const { app } = build({ maxBytes: 2 * 1024 * 1024 });
    // a full 2 MB blob: its base64url JSON body (~2.8 MB) must fit the request limit
    const bytes = new Uint8Array(randomBytes(2 * 1024 * 1024));
    const h = sha(bytes);
    const body = JSON.stringify({ data: Buffer.from(bytes).toString("base64url") });
    const r = await app.request(`/v1/blobs/${h}`, { method: "PUT", body, headers: { "content-type": "application/json", "x-forwarded-for": "3.3.3.3" } });
    expect(r.status, await r.clone().text()).toBe(201);
    expect(await r.json()).toEqual({ sha256: h, size: bytes.byteLength, created: true });

    const j = await app.request(`/v1/blobs/${h}`, { headers: { accept: "application/json" } });
    expect(j.status).toBe(200);
    expect(j.headers.get("content-type")).toMatch(/application\/json/);
    expect(j.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(j.headers.get("vary")).toContain("Accept");
    const { data } = (await j.json()) as { data: string };
    expect(data).not.toMatch(/[+/=]/); // base64url, unpadded
    expect(Buffer.from(data, "base64url").equals(Buffer.from(bytes))).toBe(true);
    expect(j.headers.get("etag")).not.toBe(`"${h}"`); // distinct representation

    // the same blob as raw bytes when JSON isn't asked for
    const raw = await app.request(`/v1/blobs/${h}`, { headers: { accept: "*/*" } });
    expect(raw.headers.get("content-type")).toBe("application/octet-stream");
    expect((await raw.arrayBuffer()).byteLength).toBe(bytes.byteLength);
  });

  it("checks the sha256 and size over the decoded JSON bytes", async () => {
    const { app } = build({ maxBytes: 1000 });
    const req = (hash: string, data: string) =>
      app.request(`/v1/blobs/${hash}`, { method: "PUT", body: JSON.stringify({ data }), headers: { "content-type": "application/json" } });
    const bytes = new Uint8Array(randomBytes(500));
    const b64 = Buffer.from(bytes).toString("base64url");
    // hash of the base64 text is not accepted; hash of the decoded bytes is
    expect(((await (await req(sha(new TextEncoder().encode(b64)), b64)).json()) as { error: { code: string } }).error.code).toBe("HASH_MISMATCH");
    expect((await req(sha(bytes), b64)).status).toBe(201);
    // standard base64 with padding is tolerated
    const b2 = new Uint8Array(randomBytes(31));
    expect((await req(sha(b2), Buffer.from(b2).toString("base64"))).status).toBe(201);
    // 1001 decoded bytes is over the cap even though the JSON body is small
    const big = new Uint8Array(randomBytes(1001));
    expect((await req(sha(big), Buffer.from(big).toString("base64url"))).status).toBe(413);
    expect((await req(sha(bytes), "not base64!")).status).toBe(400);
    const missing = await app.request(`/v1/blobs/${sha(big)}`, { method: "PUT", body: "{}", headers: { "content-type": "application/json" } });
    expect(missing.status).toBe(400);
  });

  it("rejects digest mismatches, bad ids, wrong content types, empty and oversized bodies", async () => {
    const { app } = build({ maxBytes: 1000 });
    const bytes = new Uint8Array(randomBytes(100));
    const r = await put(app, sha(new Uint8Array([1])), bytes);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("HASH_MISMATCH");
    expect((await put(app, "abc", bytes)).status).toBe(400);
    expect((await put(app, sha(bytes), bytes, { "content-type": "image/jpeg" })).status).toBe(415);
    expect((await put(app, sha(bytes), bytes, { "content-type": "" })).status).toBe(415);
    expect((await put(app, sha(new Uint8Array()), new Uint8Array())).status).toBe(400);
    const big = new Uint8Array(randomBytes(1001));
    expect((await put(app, sha(big), big)).status).toBe(413);
    expect((await app.request(`/v1/blobs/${"0".repeat(64)}`)).status).toBe(404);
  });

  it("enforces the disk cap, counting existing files at startup", async () => {
    const { app, dir } = build({ diskCapBytes: 2500 });
    const a = new Uint8Array(randomBytes(1000));
    const b = new Uint8Array(randomBytes(1000));
    const c = new Uint8Array(randomBytes(1000));
    expect((await put(app, sha(a), a)).status).toBe(201);
    expect((await put(app, sha(b), b)).status).toBe(201);
    const full = await put(app, sha(c), c);
    expect(full.status).toBe(507);
    expect(((await full.json()) as { error: { code: string } }).error.code).toBe("STORAGE_FULL");
    expect(new BlobStore({ dir, maxBytes: 1, diskCapBytes: 1 }).usedBytes).toBe(2000);
  });

  it("rate-limits uploads per IP per hour", async () => {
    const { app } = build({ putPerIpPerHour: 2 });
    for (let i = 0; i < 2; i++) {
      const x = new Uint8Array(randomBytes(10));
      expect((await put(app, sha(x), x)).status).toBe(201);
    }
    const x = new Uint8Array(randomBytes(10));
    const r = await put(app, sha(x), x);
    expect(r.status).toBe(429);
    expect((await put(app, sha(x), x, { "x-forwarded-for": "2.2.2.2" })).status).toBe(201);
  });
});

describe("GET /v1/tx/:hash", () => {
  it("returns timing for transactions this relayer sent and 404 otherwise", async () => {
    const { app, store } = build();
    const hash = ("0x" + "ab".repeat(32)) as Hex;
    store.insertTx({ txHash: hash, action: "send", latencyMs: 412, totalMs: 598, blockNumber: "123", status: "success", submittedAt: 1_760_000_000_000, lane: 0, gasUsed: "90000", sync: true });
    const r = await app.request(`/v1/tx/${hash.toUpperCase().replace("0X", "0x")}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ txHash: hash, action: "send", latencyMs: 412, totalMs: 598, blockNumber: "123", status: "success", submittedAt: 1_760_000_000_000 });
    expect((await app.request(`/v1/tx/0x${"cd".repeat(32)}`)).status).toBe(404);
    expect((await app.request(`/v1/tx/0x1234`)).status).toBe(400);
  });
});
