/**
 * Typed EIP-712 builders for every Plans message, ERC-3009 ReceiveWithAuthorization and ERC-2612
 * Permit. Type strings match contracts/src/interfaces (checked by src/__tests__/eip712.test.ts
 * against the contract sources). Each builder returns viem's `signTypedData` argument, so signing is
 * `account.signTypedData(builder(...))` and hashing is `hashTypedData(builder(...))`.
 */
import {
  encodeAbiParameters,
  getAbiItem,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
  type TypedDataDefinition,
} from "viem";
import { factoryAbi, plansSendAbi, potAbi } from "./abi";

// ─────────────── domains ───────────────

export type Domain = { name: string; version: string; chainId: number; verifyingContract: Address };

export const potDomain = (chainId: number, pot: Address): Domain => ({ name: "Plans Pot", version: "1", chainId, verifyingContract: pot });
export const factoryDomain = (chainId: number, factory: Address): Domain => ({ name: "Plans Factory", version: "1", chainId, verifyingContract: factory });
export const keysDomain = (chainId: number, registry: Address): Domain => ({ name: "Plans Keys", version: "1", chainId, verifyingContract: registry });
export const claimsDomain = (chainId: number, escrow: Address): Domain => ({ name: "Plans Claims", version: "1", chainId, verifyingContract: escrow });
/** AUSD: { name: "Agora Dollar", version: "1", chainId, verifyingContract: AUSD }. */
export const ausdDomain = (chainId: number, ausd: Address): Domain => ({ name: "Agora Dollar", version: "1", chainId, verifyingContract: ausd });

// ─────────────── types ───────────────

const m = { name: "member", type: "address" } as const;
const nonce = { name: "nonce", type: "uint256" } as const;
const deadline = { name: "deadline", type: "uint256" } as const;

