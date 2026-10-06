import { keccak256, parseTransaction, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { Secret } from "../../src/config.js";
import { LanePool } from "../../src/lanes.js";

const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
].map((k) => new Secret(k as Hex));

const rpcReceipt = (hash: Hex) => ({
  transactionHash: hash, blockHash: "0x" + "11".repeat(32), blockNumber: "0x10", transactionIndex: "0x0", from: "0x" + "00".repeat(20),
  to: "0x" + "00".repeat(20), gasUsed: "0x5208", cumulativeGasUsed: "0x5208", effectiveGasPrice: "0x174876e800", status: "0x1",
  logs: [], logsBloom: "0x" + "00".repeat(256), type: "0x2", contractAddress: null,
});

/** A scripted fake of the viem PublicClient surface LanePool uses. */
function fakeClient(script: { sync?: (raw: Hex, n: number) => unknown; chainNonce?: () => number }) {
  const sent: Hex[] = [];
  const syncCalls: Hex[] = [];
  let nonceQueries = 0;
  const client = {
    sent,
    syncCalls,
    get nonceQueries() {
      return nonceQueries;
    },
    async getTransactionCount() {
      nonceQueries++;
      return script.chainNonce?.() ?? 7;
    },
    async getBlock() {
      return { baseFeePerGas: 100_000_000_000n };
    },
    async getBalance() {
      return 10n ** 19n;
    },
    async request({ method, params }: { method: string; params: [Hex] }) {
      if (method === "eth_sendRawTransactionSync") {
        syncCalls.push(params[0]);
        return script.sync!(params[0], syncCalls.length);
      }
      if (method === "eth_sendRawTransaction") {
        sent.push(params[0]);
        return keccak256(params[0]);
      }
      throw new Error("unexpected " + method);
    },
    async waitForTransactionReceipt({ hash }: { hash: Hex }) {
      return { transactionHash: hash, status: "success", blockNumber: 16n, gasUsed: 21000n, effectiveGasPrice: 1n, logs: [] };
    },
  };
  return client;
}

const opts = { chainId: 143, priorityFeeWei: 2_000_000_000n, maxFeeWei: 10n ** 12n, minBalanceWei: 10n ** 17n };
const tx = { to: "0x000000000000000000000000000000000000dEaD" as const, data: "0x" as Hex, gas: 50_000n };

describe("lane pool", () => {
  it("sends with eth_sendRawTransactionSync, tight gas and incrementing nonces", async () => {
    const c = fakeClient({ sync: (raw) => rpcReceipt(keccak256(raw)) });
    const pool = new LanePool(c as never, KEYS.slice(0, 1), opts);
    await pool.init();
    const lane = pool.lanes[0];
    const r1 = await pool.submit(lane, tx);
    const r2 = await pool.submit(lane, tx);
    expect(r1.sync).toBe(true);
    expect(r1.receipt.status).toBe("success");
    const t1 = parseTransaction(c.syncCalls[0]);
    const t2 = parseTransaction(c.syncCalls[1]);
    expect([t1.nonce, t2.nonce]).toEqual([7, 8]);
    expect(t1.gas).toBe(50_000n);
    expect(t1.chainId).toBe(143);
    expect(t1.maxPriorityFeePerGas).toBe(2_000_000_000n);
    expect(lane.nonce).toBe(9);
  });

  it("resyncs the nonce and retries on 'nonce too low'", async () => {
    let chain = 7;
    const c = fakeClient({
      chainNonce: () => chain,
      sync: (raw, n) => {
        if (n === 1) {
          chain = 12; // someone else used this key
          throw Object.assign(new Error("nonce too low"), { code: -32000 });
        }
        return rpcReceipt(keccak256(raw));
      },
    });
    const pool = new LanePool(c as never, KEYS.slice(0, 1), opts);
    await pool.init();
    await pool.submit(pool.lanes[0], tx);
    expect(parseTransaction(c.syncCalls[1]).nonce).toBe(12);
    expect(pool.lanes[0].nonce).toBe(13);
  });

  it("falls back to eth_sendRawTransaction when the sync method is missing", async () => {
    const c = fakeClient({ sync: () => { throw Object.assign(new Error("the method eth_sendRawTransactionSync does not exist"), { code: -32601 }); } });
    const pool = new LanePool(c as never, KEYS.slice(0, 1), opts);
    await pool.init();
    const r = await pool.submit(pool.lanes[0], tx);
    expect(r.sync).toBe(false);
    expect(c.sent).toHaveLength(1);
    expect(pool.syncSupported).toBe(false);
    await pool.submit(pool.lanes[0], tx);
    expect(c.syncCalls).toHaveLength(1); // not retried once known unsupported
    expect(c.sent).toHaveLength(2);
  });

  it("waits for the receipt when the sync call times out (EIP-7966 error code 4)", async () => {
    const c = fakeClient({ sync: (raw) => { throw Object.assign(new Error("timeout"), { code: 4, data: keccak256(raw) }); } });
    const pool = new LanePool(c as never, KEYS.slice(0, 1), opts);
    await pool.init();
    const r = await pool.submit(pool.lanes[0], tx);
    expect(r.receipt.transactionHash).toBe(keccak256(c.syncCalls[0]));
    expect(pool.lanes[0].nonce).toBe(8);
  });

  it("serialises sends per lane and spreads load across lanes", async () => {
    const c = fakeClient({ sync: async (raw) => { await new Promise((r) => setTimeout(r, 20)); return rpcReceipt(keccak256(raw)); } });
    const pool = new LanePool(c as never, KEYS, opts);
    await pool.init();
    const picks = [pool.pick(), pool.pick()];
    expect(new Set(picks.map((l) => l.index)).size).toBe(2);
    const lane = pool.lanes[0];
    await Promise.all([pool.submit(lane, tx), pool.submit(lane, tx), pool.submit(lane, tx)]);
    const nonces = c.syncCalls.map((r) => parseTransaction(r).nonce);
    expect(nonces).toEqual([7, 8, 9]);
    // busy lane is not picked while the other is idle
    const p = pool.submit(lane, tx);
    expect(pool.pick().index).toBe(1);
    await p;
  });

  it("reports underfunded lanes and rejects duplicate keys", async () => {
    expect(() => new LanePool(fakeClient({}) as never, [KEYS[0], KEYS[0]], opts)).toThrow(/duplicate/);
    expect(() => new LanePool(fakeClient({}) as never, [], opts)).toThrow(/at least one/);
  });

  it("never exposes keys through JSON or inspection", () => {
    expect(JSON.stringify({ k: KEYS[0] })).toBe('{"k":"[redacted]"}');
    expect(String(KEYS[0])).toBe("[redacted]");
  });
});
