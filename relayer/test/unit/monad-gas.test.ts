/**
 * Every transaction the relayer signs must carry a gas limit derived from Monad's own
 * eth_estimateGas for that exact transaction (see src/gas.ts). These tests run the real Relayer,
 * LanePool and Faucet on a real viem client whose transport is a fake Monad JSON-RPC that logs
 * every eth_estimateGas (params and the random result it returned) and every raw transaction.
 */
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  defineChain,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { describe, expect, it } from "vitest";
import { ausdAbi, factoryAbi, faucetAbi } from "../../src/abi.js";
import { Secret } from "../../src/config.js";
import { RelayError } from "../../src/errors.js";
import { Faucet } from "../../src/faucet.js";
import { MonadGasEstimator, MonadGasLimit, type GasPolicy } from "../../src/gas.js";
import { LanePool } from "../../src/lanes.js";
import { Relayer } from "../../src/relay.js";
import { Store } from "../../src/store.js";

const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
].map((k) => new Secret(k as Hex));
const FACTORY = "0xfac7000000000000000000000000000000000001" as Address;
const AUSD = "0xa05d000000000000000000000000000000000002" as Address;
const FAUCET = "0xfa0c000000000000000000000000000000000003" as Address;
const POT = "0x9070000000000000000000000000000000000004" as Address;
const POLICY: GasPolicy = { marginBps: 1000, marginFixed: 10_000, caps: {} };

type Entry = { kind: "estimate"; tx: { from: Address; to: Address; data: Hex }; block: unknown; result: bigint } | { kind: "send"; raw: Hex };

/** A fake Monad node behind a real viem client. eth_estimateGas returns a fresh pseudo-random value per call. */
function fakeMonad(seed = 1) {
  const log: Entry[] = [];
  const selector = (fn: string) => keccak256(toHex(fn)).slice(0, 10);
  const request = async ({ method, params }: { method: string; params?: unknown[] }) => {
    const p = (params ?? []) as any[];
    switch (method) {
      case "eth_chainId":
        return "0x8f";
      case "eth_getTransactionCount":
        return "0x3";
      case "eth_getBalance":
        return toHex(10n ** 20n);
      case "eth_getBlockByNumber":
        return {
          number: "0x10", hash: "0x" + "22".repeat(32), parentHash: "0x" + "11".repeat(32), timestamp: "0x6700", baseFeePerGas: toHex(100_000_000_000n),
          gasLimit: "0x1c9c380", gasUsed: "0x0", transactions: [], logsBloom: "0x" + "00".repeat(256), miner: "0x" + "00".repeat(20), extraData: "0x",
          difficulty: "0x0", nonce: "0x0000000000000000", sha3Uncles: "0x" + "00".repeat(32), size: "0x0", stateRoot: "0x" + "00".repeat(32), receiptsRoot: "0x" + "00".repeat(32), transactionsRoot: "0x" + "00".repeat(32), uncles: [],
        };
      case "eth_call": {
        const data = p[0].data as Hex;
        if (data.startsWith(selector("isPot(address)"))) return encodeAbiParameters([{ type: "bool" }], [true]);
        if (data.startsWith(selector("balanceOf(address)"))) return encodeAbiParameters([{ type: "uint256" }], [10n ** 12n]);
        return "0x";
      }
      case "eth_estimateGas": {
        seed = (seed * 1103515245 + 12345) % 2 ** 31;
        const result = BigInt(40_000 + (seed % 100_000));
        log.push({ kind: "estimate", tx: p[0], block: p[1], result });
        return toHex(result);
      }
      case "eth_sendRawTransactionSync": {
        const raw = p[0] as Hex;
        log.push({ kind: "send", raw });
        const tx = parseTransaction(raw);
        return {
          transactionHash: keccak256(raw), blockHash: "0x" + "33".repeat(32), blockNumber: "0x11", transactionIndex: "0x0", from: "0x" + "00".repeat(20),
          to: tx.to, gasUsed: toHex((tx.gas! * 8n) / 10n), cumulativeGasUsed: "0x1", effectiveGasPrice: toHex(102_000_000_000n), status: "0x1",
          logs: [], logsBloom: "0x" + "00".repeat(256), type: "0x2", contractAddress: null,
        };
      }
      default:
        throw new Error(`fake Monad RPC: unexpected ${method}`);
    }
  };
  const chain = defineChain({ id: 143, name: "Monad", nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["http://fake"] } } });
  const client = createPublicClient({ chain, transport: custom({ request }) }) as PublicClient;
  return { client, log };
}