export const POT_TYPES = {
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

export const FACTORY_TYPES = {
  CreatePot: [{ name: "creator", type: "address" }, { name: "paramsHash", type: "bytes32" }, nonce, deadline],
} as const;

export const KEYS_TYPES = {
  RegisterKey: [{ name: "account", type: "address" }, { name: "pubKey", type: "bytes32" }, deadline],
} as const;

export const CLAIMS_TYPES = {
  Claim: [{ name: "id", type: "uint256" }, { name: "recipient", type: "address" }, { name: "toCountry", type: "bytes2" }],
} as const;

export const AUSD_TYPES = {
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

type PotType = keyof typeof POT_TYPES;

function potMessage<P extends PotType>(chainId: number, pot: Address, primaryType: P, message: Record<string, unknown>): TypedDataDefinition {
  return {
    domain: potDomain(chainId, pot),
    types: { [primaryType]: POT_TYPES[primaryType] } as never,
    primaryType: primaryType as never,
    message: message as never,
  };
}

// ─────────────── struct shapes ───────────────

export enum SpendKind {
  PAY = 0,
  LINK = 1,
  PERSONAL = 2,
}
export enum HighTier {
  MAJORITY = 0,
  ALL = 1,
}
export enum PayeePolicy {
  ANYONE = 0,
  MEMBERS_ONLY = 1,
  MEMBERS_AND_ALLOWLIST = 2,
}
export enum DisputeOutcome {
  None = 0,
  Keep = 1,
  Resplit = 2,
  SpenderCovers = 3,
}

export type Rules = {
  instantMax: bigint;
  oneApprovalMax: bigint;
  highTier: HighTier;
  memberDailyCap: bigint;
  memberTotalCap: bigint;
  payeePolicy: PayeePolicy;
  minContribution: bigint;
  proposalTtl: number;
  ruleTimelock: number;
  categoryBudgets: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
};

export type CreatePotParams = {
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
};

export type Split = { members: readonly Address[]; weights: readonly number[] };
export type KeyWrapEntry = { member: Address; wrap: Hex };

export type SendMeta = {
  to: Address;
  fromCountry: Hex;
  toCountry: Hex;
  fromCurrency: Hex;
  toCurrency: Hex;
  fxRateE8: bigint;
  fxTimestamp: bigint;
  memoHash: Hex;
  salt: Hex;
};

export type Auth3009 = { value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex; signature: Hex };
export type Permit2612 = { value: bigint; deadline: bigint; v: number; r: Hex; s: Hex };
export type KeyReg = { pubKey: Hex; deadline: bigint; signature: Hex };

export const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
export const EMPTY_AUTH: Auth3009 = { value: 0n, validAfter: 0n, validBefore: 0n, nonce: ZERO_BYTES32, signature: "0x" };
export const EMPTY_PERMIT: Permit2612 = { value: 0n, deadline: 0n, v: 0, r: ZERO_BYTES32, s: ZERO_BYTES32 };
export const EMPTY_KEYREG: KeyReg = { pubKey: ZERO_BYTES32, deadline: 0n, signature: "0x" };

/** ISO code ("GB", "GBP") → bytesN hex. Empty → zero bytes. */
export function codeToBytes(code: string | undefined, n: 2 | 3): Hex {
  if (!code) return `0x${"00".repeat(n)}` as Hex;
  if (!new RegExp(`^[A-Z]{${n}}$`).test(code)) throw new Error(`bad ${n}-letter code ${code}`);
  return stringToHex(code);
}

export function bytesToCode(hex: string | null | undefined): string | undefined {
  if (!hex) return undefined;
  if (/^[A-Z]{2,3}$/.test(hex)) return hex;
  const h = hex.replace(/^0x/, "");
  if (/^0+$/.test(h)) return undefined;
  let s = "";
  for (let i = 0; i < h.length; i += 2) s += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
  return /^[A-Z]+$/.test(s) ? s : undefined;
}

// ─────────────── hashes ───────────────

const createPotParamsInput = getAbiItem({ abi: factoryAbi, name: "createPot" }).inputs[1];
const rulesInput = getAbiItem({ abi: potAbi, name: "proposeRules" }).inputs[1];
const wrapsInput = getAbiItem({ abi: potAbi, name: "postKeyWraps" }).inputs[1];
const sendMetaInput = getAbiItem({ abi: plansSendAbi, name: "send" }).inputs[1];

/** splitHash = keccak256(abi.encode(split.members, split.weights)) */
export const splitHash = (s: Split): Hex =>
  keccak256(encodeAbiParameters([{ type: "address[]" }, { type: "uint32[]" }], [s.members, s.weights]));
/** rulesHash = keccak256(abi.encode(rules)) */
export const rulesHash = (r: Rules): Hex => keccak256(encodeAbiParameters([rulesInput], [r as never]));
/** paramsHash = keccak256(abi.encode(params)) */
export const paramsHash = (p: CreatePotParams): Hex => keccak256(encodeAbiParameters([createPotParamsInput], [p as never]));
/** allowlistHash = keccak256(abi.encode(allowAdd, allowRemove)) */
export const allowlistHash = (add: readonly Address[], remove: readonly Address[]): Hex =>
  keccak256(encodeAbiParameters([{ type: "address[]" }, { type: "address[]" }], [add, remove]));
/** wrapsHash = keccak256(abi.encode(wraps)) */
export const wrapsHash = (wraps: readonly KeyWrapEntry[]): Hex => keccak256(encodeAbiParameters([wrapsInput], [wraps as never]));
/** memoHash = keccak256(memo) */
export const memoHash = (memo: Hex): Hex => keccak256(memo);

/** ClaimEscrow.createWithAuthorization: the 3009 nonce = keccak256(abi.encode(claimSigner, expiry, fromCountry, salt)). */
export const claimAuthNonce = (claimSigner: Address, expiry: bigint, fromCountry: Hex, salt: Hex): Hex =>
  keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint64" }, { type: "bytes2" }, { type: "bytes32" }], [claimSigner, expiry, fromCountry, salt]),
  );

/** PlansSend.send: the 3009 nonce = keccak256(abi.encode(meta)). */
export const sendAuthNonce = (meta: SendMeta): Hex => keccak256(encodeAbiParameters([sendMetaInput], [meta as never]));

// ─────────────── builders: Pot ───────────────

export const typed = {
  invite: (chainId: number, pot: Address, member: Address) => potMessage(chainId, pot, "Invite", { member }),
  join: (chainId: number, pot: Address, p: { member: Address; country: Hex; safetyNet: bigint; nonce: bigint; deadline: bigint }) =>
    potMessage(chainId, pot, "Join", p),
  propose: (
    chainId: number,
    pot: Address,
    p: { proposer: Address; kind: SpendKind; payee: Address; amount: bigint; category: number; split: Split; receiptHash: Hex; memo: Hex; nonce: bigint; deadline: bigint },
  ) =>
    potMessage(chainId, pot, "Propose", {
      proposer: p.proposer,
      kind: p.kind,
      payee: p.payee,
      amount: p.amount,
      category: p.category,
      splitHash: splitHash(p.split),
      receiptHash: p.receiptHash,
      memoHash: memoHash(p.memo),
      nonce: p.nonce,
      deadline: p.deadline,
    }),
  vote: (chainId: number, pot: Address, p: { member: Address; id: bigint; approve: boolean; nonce: bigint; deadline: bigint }) =>
    potMessage(chainId, pot, "Vote", p),
  cancelSpend: (chainId: number, pot: Address, p: { member: Address; id: bigint; nonce: bigint; deadline: bigint }) =>
    potMessage(chainId, pot, "CancelSpend", p),
  openDispute: (chainId: number, pot: Address, p: { member: Address; spendId: bigint; reason: number; memo: Hex; nonce: bigint; deadline: bigint }) =>
    potMessage(chainId, pot, "OpenDispute", {
      member: p.member,
      spendId: p.spendId,
      reason: p.reason,
      memoHash: memoHash(p.memo),
      nonce: p.nonce,
      deadline: p.deadline,
    }),
  resolveDispute: (
    chainId: number,
    pot: Address,
    p: { member: Address; disputeId: bigint; outcome: DisputeOutcome; split: Split; nonce: bigint; deadline: bigint },
  ) =>
    potMessage(chainId, pot, "ResolveDispute", {
      member: p.member,
      disputeId: p.disputeId,
      outcome: p.outcome,
      splitHash: splitHash(p.split),
      nonce: p.nonce,
      deadline: p.deadline,
    }),
  disputeVote: (chainId: number, pot: Address, p: { member: Address; disputeId: bigint; spenderCovers: boolean; nonce: bigint; deadline: bigint }) =>
    potMessage(chainId, pot, "DisputeVote", p),
  freeze: (chainId: number, pot: Address, p: { member: Address; nonce: bigint; deadline: bigint }) => potMessage(chainId, pot, "Freeze", p),
  unfreezeVote: (chainId: number, pot: Address, p: { member: Address; nonce: bigint; deadline: bigint }) =>
    potMessage(chainId, pot, "UnfreezeVote", p),
  proposeRules: (
    chainId: number,
    pot: Address,
    p: { member: Address; rules: Rules; allowAdd: readonly Address[]; allowRemove: readonly Address[]; nonce: bigint; deadline: bigint },
  ) =>
    potMessage(chainId, pot, "ProposeRules", {
      member: p.member,
      rulesHash: rulesHash(p.rules),
      allowlistHash: allowlistHash(p.allowAdd, p.allowRemove),
      nonce: p.nonce,
      deadline: p.deadline,
    }),
  voteRules: (chainId: number, pot: Address, p: { member: Address; id: bigint; approve: boolean; nonce: bigint; deadline: bigint }) =>
    potMessage(chainId, pot, "VoteRules", p),
  exit: (chainId: number, pot: Address, p: { member: Address; nonce: bigint; deadline: bigint }) => potMessage(chainId, pot, "Exit", p),
  ack: (chainId: number, pot: Address, p: { member: Address; nonce: bigint; deadline: bigint }) => potMessage(chainId, pot, "Ack", p),
  rotateInvite: (chainId: number, pot: Address, p: { member: Address; newSigner: Address; nonce: bigint; deadline: bigint }) =>
    potMessage(chainId, pot, "RotateInvite", p),
  postKeyWraps: (chainId: number, pot: Address, p: { member: Address; wraps: readonly KeyWrapEntry[]; nonce: bigint; deadline: bigint }) =>
    potMessage(chainId, pot, "PostKeyWraps", { member: p.member, wrapsHash: wrapsHash(p.wraps), nonce: p.nonce, deadline: p.deadline }),

  // ─────────────── factory / keys / claims ───────────────
  createPot: (chainId: number, factory: Address, p: { creator: Address; params: CreatePotParams; nonce: bigint; deadline: bigint }): TypedDataDefinition => ({
    domain: factoryDomain(chainId, factory),
    types: FACTORY_TYPES as never,
    primaryType: "CreatePot" as never,
    message: { creator: p.creator, paramsHash: paramsHash(p.params), nonce: p.nonce, deadline: p.deadline } as never,
  }),
  registerKey: (chainId: number, registry: Address, p: { account: Address; pubKey: Hex; deadline: bigint }): TypedDataDefinition => ({
    domain: keysDomain(chainId, registry),
    types: KEYS_TYPES as never,
    primaryType: "RegisterKey" as never,
    message: p as never,
  }),
  claim: (chainId: number, escrow: Address, p: { id: bigint; recipient: Address; toCountry: Hex }): TypedDataDefinition => ({
    domain: claimsDomain(chainId, escrow),
    types: CLAIMS_TYPES as never,
    primaryType: "Claim" as never,
    message: p as never,
  }),

  // ─────────────── AUSD ───────────────
  receiveWithAuthorization: (
    chainId: number,
    ausd: Address,
    p: { from: Address; to: Address; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex },
  ): TypedDataDefinition => ({
    domain: ausdDomain(chainId, ausd),
    types: { ReceiveWithAuthorization: AUSD_TYPES.ReceiveWithAuthorization } as never,
    primaryType: "ReceiveWithAuthorization" as never,
    message: p as never,
  }),
  permit: (
    chainId: number,
    ausd: Address,
    p: { owner: Address; spender: Address; value: bigint; nonce: bigint; deadline: bigint },
  ): TypedDataDefinition => ({
    domain: ausdDomain(chainId, ausd),
    types: { Permit: AUSD_TYPES.Permit } as never,
    primaryType: "Permit" as never,
    message: p as never,
  }),
};

/** keccak256 of an EIP-712 type string, for checks against the contracts' TYPEHASH constants. */
export function encodeTypeString(name: string, fields: readonly { name: string; type: string }[]): string {
  return `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;
}

export const keccakString = (s: string): Hex => keccak256(stringToHex(s));
