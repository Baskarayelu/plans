/**
 * EIP-712 domains, types and struct hashes from IPot.sol / IPlansPeriphery.sol.
 * Used by the demo members (who sign like any app user) and by tests.
 */
import {
  bytesToHex,
  encodeAbiParameters,
  getAbiItem,
  keccak256,
  type Address,
  type Hex,
  type LocalAccount,
} from "viem";
import { factoryAbi, plansSendAbi, potAbi } from "./abi.js";

export const potDomain = (chainId: number, pot: Address) =>
  ({ name: "Plans Pot", version: "1", chainId, verifyingContract: pot }) as const;
export const factoryDomain = (chainId: number, factory: Address) =>
  ({ name: "Plans Factory", version: "1", chainId, verifyingContract: factory }) as const;
export const keysDomain = (chainId: number, registry: Address) =>
  ({ name: "Plans Keys", version: "1", chainId, verifyingContract: registry }) as const;
export const claimsDomain = (chainId: number, escrow: Address) =>
  ({ name: "Plans Claims", version: "1", chainId, verifyingContract: escrow }) as const;
export const ausdDomain = (chainId: number, ausd: Address, name = "Agora Dollar", version = "1") =>
  ({ name, version, chainId, verifyingContract: ausd }) as const;

const m = { name: "member", type: "address" } as const;
const nonce = { name: "nonce", type: "uint256" } as const;
const deadline = { name: "deadline", type: "uint256" } as const;

export const potTypes = {
  Invite: [m],
  Join: [m, { name: "country", type: "bytes2" }, { name: "safetyNet", type: "uint256" }, nonce, deadline],
  Propose: [
    { name: "proposer", type: "address" },
    { name: "kind", type: "uint8" },
    { name: "payee", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "category", type: "uint8" },
    { name: "splitHash", type: "bytes32" },
    { name: "receiptHash", type: "bytes32" },
    { name: "memoHash", type: "bytes32" },
    nonce,
    deadline,
  ],
  Vote: [m, { name: "id", type: "uint256" }, { name: "approve", type: "bool" }, nonce, deadline],
  CancelSpend: [m, { name: "id", type: "uint256" }, nonce, deadline],
  OpenDispute: [m, { name: "spendId", type: "uint256" }, { name: "reason", type: "uint8" }, { name: "memoHash", type: "bytes32" }, nonce, deadline],
  ResolveDispute: [m, { name: "disputeId", type: "uint256" }, { name: "outcome", type: "uint8" }, { name: "splitHash", type: "bytes32" }, nonce, deadline],
  DisputeVote: [m, { name: "disputeId", type: "uint256" }, { name: "spenderCovers", type: "bool" }, nonce, deadline],
  Freeze: [m, nonce, deadline],
  UnfreezeVote: [m, nonce, deadline],
  ProposeRules: [m, { name: "rulesHash", type: "bytes32" }, { name: "allowlistHash", type: "bytes32" }, nonce, deadline],
  VoteRules: [m, { name: "id", type: "uint256" }, { name: "approve", type: "bool" }, nonce, deadline],
  Exit: [m, nonce, deadline],
  Ack: [m, nonce, deadline],
  RotateInvite: [m, { name: "newSigner", type: "address" }, nonce, deadline],
  PostKeyWraps: [m, { name: "wrapsHash", type: "bytes32" }, nonce, deadline],
} as const;

export const factoryTypes = {
  CreatePot: [{ name: "creator", type: "address" }, { name: "paramsHash", type: "bytes32" }, nonce, deadline],
} as const;

export const keysTypes = {
  RegisterKey: [{ name: "account", type: "address" }, { name: "pubKey", type: "bytes32" }, deadline],
} as const;

export const claimsTypes = {
  Claim: [{ name: "id", type: "uint256" }, { name: "recipient", type: "address" }, { name: "toCountry", type: "bytes2" }],
} as const;

export const ausdTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

// ───────────── struct types and hashes ─────────────

export interface Rules {
  instantMax: bigint;
  oneApprovalMax: bigint;
  highTier: number;
  memberDailyCap: bigint;
  memberTotalCap: bigint;
  payeePolicy: number;
  minContribution: bigint;
  proposalTtl: number;
  ruleTimelock: number;
  categoryBudgets: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
}

