/**
 * Gas policy. Monad charges gas on the gas LIMIT, not gas used, and prices cold state differently
 * from Ethereum (see ../../contracts/GAS.md). So every gas limit the relayer signs is derived from
 * Monad's own estimator: `eth_estimateGas` on the configured Monad RPC, for exactly the transaction
 * being sent, plus a small margin.
 *
 * This is enforced structurally:
 *   - `MonadGasLimit` can only be constructed inside this module, by `MonadGasEstimator.limitFor()`,
 *     which calls `eth_estimateGas` on its RPC client. Every issued limit is recorded in a
 *     module-private WeakSet, so neither a type cast nor a look-alike object passes `assertMonadGas`.
 *   - Each limit is bound to the RPC client that estimated it and to the exact (from, to, data,
 *     value) it was estimated for. `LanePool.submit()` takes only a `MonadGasLimit` and refuses to
 *     sign unless the limit was issued by its own client for the transaction it is about to sign.
 *   - Per-action caps only REJECT an estimate that is too expensive. They are never used as a
 *     limit: there is no clamp, and no fallback constant.
 */
import type { Address, Hex, PublicClient } from "viem";
import { RelayError } from "./errors.js";

/**
 * Upper bound on Monad's `eth_estimateGas` result per action. An estimate above the cap is
 * refused (GAS_CAP_EXCEEDED); the cap is never the gas limit.
 */
export const DEFAULT_GAS_CAPS: Record<string, number> = {
  createPot: 1_500_000,
  join: 700_000,
  contribute: 250_000,
  propose: 1_500_000,
  vote: 1_500_000,
  cancelSpend: 200_000,
  execute: 1_500_000,
  expire: 200_000,
  openDispute: 300_000,
  resolveDispute: 1_500_000,
  voteDispute: 250_000,
  finalizeDispute: 1_500_000,
  freeze: 200_000,
  voteUnfreeze: 200_000,
  proposeRules: 600_000,
  voteRules: 400_000,
  applyRules: 600_000,
  exit: 600_000,
  ack: 200_000,
  settle: 5_000_000,
  payDebt: 2_500_000,
  rotateInvite: 200_000,
  postKeyWraps: 800_000,
  registerKey: 200_000,
  send: 300_000,
  claimCreate: 350_000,
  claim: 300_000,
  claimRefund: 1_500_000,
  // internal (not exposed by /v1/relay)
  faucetRequest: 300_000,
  ausdTransfer: 150_000,
};

/** Estimate cap for an action with no entry in DEFAULT_GAS_CAPS or the overrides. */
export const DEFAULT_UNKNOWN_ACTION_CAP = 1_000_000;

export const MONAD_MIN_BASE_FEE = 100_000_000_000n; // 100 gwei floor

export interface GasPolicy {
  marginBps: number; // e.g. 1000 = +10%
  marginFixed: number; // flat gas added on top
  caps: Record<string, number>; // estimate-cap overrides
}

export function capFor(action: string, policy: GasPolicy): number {
  return policy.caps[action] ?? DEFAULT_GAS_CAPS[action] ?? DEFAULT_UNKNOWN_ACTION_CAP;
}

/**
 * Margin arithmetic on a Monad estimate: ceil(estimate * (1 + marginBps)) + marginFixed.
 * Throws GAS_CAP_EXCEEDED when the estimate is above the action's cap (the cap rejects; it never
 * lowers the limit). Returns a plain bigint, which `LanePool.submit()` does not accept: the only
 * way to obtain a sendable limit is `MonadGasEstimator.limitFor()`.
 */
export function gasLimitFor(action: string, estimate: bigint, policy: GasPolicy): bigint {
  const cap = BigInt(capFor(action, policy));
  if (estimate <= 0n) throw new RelayError(500, "GAS_ESTIMATE_INVALID", "Gas estimate was zero.");
  if (estimate > cap) {
    throw new RelayError(422, "GAS_CAP_EXCEEDED", `This action needs more gas (${estimate}) than the relayer allows for ${action} (${cap}).`, {
      estimate: estimate.toString(),
      cap: cap.toString(),
    });
  }
  return (estimate * BigInt(10_000 + policy.marginBps) + 9_999n) / 10_000n + BigInt(policy.marginFixed);
}

/** The transaction a limit is estimated for (and the only one it may be used with). */
export interface GasRequest {
  from: Address;
  to: Address;
  data: Hex;
  value?: bigint;
}

/** The RPC surface the estimator needs: a JSON-RPC `request` on the configured Monad RPC. */
export type GasRpc = Pick<PublicClient, "request">;

const ISSUE: unique symbol = Symbol("MonadGasLimit.issue");
const issued = new WeakSet<object>();