async function build(policy: GasPolicy = POLICY) {
  const m = fakeMonad();
  const pool = new LanePool(m.client, KEYS, { chainId: 143, priorityFeeWei: 2_000_000_000n, maxFeeWei: 10n ** 12n, minBalanceWei: 1n });
  await pool.init();
  const relayer = new Relayer(m.client, pool, { factory: FACTORY, ausd: AUSD }, policy);
  return { ...m, pool, relayer };
}

/** Independent of src/gas.ts: what the limit must be for a Monad estimate under POLICY. */
const expected = (estimate: bigint, p: GasPolicy = POLICY) => (estimate * BigInt(10_000 + p.marginBps) + 9_999n) / 10_000n + BigInt(p.marginFixed);

/**
 * Asserts that in `entries` (one request) there is exactly one send, exactly one Monad estimate,
 * and the sent gas equals the margin applied to that estimate, which was made for the same
 * sender, target and calldata. Returns the decoded tx.
 */
async function assertEstimatedSend(entries: Entry[]) {
  const sends = entries.filter((e): e is Extract<Entry, { kind: "send" }> => e.kind === "send");
  const estimates = entries.filter((e): e is Extract<Entry, { kind: "estimate" }> => e.kind === "estimate");
  expect(sends).toHaveLength(1);
  expect(estimates).toHaveLength(1);
  const [{ raw }] = sends;
  const [est] = estimates;
  expect(entries.indexOf(est)).toBeLessThan(entries.indexOf(sends[0]));
  const tx = parseTransaction(raw);
  const from = await recoverTransactionAddress({ serializedTransaction: raw as never });
  expect(est.tx.from.toLowerCase()).toBe(from.toLowerCase());
  expect(est.tx.to.toLowerCase()).toBe(tx.to!.toLowerCase());
  expect(est.tx.data).toBe(tx.data);
  expect(est.block).toBe("latest");
  expect(tx.gas).toBe(expected(est.result));
  return { tx, est };
}

describe("every relayer transaction uses a Monad-estimated gas limit", () => {
  it("relayed actions (settle, execute), internal sends and faucet drips", async () => {
    const { log, relayer, pool, client } = await build();
    const cases: [string, () => Promise<{ gasLimit: string }>][] = [
      ["settle", () => relayer.relay({ action: "settle", params: { pot: POT } }, { source: "longstop" })],
      ["execute", () => relayer.relay({ action: "execute", params: { pot: POT, id: "3" } })],
      ["ausdTransfer", () => relayer.sendInternal("ausdTransfer", AUSD, encodeFunctionData({ abi: ausdAbi, functionName: "transfer", args: [POT, 5n] }))],
      ["faucetRequest", () => relayer.sendInternal("faucetRequest", FAUCET, encodeFunctionData({ abi: faucetAbi, functionName: "requestFunds", args: [POT] }), pool.lanes[1])],
      [
        "drip",
        () =>
          new Faucet({ enabled: true, isMainnet: false, address: FAUCET, ausd: AUSD, amount: 1_000_000n, perAddressPerDay: 5, perIpPerDay: 5 }, client, relayer, pool, new Store(":memory:")).drip(
            "0x00000000000000000000000000000000000000a1",
            "1.2.3.4",
          ),
      ],
    ];
    for (const [name, run] of cases) {
      const mark = log.length;
      const res = await run();
      const { tx } = await assertEstimatedSend(log.slice(mark));
      expect(res.gasLimit, name).toBe(tx.gas!.toString());
    }
    // the drip really was an AUSD transfer
    const last = parseTransaction((log.at(-1) as { raw: Hex }).raw);
    expect(decodeFunctionData({ abi: ausdAbi, data: last.data! }).functionName).toBe("transfer");
    expect(log.filter((e) => e.kind === "send")).toHaveLength(cases.length);
  });

  it("concurrent requests on several lanes each get their own estimate", async () => {
    const { log, relayer } = await build();
    await Promise.all(Array.from({ length: 6 }, (_, i) => relayer.relay({ action: "execute", params: { pot: POT, id: String(i) } })));
    const sends = log.filter((e) => e.kind === "send") as { raw: Hex }[];
    expect(sends).toHaveLength(6);
    for (const s of sends) {
      const tx = parseTransaction(s.raw);
      const from = await recoverTransactionAddress({ serializedTransaction: s.raw as never });
      const est = log.find((e) => e.kind === "estimate" && e.tx.data === tx.data && e.tx.from.toLowerCase() === from.toLowerCase()) as Extract<Entry, { kind: "estimate" }>;
      expect(est, "an estimate for this exact tx").toBeDefined();
      expect(tx.gas).toBe(expected(est.result));
    }
  });

  it("caps reject a too-expensive estimate and never become the limit", async () => {
    const { log, relayer } = await build({ ...POLICY, caps: { settle: 30_000 } }); // every fake estimate is >= 40,000
    await expect(relayer.relay({ action: "settle", params: { pot: POT } })).rejects.toMatchObject({ code: "GAS_CAP_EXCEEDED", status: 422 });
    expect(log.filter((e) => e.kind === "estimate")).toHaveLength(1);
    expect(log.filter((e) => e.kind === "send")).toHaveLength(0);
  });
});