export interface CreatePotParams {
  rules: Rules;
  startTime: bigint;
  endTime: bigint;
  reviewWindow: number;
  inviteSigner: Address;
  creatorCountry: Hex;
  creatorSafetyNet: bigint;
  meta: Hex;
  creatorKeyWrap: Hex;
  inviteKeyWrap: Hex;
  salt: Hex;
}

export interface Split {
  members: readonly Address[];
  weights: readonly number[];
}

const createPotParamsInput = getAbiItem({ abi: factoryAbi, name: "createPot" }).inputs[1];
const rulesInput = getAbiItem({ abi: potAbi, name: "proposeRules" }).inputs[1];
const wrapsInput = getAbiItem({ abi: potAbi, name: "postKeyWraps" }).inputs[1];
const sendMetaInput = getAbiItem({ abi: plansSendAbi, name: "send" }).inputs[1];

/** PlansSend.SendMeta (field order matters: the 3009 nonce is keccak256(abi.encode(meta))). */
export interface SendMeta {
  to: Address;
  fromCountry: Hex;
  toCountry: Hex;
  fromCurrency: Hex;
  toCurrency: Hex;
  fxRateE8: bigint;
  fxTimestamp: bigint;
  fxRoundId: bigint; // 0 = no FxReference round
  memoHash: Hex;
  salt: Hex;
}

export const hashSplit = (s: Split) =>
  keccak256(encodeAbiParameters([{ type: "address[]" }, { type: "uint32[]" }], [s.members, s.weights]));
export const hashRules = (r: Rules) => keccak256(encodeAbiParameters([rulesInput], [r as never]));
export const hashCreatePotParams = (p: CreatePotParams) =>
  keccak256(encodeAbiParameters([createPotParamsInput], [p as never]));
export const hashAllowlist = (add: readonly Address[], remove: readonly Address[]) =>
  keccak256(encodeAbiParameters([{ type: "address[]" }, { type: "address[]" }], [add, remove]));
export const hashWraps = (wraps: readonly { member: Address; wrap: Hex }[]) =>
  keccak256(encodeAbiParameters([wrapsInput], [wraps as never]));
export const hashMemo = (memo: Hex) => keccak256(memo);
/** PlansSend.send: the ERC-3009 nonce = keccak256(abi.encode(meta)). */
export const hashSendMeta = (meta: SendMeta) => keccak256(encodeAbiParameters([sendMetaInput], [meta as never]));

/** ISO 3166 alpha-2 / ISO 4217 code to bytesN hex ("GB" -> 0x4742). */
export function asciiToBytes(code: string): Hex {
  return bytesToHex(new TextEncoder().encode(code));
}

export function randomNonce(): bigint {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return BigInt(bytesToHex(b));
}

export function randomBytes32(): Hex {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;
export const EMPTY_AUTH = { value: 0n, validAfter: 0n, validBefore: 0n, nonce: ZERO_BYTES32, signature: "0x" as Hex };
export const EMPTY_PERMIT = { value: 0n, deadline: 0n, v: 0, r: ZERO_BYTES32, s: ZERO_BYTES32 };
export const EMPTY_KEYREG = { pubKey: ZERO_BYTES32, deadline: 0n, signature: "0x" as Hex };

/** Sign an AUSD receiveWithAuthorization (bytes-signature variant) paying `to`. */
export async function signReceiveAuth(
  account: LocalAccount,
  opts: { chainId: number; ausd: Address; to: Address; value: bigint; validBefore: bigint; nonce?: Hex; domain?: { name: string; version: string } },
) {
  const nonce = opts.nonce ?? randomBytes32();
  const message = { from: account.address, to: opts.to, value: opts.value, validAfter: 0n, validBefore: opts.validBefore, nonce };
  const signature = await account.signTypedData({
    domain: ausdDomain(opts.chainId, opts.ausd, opts.domain?.name, opts.domain?.version),
    types: ausdTypes,
    primaryType: "ReceiveWithAuthorization",
    message,
  });
  return { value: opts.value, validAfter: 0n, validBefore: opts.validBefore, nonce, signature };
}

export async function signPot<P extends keyof typeof potTypes>(
  account: LocalAccount,
  chainId: number,
  pot: Address,
  primaryType: P,
  message: Record<string, unknown>,
): Promise<Hex> {
  const sign = account.signTypedData as (x: unknown) => Promise<Hex>;
  return sign({ domain: potDomain(chainId, pot), types: { [primaryType]: potTypes[primaryType] }, primaryType, message });
}
