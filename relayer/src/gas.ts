/**
 * Gas policy. Monad charges gas on the gas LIMIT, not gas used, so every limit is
 * estimateGas + a small margin, and never above a per-action cap.
 */
import { RelayError } from "./errors.js";

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

export const MONAD_MIN_BASE_FEE = 100_000_000_000n; // 100 gwei floor

export interface GasPolicy {
  marginBps: number; // e.g. 1000 = +10%
  marginFixed: number; // flat gas added on top
  caps: Record<string, number>; // overrides
}

export function capFor(action: string, policy: GasPolicy): number {
  return policy.caps[action] ?? DEFAULT_GAS_CAPS[action] ?? 1_000_000;
}

/** estimate * (1 + margin) + fixed, capped at the action cap. Throws if the estimate alone exceeds the cap. */
export function gasLimitFor(action: string, estimate: bigint, policy: GasPolicy): bigint {
  const cap = BigInt(capFor(action, policy));
  if (estimate <= 0n) throw new RelayError(500, "GAS_ESTIMATE_INVALID", "Gas estimate was zero.");
  if (estimate > cap) {
    throw new RelayError(422, "GAS_CAP_EXCEEDED", `This action needs more gas (${estimate}) than the relayer allows for ${action} (${cap}).`, {
      estimate: estimate.toString(),
      cap: cap.toString(),
    });
  }
  const withMargin = (estimate * BigInt(10_000 + policy.marginBps) + 9_999n) / 10_000n + BigInt(policy.marginFixed);
  return withMargin > cap ? cap : withMargin;
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