describe("LanePool.submit refuses any gas limit that is not a Monad estimate for that tx", () => {
  const data = encodeFunctionData({ abi: factoryAbi, functionName: "isPot", args: [POT] });

  it("plain numbers, look-alikes and hand-made MonadGasLimits", async () => {
    const { log, pool } = await build();
    const lane = pool.lanes[0];
    // @ts-expect-error a bigint is not a MonadGasLimit (compile-time guard)
    await expect(pool.submit(lane, { to: POT, data, gas: 200_000n })).rejects.toThrow(/not produced by Monad's eth_estimateGas/);
    const lookalike = Object.create(MonadGasLimit.prototype) as MonadGasLimit;
    await expect(pool.submit(lane, { to: POT, data, gas: lookalike })).rejects.toThrow(/not produced by Monad's eth_estimateGas/);
    expect(() => new MonadGasLimit(Symbol("forged") as never, pool.client, "x", { from: lane.address, to: POT, data }, 1n, 1n)).toThrow(/only be created by MonadGasEstimator/);
    expect(log.filter((e) => e.kind === "send")).toHaveLength(0);
  });

  it("a genuine limit for a different tx, sender or RPC", async () => {
    const { log, pool } = await build();
    const [l0, l1] = pool.lanes;
    const est = new MonadGasEstimator(pool.client, POLICY);
    const gas = await est.limitFor("execute", { from: l0.address, to: POT, data });
    await expect(pool.submit(l0, { to: POT, data: (data + "00") as Hex, gas })).rejects.toThrow(/different transaction/);
    await expect(pool.submit(l0, { to: FACTORY, data, gas })).rejects.toThrow(/different transaction/);
    await expect(pool.submit(l0, { to: POT, data, gas, value: 1n })).rejects.toThrow(/different transaction/);
    await expect(pool.submit(l1, { to: POT, data, gas })).rejects.toThrow(/different transaction/);
    const other = fakeMonad(99);
    const foreign = await new MonadGasEstimator(other.client, POLICY).limitFor("execute", { from: l0.address, to: POT, data });
    await expect(pool.submit(l0, { to: POT, data, gas: foreign })).rejects.toThrow(/different RPC/);
    expect(log.filter((e) => e.kind === "send")).toHaveLength(0);
    // and the genuine one goes through, with exactly its gas
    await pool.submit(l0, { to: POT, data, gas });
    const sent = parseTransaction((log.at(-1) as { raw: Hex }).raw);
    expect(sent.gas).toBe(gas.value);
    expect(gas.value).toBe(expected(gas.estimate));
  });

  it("a RelayError from the cap is not mistaken for a revert", async () => {
    const { relayer, pool } = await build({ ...POLICY, caps: { execute: 1 } });
    const err = await relayer.simulate("execute", POT, data, pool.lanes[0].address).catch((e) => e);
    expect(err).toBeInstanceOf(RelayError);
    expect(err.code).toBe("GAS_CAP_EXCEEDED");
  });
});