const sameTx = (a: GasRequest, b: GasRequest) =>
  a.from.toLowerCase() === b.from.toLowerCase() &&
  a.to.toLowerCase() === b.to.toLowerCase() &&
  a.data.toLowerCase() === b.data.toLowerCase() &&
  (a.value ?? 0n) === (b.value ?? 0n);

/**
 * A gas limit derived from Monad's `eth_estimateGas` for one specific transaction. Construct it
 * only through `MonadGasEstimator.limitFor()`; the constructor refuses any other caller.
 */
export class MonadGasLimit {
  readonly #value: bigint;
  readonly #rpc: GasRpc;
  readonly #tx: Readonly<GasRequest>;
  /** Monad's raw `eth_estimateGas` result the limit was derived from. */
  readonly estimate: bigint;
  readonly action: string;

  constructor(token: typeof ISSUE, rpc: GasRpc, action: string, tx: GasRequest, estimate: bigint, value: bigint) {
    if (token !== ISSUE) throw new Error("MonadGasLimit can only be created by MonadGasEstimator.limitFor()");
    this.#rpc = rpc;
    this.#tx = Object.freeze({ ...tx, value: tx.value ?? 0n });
    this.action = action;
    this.estimate = estimate;
    this.#value = value;
    Object.freeze(this);
  }

  /** The gas limit to sign. */
  get value(): bigint {
    return this.#value;
  }

  /** True if this limit was estimated by `rpc` for exactly `tx`. */
  issuedFor(rpc: GasRpc, tx: GasRequest): boolean {
    return this.#rpc === rpc && sameTx(this.#tx, tx);
  }

  toString() {
    return this.#value.toString();
  }

  toJSON() {
    return this.#value.toString();
  }
}

/**
 * Throws unless `gas` is a MonadGasLimit issued by `MonadGasEstimator.limitFor()` on `rpc` for
 * exactly `tx`. `LanePool.submit()` calls this before it signs anything.
 */
export function assertMonadGas(gas: unknown, rpc: GasRpc, tx: GasRequest): asserts gas is MonadGasLimit {
  if (!(gas instanceof MonadGasLimit) || !issued.has(gas)) {
    throw new Error("Refusing to send: the gas limit was not produced by Monad's eth_estimateGas (MonadGasEstimator.limitFor).");
  }
  if (!gas.issuedFor(rpc, tx)) {
    throw new Error("Refusing to send: the gas limit was estimated on a different RPC or for a different transaction.");
  }
}

const hex = (n: bigint) => `0x${n.toString(16)}` as Hex;

/** The only producer of `MonadGasLimit`: `eth_estimateGas` on the configured Monad RPC, plus the policy margin. */
export class MonadGasEstimator {
  constructor(
    readonly rpc: GasRpc,
    readonly policy: GasPolicy,
  ) {}

  /** Monad's `eth_estimateGas` for `tx` at the latest block. Rejects (and the caller decodes the revert) if the call reverts. */
  async estimate(tx: GasRequest): Promise<bigint> {
    const params = { from: tx.from, to: tx.to, data: tx.data, ...(tx.value ? { value: hex(tx.value) } : {}) };
    const r = await this.rpc.request({ method: "eth_estimateGas", params: [params, "latest"] } as never);
    return BigInt(r as unknown as string);
  }

  /** Estimate on Monad, apply the margin, check the cap, and issue a limit bound to this RPC and `tx`. */
  async limitFor(action: string, tx: GasRequest): Promise<MonadGasLimit> {
    const estimate = await this.estimate(tx);
    const limit = new MonadGasLimit(ISSUE, this.rpc, action, tx, estimate, gasLimitFor(action, estimate, this.policy));
    issued.add(limit);
    return limit;
  }
}

/**
 * EIP-1559 fees. Monad charges base fee + priority, so a tight maxFee keeps the reserve-balance
 * check (gas limit * max fee) small without risking inclusion: base fee moves slowly.
 */
export function feesFor(baseFee: bigint | null | undefined, priorityFee: bigint, maxFeeCap: bigint) {
  const base = baseFee && baseFee > MONAD_MIN_BASE_FEE ? baseFee : MONAD_MIN_BASE_FEE;
  let maxFeePerGas = base + base / 4n + priorityFee;
  if (maxFeePerGas > maxFeeCap) maxFeePerGas = maxFeeCap;
  const maxPriorityFeePerGas = priorityFee > maxFeePerGas ? maxFeePerGas : priorityFee;
  return { maxFeePerGas, maxPriorityFeePerGas };
}

/** Worst-case MON reserved for a tx (what Monad's reserve-balance rule counts). */
export function maxCost(gasLimit: bigint, maxFeePerGas: bigint) {
  return gasLimit * maxFeePerGas;
}
