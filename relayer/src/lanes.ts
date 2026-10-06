/**
 * A pool of relayer hot keys, each with its own nonce lane.
 *
 * Monad's reserve-balance rule caps each sender's gas spend over 3 blocks, so load is spread
 * across several keys. Each lane serialises its own sends (nonce order is strict per sender and
 * there is no global mempool), and lanes run in parallel. Keys are never EIP-7702-delegated.
 */
import {
  formatTransactionReceipt,
  keccak256,
  type Address,
  type Hex,
  type PrivateKeyAccount,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Secret } from "./config.js";
import { RelayError } from "./errors.js";
import { assertMonadGas, feesFor, type MonadGasLimit } from "./gas.js";
import { log, shortErr } from "./log.js";

export interface LaneStatus {
  index: number;
  address: Address;
  nonce: number | null;
  queued: number;
  busy: boolean;
  balanceWei: string | null;
  lowBalance: boolean;
  sent: number;
  failed: number;
  lastTxHash: Hex | null;
  lastError: string | null;
}

export interface SubmitResult {
  receipt: TransactionReceipt;
  txHash: Hex;
  lane: number;
  latencyMs: number;
  sync: boolean;
}

class Mutex {
  #tail: Promise<void> = Promise.resolve();
  waiting = 0;
  locked = false;
  async run<T>(fn: () => Promise<T>): Promise<T> {
    this.waiting++;
    const prev = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((r) => (release = r));
    await prev;
    this.waiting--;
    this.locked = true;
    try {
      return await fn();
    } finally {
      this.locked = false;
      release();
    }
  }
}

export class Lane {
  readonly account: PrivateKeyAccount;
  nonce: number | null = null;
  balance: bigint | null = null;
  sent = 0;
  failed = 0;
  lastTxHash: Hex | null = null;
  lastError: string | null = null;
  readonly mutex = new Mutex();
  constructor(
    readonly index: number,
    key: Secret,
  ) {
    this.account = privateKeyToAccount(key.reveal());
  }
  get address() {
    return this.account.address;
  }
  get load() {
    return this.mutex.waiting + (this.mutex.locked ? 1 : 0);
  }
}

export interface LaneOptions {
  chainId: number;
  priorityFeeWei: bigint;
  maxFeeWei: bigint;
  minBalanceWei: bigint;
}

interface RpcErrorInfo {
  code?: number;
  message: string;
  data?: unknown;
}

function rpcErrorInfo(err: unknown): RpcErrorInfo {
  let code: number | undefined;
  let data: unknown;
  const msgs: string[] = [];
  let e: unknown = err;
  for (let i = 0; i < 10 && e && typeof e === "object"; i++) {
    const o = e as Record<string, unknown>;
    if (code === undefined && typeof o.code === "number") code = o.code;
    if (data === undefined && o.data !== undefined) data = o.data;
    for (const k of ["details", "shortMessage", "message"]) if (typeof o[k] === "string") msgs.push(o[k] as string);
    e = o.cause ?? o.error;
  }
  return { code, data, message: msgs.join(" | ") };
}

const isNonceTooLow = (m: string) => /nonce too low|nonce is too low|already been used|nonce.*(lower|less)/i.test(m);
const isNonceGap = (m: string) => /nonce too high|nonce gap|future nonce/i.test(m);
const isAlreadyKnown = (m: string) => /already known|known transaction|already imported|already in (the )?pool/i.test(m);
const isMethodMissing = (i: RpcErrorInfo) =>
  i.code === -32601 || /method not found|not supported|does not exist|unknown method|not available/i.test(i.message);
const isInsufficientFunds = (m: string) => /insufficient (funds|balance)|reserve balance/i.test(m);

export class LanePool {
  readonly lanes: Lane[];
  #syncSupported = true;
  #baseFee: { value: bigint | null; at: number } = { value: null, at: 0 };
  #rr = 0;

