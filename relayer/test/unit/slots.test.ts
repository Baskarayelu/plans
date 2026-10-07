import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { SlotStore } from "../../src/slots.js";
import { Store } from "../../src/store.js";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "plans-slots-"));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const hex32 = () => randomBytes(32).toString("hex");

function build(o: { putPerIpPerHour?: number; diskCapBytes?: number; withSlots?: boolean } = {}) {
  const dir = tmp();
  const clock = { ms: 1_800_000_000_000 };
  const store = new Store(":memory:");
  const client = { getBalance: async () => 1n };
  const pool = new LanePool(client as never, [new Secret(KEY)], { chainId: 1, priorityFeeWei: 1n, maxFeeWei: 1n, minBalanceWei: 0n });
  const cfgBlobs = { dir, maxBytes: 2 * 1024 * 1024, diskCapBytes: o.diskCapBytes ?? 10 * 1024 * 1024, putPerIpPerHour: 60 };
  const blobs = new BlobStore(cfgBlobs);
  const slots = new SlotStore({ dir: join(dir, "slots"), diskCapBytes: cfgBlobs.diskCapBytes, otherUsedBytes: () => blobs.usedBytes, now: () => clock.ms });
  const app = createApp({
    cfg: {
      chainId: 1, chainName: "Monad Testnet", isMainnet: false, push: { enabled: false, url: "x", accessToken: undefined },
      http: { bodyLimit: 64 * 1024, corsOrigins: ["https://plans.0xo.in"], trustProxy: true, ipPerMin: 1000, addressPerMin: 1000, createPotPerIpPerDay: 1 },
      blobs: cfgBlobs,
      slots: { putPerIpPerHour: o.putPerIpPerHour ?? 60 },
    },
    client: client as never,
    pool,
    relayer: new Relayer(client as never, pool, {}, { marginBps: 0, marginFixed: 0, caps: {} }, store),
    store,
    fx: new FxService({ url: "x", cacheMs: 1 }, privateKeyToAccount(KEY)),
    push: new PushDispatcher(store, { enabled: false, url: "x" }),
    blobs,
    ...(o.withSlots === false ? {} : { slots }),
  });
  return { app, slots, blobs, dir, clock };
}

type App = ReturnType<typeof build>["app"];
const put = (app: App, id: string, body: Record<string, unknown>, ip = "1.1.1.1") =>
  app.request(`/v1/slots/${id}`, { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": ip } });
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const code = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;

describe("keyed slots", () => {
  it("creates a slot and reads it back (no-store, sharded on disk)", async () => {
    const { app, dir, clock } = build();
    const id = hex32();
    const data = new Uint8Array(randomBytes(500));
    const r = await put(app, id, { data: b64(data), ttl: 600 });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ id, created: true, expiresAt: Math.floor(clock.ms / 1000) + 600, rev: 1 });
    expect(existsSync(join(dir, "slots", id.slice(0, 2), id))).toBe(true);

    const g = await app.request(`/v1/slots/${id}`);
    expect(g.status).toBe(200);
    expect(g.headers.get("cache-control")).toBe("no-store");
    const body = (await g.json()) as { data: string; expiresAt: number; rev: number };
    expect(body.rev).toBe(1);
    expect(Buffer.from(body.data, "base64url").equals(Buffer.from(data))).toBe(true);
    expect(body.expiresAt).toBe(Math.floor(clock.ms / 1000) + 600);

    const missing = await app.request(`/v1/slots/${hex32()}`);
    expect(missing.status).toBe(404);
    expect(await code(missing)).toBe("NOT_FOUND");
  });

  it("permanent slots have expiresAt null; ids are case-insensitive", async () => {
    const { app } = build();
    const id = hex32();
    expect((await put(app, id.toUpperCase(), { data: b64(new Uint8Array([1, 2, 3])), auth: hex32() })).status).toBe(201);
    const g = (await (await app.request(`/v1/slots/${id}`)).json()) as { expiresAt: number | null };
    expect(g.expiresAt).toBeNull();
  });

  it("expires after the ttl: reads 404 and the file is deleted lazily; the id can be reused", async () => {
    const { app, dir, clock, slots } = build();
    const id = hex32();
    expect((await put(app, id, { data: b64(new Uint8Array([7])), ttl: 60 })).status).toBe(201);
    clock.ms += 59_000;
    expect((await app.request(`/v1/slots/${id}`)).status).toBe(200);
    clock.ms += 1_000;
    expect((await app.request(`/v1/slots/${id}`)).status).toBe(404);
    expect(existsSync(join(dir, "slots", id.slice(0, 2), id))).toBe(false);
    expect(slots.usedBytes).toBe(0);
    // expired (or missing) → create again
    expect((await put(app, id, { data: b64(new Uint8Array([8])), ttl: 60 })).status).toBe(201);
    clock.ms += 61_000;
    expect((await put(app, id, { data: b64(new Uint8Array([9])), ttl: 60 })).status).toBe(201);
  });

  it("sweep deletes expired slots that nobody read", async () => {
    const { app, clock, slots } = build();
    const a = hex32();
    const b = hex32();
    await put(app, a, { data: b64(new Uint8Array([1])), ttl: 60 });
    await put(app, b, { data: b64(new Uint8Array([2])) });
    clock.ms += 120_000;
    expect(slots.sweep()).toBe(1);
    expect((await app.request(`/v1/slots/${b}`)).status).toBe(200);
  });

  it("is write-once without auth (409 SLOT_TAKEN), even with an auth on the second write", async () => {
    const { app } = build();
    const id = hex32();
    expect((await put(app, id, { data: b64(new Uint8Array([1])), ttl: 600 })).status).toBe(201);
    const again = await put(app, id, { data: b64(new Uint8Array([2])), ttl: 600 });
    expect(again.status).toBe(409);
    expect(await code(again)).toBe("SLOT_TAKEN");
    expect((await put(app, id, { data: b64(new Uint8Array([2])), auth: hex32() })).status).toBe(409);
    const g = (await (await app.request(`/v1/slots/${id}`)).json()) as { data: string };
    expect(Buffer.from(g.data, "base64url")[0]).toBe(1);
  });

  it("overwrites with the same auth (200) and refuses a wrong or missing auth (409)", async () => {
    const { app, slots } = build();
    const id = hex32();
    const auth = hex32();
    expect((await put(app, id, { data: b64(new Uint8Array(100)), auth })).status).toBe(201);
    const used = slots.usedBytes;
    const ok = await put(app, id, { data: b64(new Uint8Array(100).fill(5)), auth: auth.toUpperCase() });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { created: boolean }).created).toBe(false);
    expect(slots.usedBytes).toBe(used); // same size record replaced, not added
    const g = (await (await app.request(`/v1/slots/${id}`)).json()) as { data: string };
    expect(Buffer.from(g.data, "base64url")[0]).toBe(5);

    const wrong = await put(app, id, { data: b64(new Uint8Array([9])), auth: hex32() });
    expect(wrong.status).toBe(409);
    expect(await code(wrong)).toBe("SLOT_TAKEN");
    expect((await put(app, id, { data: b64(new Uint8Array([9])) })).status).toBe(409);
  });

  it("limits data to 8192 decoded bytes", async () => {
    const { app } = build();
    expect((await put(app, hex32(), { data: b64(new Uint8Array(8192)) })).status).toBe(201);
    const big = await put(app, hex32(), { data: b64(new Uint8Array(8193)) });
    expect(big.status).toBe(413);
    expect(await code(big)).toBe("SLOT_TOO_LARGE");
  });

  it("rejects bad ids, bad bodies, bad ttl and bad auth", async () => {
    const { app } = build();
    const d = b64(new Uint8Array([1]));
    for (const bad of ["abc", "g".repeat(64), "0x" + hex32(), hex32() + "00"]) {
      const r = await put(app, bad, { data: d });
      expect(r.status, bad).toBe(400);
      expect(await code(r)).toBe("INVALID_SLOT_ID");
      expect((await app.request(`/v1/slots/${bad}`)).status).toBe(400);
    }
    expect((await put(app, hex32(), { data: "" })).status).toBe(400);
    expect((await put(app, hex32(), { data: "not base64!" })).status).toBe(400);
    expect((await put(app, hex32(), {})).status).toBe(400);
    expect((await put(app, hex32(), { data: d, ttl: 59 })).status).toBe(400);
    expect((await put(app, hex32(), { data: d, ttl: 601 })).status).toBe(400);
    expect((await put(app, hex32(), { data: d, ttl: 60.5 })).status).toBe(400);
    expect((await put(app, hex32(), { data: d, auth: "12" })).status).toBe(400);
    const notJson = await app.request(`/v1/slots/${hex32()}`, { method: "PUT", body: "x", headers: { "content-type": "application/json" } });
    expect(notJson.status).toBe(400);
  });

  it("rate-limits PUTs per IP per hour", async () => {
    const { app } = build({ putPerIpPerHour: 2 });
    const d = b64(new Uint8Array([1]));
    expect((await put(app, hex32(), { data: d })).status).toBe(201);
    expect((await put(app, hex32(), { data: d })).status).toBe(201);
    const r = await put(app, hex32(), { data: d });
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
    expect((await put(app, hex32(), { data: d }, "2.2.2.2")).status).toBe(201);
  });

  it("shares the blob disk cap and is not counted as blobs at startup", async () => {
    const { app, dir, slots } = build({ diskCapBytes: 3000 });
    expect((await put(app, hex32(), { data: b64(new Uint8Array(1500)) })).status).toBe(201);
    const full = await put(app, hex32(), { data: b64(new Uint8Array(1500)) });
    expect(full.status).toBe(507);
    expect(await code(full)).toBe("STORAGE_FULL");
    expect(new BlobStore({ dir, maxBytes: 1, diskCapBytes: 1 }).usedBytes).toBe(0);
    expect(new SlotStore({ dir: join(dir, "slots"), diskCapBytes: 1 }).usedBytes).toBe(slots.usedBytes);
  });

  it("returns 404 SLOTS_DISABLED without a slot store", async () => {
    const { app } = build({ withSlots: false });
    const r = await put(app, hex32(), { data: b64(new Uint8Array([1])) });
    expect(r.status).toBe(404);
    expect(await code(r)).toBe("SLOTS_DISABLED");
    expect(await code(await app.request(`/v1/slots/${hex32()}`))).toBe("SLOTS_DISABLED");
  });

  it("stores only what it was given: the file holds sha256(auth), never auth", async () => {
    const { app, slots } = build();
    const id = hex32();
    const auth = hex32();
    await put(app, id, { data: b64(new Uint8Array([1])), auth });
    const raw = (await import("node:fs")).readFileSync(slots.pathFor(id), "utf8");
    expect(raw).not.toContain(auth);
    expect(raw).toContain(createHash("sha256").update(Buffer.from(auth, "hex")).digest("hex"));
  });

  describe("revisions (rev / ifRev compare-and-set)", () => {
    type Got = { data: string; expiresAt: number | null; rev: number };
    const get = async (app: App, id: string) => (await (await app.request(`/v1/slots/${id}`)).json()) as Got;
    const one = (n: number) => b64(new Uint8Array([n]));

    it("starts at 1 and adds 1 on every successful write; PUT returns the new rev", async () => {
      const { app } = build();
      const id = hex32();
      const auth = hex32();
      const r1 = await put(app, id, { data: one(1), auth });
      expect(((await r1.json()) as { rev: number }).rev).toBe(1);
      expect((await get(app, id)).rev).toBe(1);
      for (let i = 2; i <= 5; i++) {
        const r = await put(app, id, { data: one(i), auth });
        expect(r.status).toBe(200);
        expect(((await r.json()) as { rev: number }).rev).toBe(i);
      }
      expect(await get(app, id)).toMatchObject({ rev: 5, data: one(5) });
      // refused writes don't move rev
      expect((await put(app, id, { data: one(9), auth: hex32() })).status).toBe(409);
      expect((await get(app, id)).rev).toBe(5);
    });

    it("ifRev: matching rev writes; a stale rev is 409 SLOT_CONFLICT with currentRev and writes nothing", async () => {
      const { app, slots } = build();
      const id = hex32();
      const auth = hex32();
      expect((await put(app, id, { data: one(1), auth, ifRev: 0 })).status).toBe(201);
      const ok = await put(app, id, { data: one(2), auth, ifRev: 1 });
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { rev: number }).rev).toBe(2);
      const used = slots.usedBytes;
      const stale = await put(app, id, { data: one(3), auth, ifRev: 1 });
      expect(stale.status).toBe(409);
      const err = (await stale.json()) as { error: { code: string; currentRev: number } };
      expect(err.error.code).toBe("SLOT_CONFLICT");
      expect(err.error.currentRev).toBe(2);
      expect(await get(app, id)).toMatchObject({ rev: 2, data: one(2) });
      expect(slots.usedBytes).toBe(used);
      // ahead of the stored rev is a conflict too
      expect(await code(await put(app, id, { data: one(3), auth, ifRev: 7 }))).toBe("SLOT_CONFLICT");
      // without ifRev, a write still just overwrites (unchanged behaviour)
      expect((await put(app, id, { data: one(4), auth })).status).toBe(200);
      expect((await get(app, id)).rev).toBe(3);
    });

    it("ifRev on an absent slot: only 0 creates; anything else is SLOT_CONFLICT currentRev 0 and nothing is written", async () => {
      const { app, dir } = build();
      const id = hex32();
      const r = await put(app, id, { data: one(1), auth: hex32(), ifRev: 1 });
      expect(r.status).toBe(409);
      expect(((await r.json()) as { error: { code: string; currentRev: number } }).error).toMatchObject({ code: "SLOT_CONFLICT", currentRev: 0 });
      expect(existsSync(join(dir, "slots", id.slice(0, 2), id))).toBe(false);
      expect((await put(app, id, { data: one(1), auth: hex32(), ifRev: 0 })).status).toBe(201);
      // ifRev 0 on an existing slot conflicts (create-only)
      const id2 = hex32();
      const auth2 = hex32();
      await put(app, id2, { data: one(1), auth: auth2 });
      expect(await code(await put(app, id2, { data: one(2), auth: auth2, ifRev: 0 }))).toBe("SLOT_CONFLICT");
    });

    it("an expired slot counts as absent (rev 0) and a new one starts again at 1", async () => {
      const { app, clock } = build();
      const id = hex32();
      await put(app, id, { data: one(1), ttl: 60 });
      clock.ms += 61_000;
      expect(await code(await put(app, id, { data: one(2), ttl: 60, ifRev: 1 }))).toBe("SLOT_CONFLICT");
      const r = await put(app, id, { data: one(2), ttl: 60, ifRev: 0 });
      expect(r.status).toBe(201);
      expect(((await r.json()) as { rev: number }).rev).toBe(1);
    });

    it("auth rules are unchanged: a wrong auth is SLOT_TAKEN even with the right ifRev, and write-once stays write-once", async () => {
      const { app } = build();
      const id = hex32();
      const auth = hex32();
      await put(app, id, { data: one(1), auth });
      expect(await code(await put(app, id, { data: one(2), auth: hex32(), ifRev: 1 }))).toBe("SLOT_TAKEN");
      expect(await code(await put(app, id, { data: one(2), ifRev: 1 }))).toBe("SLOT_TAKEN");
      const once = hex32();
      await put(app, once, { data: one(1), ttl: 600 });
      expect(await code(await put(app, once, { data: one(2), ttl: 600, ifRev: 1 }))).toBe("SLOT_TAKEN");
      expect((await get(app, id)).rev).toBe(1);
    });

    it("reads a file written before revisions existed as rev 1, and the next write makes it 2", async () => {
      const { app, slots } = build();
      const id = hex32();
      const auth = hex32();
      const authHash = createHash("sha256").update(Buffer.from(auth, "hex")).digest("hex");
      mkdirSync(join(slots.opts.dir, id.slice(0, 2)), { recursive: true });
      writeFileSync(slots.pathFor(id), JSON.stringify({ v: 1, data: one(1), expiresAt: null, authHash }));
      expect((await get(app, id)).rev).toBe(1);
      expect(await code(await put(app, id, { data: one(2), auth, ifRev: 0 }))).toBe("SLOT_CONFLICT");
      const r = await put(app, id, { data: one(2), auth, ifRev: 1 });
      expect(r.status).toBe(200);
      expect(((await r.json()) as { rev: number }).rev).toBe(2);
      expect(JSON.parse(readFileSync(slots.pathFor(id), "utf8")).rev).toBe(2);
    });

    it("rejects a bad ifRev", async () => {
      const { app } = build();
      for (const ifRev of [-1, 1.5, "1", null]) expect((await put(app, hex32(), { data: one(1), ifRev })).status, String(ifRev)).toBe(400);
    });

    it("RACE: many concurrent PUTs with the same ifRev → exactly one wins, the rest get SLOT_CONFLICT", async () => {
      const { app, slots } = build({ putPerIpPerHour: 10_000 });
      const id = hex32();
      const auth = hex32();
      expect((await put(app, id, { data: one(0), auth })).status).toBe(201);
      for (let round = 1; round <= 5; round++) {
        const N = 40;
        const rs = await Promise.all(Array.from({ length: N }, (_, i) => put(app, id, { data: one(i + 1), auth, ifRev: round }, `10.0.${round}.${i}`)));
        const bodies = await Promise.all(rs.map(async (r) => ({ status: r.status, body: (await r.json()) as { rev?: number; error?: { code: string; currentRev: number } } })));
        const wins = bodies.filter((b) => b.status === 200);
        const lost = bodies.filter((b) => b.status === 409);
        expect(wins).toHaveLength(1);
        expect(lost).toHaveLength(N - 1);
        expect(wins[0].body.rev).toBe(round + 1);
        for (const l of lost) expect(l.body.error).toMatchObject({ code: "SLOT_CONFLICT", currentRev: round + 1 });
        // the stored data is the winner's
        const g = await get(app, id);
        expect(g.rev).toBe(round + 1);
        const winner = bodies.indexOf(wins[0]);
        expect(g.data).toBe(one(winner + 1));
      }
      // no temp files left behind, and the byte count matches the disk
      const shard = join(slots.opts.dir, id.slice(0, 2));
      expect(readdirSync(shard)).toEqual([id]);
      expect(new SlotStore({ dir: slots.opts.dir, diskCapBytes: 1e9 }).usedBytes).toBe(slots.usedBytes);
    });

    it("RACE: concurrent first writes with ifRev 0 → exactly one creates", async () => {
      const { app } = build({ putPerIpPerHour: 10_000 });
      const id = hex32();
      const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => put(app, id, { data: one(i), auth: hex32(), ifRev: 0 }, `10.9.0.${i}`)));
      const st = rs.map((r) => r.status);
      expect(st.filter((x) => x === 201)).toHaveLength(1);
      // losers: SLOT_TAKEN (different auth) — the auth rule runs first and is unchanged
      expect(st.filter((x) => x === 409)).toHaveLength(29);
    });
  });
});