  constructor(
    readonly client: PublicClient,
    keys: Secret[],
    readonly opts: LaneOptions,
  ) {
    if (!keys.length) throw new Error("RELAYER_KEYS must contain at least one key");
    this.lanes = keys.map((k, i) => new Lane(i, k));
    const addrs = new Set(this.lanes.map((l) => l.address));
    if (addrs.size !== this.lanes.length) throw new Error("RELAYER_KEYS contains duplicate keys");
  }

  get syncSupported() {
    return this.#syncSupported;
  }

  async init() {
    await Promise.all(this.lanes.map((l) => this.#resync(l).catch((e) => (l.lastError = shortErr(e)))));
    await this.refreshBalances();
  }

  async refreshBalances() {
    await Promise.all(
      this.lanes.map(async (l) => {
        try {
          l.balance = await this.client.getBalance({ address: l.address });
        } catch (e) {
          l.lastError = shortErr(e);
        }
      }),
    );
  }

  /** Least-loaded lane with enough balance; round-robin among equals. */
  pick(): Lane {
    const ok = this.lanes.filter((l) => l.balance === null || l.balance >= this.opts.minBalanceWei);
    const pool = ok.length ? ok : this.lanes;
    const minLoad = Math.min(...pool.map((l) => l.load));
    const candidates = pool.filter((l) => l.load === minLoad);
    const lane = candidates[this.#rr++ % candidates.length];
    return lane;
  }

  status(): LaneStatus[] {
    return this.lanes.map((l) => ({
      index: l.index,
      address: l.address,
      nonce: l.nonce,
      queued: l.mutex.waiting,
      busy: l.mutex.locked,
      balanceWei: l.balance?.toString() ?? null,
      lowBalance: l.balance !== null && l.balance < this.opts.minBalanceWei,
      sent: l.sent,
      failed: l.failed,
      lastTxHash: l.lastTxHash,
      lastError: l.lastError,
    }));
  }

  async #resync(l: Lane) {
    l.nonce = await this.client.getTransactionCount({ address: l.address, blockTag: "pending" });
  }

  async #baseFeeNow(): Promise<bigint | null> {
    if (Date.now() - this.#baseFee.at < 2_000) return this.#baseFee.value;
    try {
      const b = await this.client.getBlock({ blockTag: "latest" });
      this.#baseFee = { value: b.baseFeePerGas ?? null, at: Date.now() };
    } catch {
      /* keep the last value */
    }
    return this.#baseFee.value;
  }

  /**
   * Sign and send one call on a lane; resolves with the receipt. `gas` must be a MonadGasLimit that
   * Monad's eth_estimateGas produced on this pool's RPC client for exactly this lane, target,
   * calldata and value (see gas.ts). Anything else is refused before signing.
   */
  async submit(lane: Lane, tx: { to: Address; data: Hex; gas: MonadGasLimit; value?: bigint }): Promise<SubmitResult> {
    assertMonadGas(tx.gas, this.client, { from: lane.address, to: tx.to, data: tx.data, value: tx.value ?? 0n });
    const gasLimit = tx.gas.value;
    return lane.mutex.run(async () => {
      if (lane.nonce === null) await this.#resync(lane);
      let attempt = 0;
      for (;;) {
        attempt++;
        const fees = feesFor(await this.#baseFeeNow(), this.opts.priorityFeeWei, this.opts.maxFeeWei);
        const nonce = lane.nonce!;
        const raw = await lane.account.signTransaction({
          chainId: this.opts.chainId,
          type: "eip1559",
          to: tx.to,
          data: tx.data,
          value: tx.value ?? 0n,
          gas: gasLimit,
          nonce,
          ...fees,
        });
        const txHash = keccak256(raw);
        const t0 = performance.now();
        try {
          const { receipt, sync } = await this.#send(raw, txHash);
          lane.nonce = nonce + 1;
          lane.sent++;
          lane.lastTxHash = txHash;
          lane.lastError = null;
          if (lane.balance !== null) lane.balance -= receipt.gasUsed * receipt.effectiveGasPrice; // refreshed periodically
          return { receipt, txHash, lane: lane.index, latencyMs: Math.round(performance.now() - t0), sync };
        } catch (err) {
          const info = rpcErrorInfo(err);
          lane.lastError = info.message.slice(0, 300);
          if (isAlreadyKnown(info.message)) {
            // The node has it: wait for it.
            const receipt = await this.client.waitForTransactionReceipt({ hash: txHash, timeout: 30_000, pollingInterval: 250 });
            lane.nonce = nonce + 1;
            lane.sent++;
            lane.lastTxHash = txHash;
            return { receipt, txHash, lane: lane.index, latencyMs: Math.round(performance.now() - t0), sync: false };
          }
          if ((isNonceTooLow(info.message) || isNonceGap(info.message)) && attempt < 3) {
            log.warn("lane nonce out of sync; resyncing", { lane: lane.index, nonce, error: lane.lastError });
            await this.#resync(lane);
            continue;
          }
          lane.failed++;
          if (isInsufficientFunds(info.message)) {
            await this.refreshBalances();
            throw new RelayError(503, "RELAYER_UNDERFUNDED", "The relayer is temporarily out of gas funds. Please try again shortly.");
          }
          // Unknown outcome: maybe the tx went out. Check the chain before giving up the nonce.
          const recovered = await this.#recover(lane, nonce, txHash);
          if (recovered) {
            lane.sent++;
            lane.lastTxHash = txHash;
            return { receipt: recovered, txHash, lane: lane.index, latencyMs: Math.round(performance.now() - t0), sync: false };
          }
          log.error("send failed", { lane: lane.index, txHash, error: lane.lastError });
          throw new RelayError(502, "SEND_FAILED", "The network didn't accept the transaction. Please try again.", { txHash });
        }
      }
    });
  }

  async #recover(lane: Lane, nonce: number, txHash: Hex): Promise<TransactionReceipt | null> {
    try {
      const receipt = await this.client.waitForTransactionReceipt({ hash: txHash, timeout: 4_000, pollingInterval: 250 });
      lane.nonce = nonce + 1;
      return receipt;
    } catch {
      /* not mined (yet) */
    }
    try {
      const chainNonce = await this.client.getTransactionCount({ address: lane.address, blockTag: "pending" });
      lane.nonce = chainNonce;
      if (chainNonce > nonce) {
        // Our nonce was consumed; if it was this tx, its receipt will show up.
        return await this.client.waitForTransactionReceipt({ hash: txHash, timeout: 10_000, pollingInterval: 250 }).catch(() => null);
      }
    } catch {
      lane.nonce = null; // force a resync on next use
    }
    return null;
  }

  /** eth_sendRawTransactionSync (EIP-7966), falling back to eth_sendRawTransaction + receipt polling. */
  async #send(raw: Hex, txHash: Hex): Promise<{ receipt: TransactionReceipt; sync: boolean }> {
    if (this.#syncSupported) {
      try {
        const r = await this.client.request(
          { method: "eth_sendRawTransactionSync" as never, params: [raw] as never },
          { retryCount: 0 },
        );
        return { receipt: formatTransactionReceipt(r as never), sync: true };
      } catch (err) {
        const info = rpcErrorInfo(err);
        if (info.code === 4) {
          // Timed out waiting for the receipt; the tx was accepted.
          const hash = (typeof info.data === "string" && /^0x[0-9a-fA-F]{64}$/.test(info.data) ? info.data : txHash) as Hex;
          const receipt = await this.client.waitForTransactionReceipt({ hash, timeout: 30_000, pollingInterval: 250 });
          return { receipt, sync: false };
        }
        if (!isMethodMissing(info)) throw err;
        log.warn("eth_sendRawTransactionSync unsupported by RPC; falling back", { error: info.message.slice(0, 200) });
        this.#syncSupported = false;
      }
    }
    await this.client.request({ method: "eth_sendRawTransaction", params: [raw] }, { retryCount: 0 });
    const receipt = await this.client.waitForTransactionReceipt({ hash: txHash, timeout: 30_000, pollingInterval: 250 });
    return { receipt, sync: false };
  }
}
