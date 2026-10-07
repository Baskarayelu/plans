/**
 * Every relayable action: its zod params schema, target contract, and calldata builder.
 * Params mirror the Solidity function arguments 1:1 (see contracts/src/interfaces).
 * Integers may be decimal strings, numbers or 0x-hex; bytes are 0x-hex.
 */
import { encodeFunctionData, getAddress, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { claimEscrowAbi, factoryAbi, keyRegistryAbi, plansSendAbi, potAbi } from "./abi.js";
import { asciiToBytes, EMPTY_AUTH, EMPTY_KEYREG, EMPTY_PERMIT, ZERO_BYTES32 } from "./eip712.js";

export const MAX_MEMBERS = 50;
export const MAX_BLOB_BYTES = 512; // memo / meta / key-wrap
export const MAX_SIG_BYTES = 4096; // ERC-1271 / WebAuthn signatures can be long

// ───────────── primitives ─────────────

export const zAddress = z
  .string()
  .refine((v) => isAddress(v, { strict: false }), "must be a 20-byte 0x address")
  .transform((v) => getAddress(v));

export const zHex = (maxBytes: number) =>
  z
    .string()
    .regex(/^0x([0-9a-fA-F]{2})*$/, "must be 0x-prefixed hex bytes")
    .refine((v) => (v.length - 2) / 2 <= maxBytes, `must be at most ${maxBytes} bytes`)
    .transform((v) => v.toLowerCase() as Hex);

export const zBytes32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "must be 32 bytes of 0x hex")
  .transform((v) => v.toLowerCase() as Hex);

/** bytesN code: either 0x hex of N bytes or an ASCII code like "GB" / "GBP". */
const zCode = (n: number) =>
  z.string().transform((v, ctx) => {
    if (new RegExp(`^0x[0-9a-fA-F]{${n * 2}}$`).test(v)) return v.toLowerCase() as Hex;
    if (new RegExp(`^[A-Z]{${n}}$`).test(v)) return asciiToBytes(v);
    ctx.addIssue({ code: "custom", message: `must be a ${n}-letter uppercase code or ${n} bytes of hex` });
    return z.NEVER;
  });
export const zCountry = zCode(2);
export const zCurrency = zCode(3);

export const zUint = (bits = 256) =>
  z.union([z.string(), z.number(), z.bigint()]).transform((v, ctx) => {
    let b: bigint;
    try {
      if (typeof v === "number") {
        if (!Number.isSafeInteger(v)) throw new Error();
        b = BigInt(v);
      } else if (typeof v === "string") {
        if (!/^(0x[0-9a-fA-F]+|\d+)$/.test(v)) throw new Error();
        b = BigInt(v);
      } else b = v;
    } catch {
      ctx.addIssue({ code: "custom", message: "must be a non-negative integer (decimal string, number or 0x hex)" });
      return z.NEVER;
    }
    if (b < 0n || b >= 1n << BigInt(bits)) {
      ctx.addIssue({ code: "custom", message: `out of range for uint${bits}` });
      return z.NEVER;
    }
    return b;
  });
const zSmall = (bits: number) => zUint(bits).transform((v) => Number(v));

const zEnum = (names: readonly string[]) =>
  z.union([z.number().int(), z.string()]).transform((v, ctx) => {
    const i = typeof v === "number" ? v : /^\d+$/.test(v) ? Number(v) : names.indexOf(v.toUpperCase());
    if (i < 0 || i >= names.length) {
      ctx.addIssue({ code: "custom", message: `must be one of ${names.join(", ")} (or 0..${names.length - 1})` });
      return z.NEVER;
    }
    return i;
  });

const zSig = zHex(MAX_SIG_BYTES).refine((v) => v.length > 2, "signature is required");
const zBlob = zHex(MAX_BLOB_BYTES);

export const zAuth3009 = z
  .object({
    value: zUint(),
    validAfter: zUint().default(0n),
    validBefore: zUint(),
    nonce: zBytes32,
    signature: zHex(MAX_SIG_BYTES),
  })
  .optional()
  .transform((v) => v ?? EMPTY_AUTH);

export const zPermit = z
  .object({ value: zUint(), deadline: zUint(), v: zSmall(8), r: zBytes32, s: zBytes32 })
  .optional()
  .transform((v) => v ?? EMPTY_PERMIT);

export const zKeyReg = z
  .object({ pubKey: zBytes32, deadline: zUint(), signature: zHex(MAX_SIG_BYTES) })
  .optional()
  .transform((v) => v ?? EMPTY_KEYREG);

export const zSplit = z
  .object({
    members: z.array(zAddress).max(MAX_MEMBERS),
    weights: z.array(zSmall(32)).max(MAX_MEMBERS),
  })
  .superRefine((s, ctx) => {
    if (s.members.length !== s.weights.length) ctx.addIssue({ code: "custom", message: "members and weights must have the same length" });
    if (new Set(s.members).size !== s.members.length) ctx.addIssue({ code: "custom", message: "duplicate member in split" });
    if (s.weights.some((w) => w === 0)) ctx.addIssue({ code: "custom", message: "weights must be greater than zero" });
  });

export const zRules = z.object({
  instantMax: zUint(64),
  oneApprovalMax: zUint(64),
  highTier: zEnum(["MAJORITY", "ALL"]),
  memberDailyCap: zUint(64),
  memberTotalCap: zUint(64),
  payeePolicy: zEnum(["ANYONE", "MEMBERS_ONLY", "MEMBERS_AND_ALLOWLIST"]),
  minContribution: zUint(64),
  proposalTtl: zSmall(32),
  ruleTimelock: zSmall(32),
  categoryBudgets: z.array(zUint(64)).length(8),
});

export const zCreatePotParams = z.object({
  rules: zRules,
  startTime: zUint(64),
  endTime: zUint(64),
  reviewWindow: zSmall(32),
  inviteSigner: zAddress,
  creatorCountry: zCountry,
  creatorSafetyNet: zUint().default(0n),
  meta: zBlob.default("0x"),
  creatorKeyWrap: zBlob.default("0x"),
  inviteKeyWrap: zBlob.default("0x"),
  salt: zBytes32,
});

const pot = { pot: zAddress };
const signed = { nonce: zUint(), deadline: zUint(), sig: zSig };

// ───────────── action table ─────────────

export type Target = "factory" | "keyRegistry" | "claimEscrow" | "plansSend" | "pot";

interface ActionDef<S extends z.ZodTypeAny> {
  target: Target;
  schema: S;
  /** function name + args for encodeFunctionData */
  call: (p: z.output<S>) => { abi: readonly unknown[]; functionName: string; args: readonly unknown[] };
  /** the account the action is on behalf of (for per-address rate limits) */
  actor?: (p: z.output<S>) => Address | undefined;
  /** unix seconds after which the action is certainly dead, for a fast pre-check */
  deadline?: (p: z.output<S>) => bigint | undefined;
}

function def<S extends z.ZodTypeAny>(d: ActionDef<S>) {
  return d;
}

const memberOnly = z.object({ ...pot, member: zAddress, ...signed });
const potId = z.object({ ...pot, id: zUint() });

export const ACTIONS = {
  createPot: def({
    target: "factory",
    schema: z.object({
      creator: zAddress,
      params: zCreatePotParams,
      ...signed,
      deposit: zAuth3009,
      safetyNet: zPermit,
      keyReg: zKeyReg,
    }),
    call: (p) => ({
      abi: factoryAbi,
      functionName: "createPot",
      args: [p.creator, p.params, p.nonce, p.deadline, p.sig, p.deposit, p.safetyNet, p.keyReg],
    }),
    actor: (p) => p.creator,
    deadline: (p) => p.deadline,
  }),
  join: def({
    target: "pot",
    schema: z.object({
      ...pot,
      member: zAddress,
      country: zCountry,
      nonce: zUint(),
      deadline: zUint(),
      memberSig: zSig,
      inviteSig: zSig,
      deposit: zAuth3009,
      safetyNet: zPermit,
      keyReg: zKeyReg,
    }),
    call: (p) => ({
      abi: potAbi,
      functionName: "join",
      args: [p.member, p.country, p.nonce, p.deadline, p.memberSig, p.inviteSig, p.deposit, p.safetyNet, p.keyReg],
    }),
    actor: (p) => p.member,
    deadline: (p) => p.deadline,
  }),
  contribute: def({
    target: "pot",
    schema: z.object({ ...pot, member: zAddress, auth: zAuth3009.refine((a) => a.value > 0n, "auth is required") }),
    call: (p) => ({ abi: potAbi, functionName: "contribute", args: [p.member, p.auth] }),
    actor: (p) => p.member,
    deadline: (p) => p.auth.validBefore,
  }),
  rotateInvite: def({
    target: "pot",
    schema: z.object({ ...pot, member: zAddress, newSigner: zAddress, ...signed }),
    call: (p) => ({ abi: potAbi, functionName: "rotateInvite", args: [p.member, p.newSigner, p.nonce, p.deadline, p.sig] }),
    actor: (p) => p.member,
    deadline: (p) => p.deadline,
  }),
  postKeyWraps: def({
    target: "pot",
    schema: z.object({
      ...pot,
      member: zAddress,
      wraps: z.array(z.object({ member: zAddress, wrap: zBlob })).min(1).max(MAX_MEMBERS),
      ...signed,
    }),
    call: (p) => ({ abi: potAbi, functionName: "postKeyWraps", args: [p.member, p.wraps, p.nonce, p.deadline, p.sig] }),
    actor: (p) => p.member,
    deadline: (p) => p.deadline,
  }),
  propose: def({
    target: "pot",
    schema: z.object({
      ...pot,
      proposer: zAddress,
      kind: zEnum(["PAY", "LINK", "PERSONAL"]),
      payee: zAddress,
      amount: zUint().refine((a) => a > 0n, "amount must be above zero"),
      category: zSmall(8).refine((c) => c <= 7, "category must be 0..7"),
      split: zSplit.refine((s) => s.members.length > 0, "split must not be empty"),
      receiptHash: zBytes32.default(ZERO_BYTES32),
      memo: zBlob.default("0x"),
      ...signed,
    }),
    call: (p) => ({
      abi: potAbi,
      functionName: "propose",
      args: [p.proposer, p.kind, p.payee, p.amount, p.category, p.split, p.receiptHash, p.memo, p.nonce, p.deadline, p.sig],
    }),
    actor: (p) => p.proposer,
    deadline: (p) => p.deadline,
  }),
  vote: def({
    target: "pot",
    schema: z.object({ ...pot, member: zAddress, id: zUint(), approve: z.boolean(), ...signed }),
    call: (p) => ({ abi: potAbi, functionName: "vote", args: [p.member, p.id, p.approve, p.nonce, p.deadline, p.sig] }),
    actor: (p) => p.member,
    deadline: (p) => p.deadline,
  }),
  cancelSpend: def({
    target: "pot",
    schema: z.object({ ...pot, member: zAddress, id: zUint(), ...signed }),
    call: (p) => ({ abi: potAbi, functionName: "cancelSpend", args: [p.member, p.id, p.nonce, p.deadline, p.sig] }),
    actor: (p) => p.member,
    deadline: (p) => p.deadline,
  }),
  execute: def({ target: "pot", schema: potId, call: (p) => ({ abi: potAbi, functionName: "execute", args: [p.id] }) }),
  expire: def({ target: "pot", schema: potId, call: (p) => ({ abi: potAbi, functionName: "expire", args: [p.id] }) }),
  openDispute: def({
    target: "pot",
    schema: z.object({
      ...pot,
      member: zAddress,
      spendId: zUint(),
      reason: zSmall(8).refine((r) => r <= 2, "reason must be 0 (wrong amount), 1 (wrong split) or 2 (not a group cost)"),
      memo: zBlob.default("0x"),
      ...signed,
    }),
    call: (p) => ({
      abi: potAbi,
      functionName: "openDispute",
      args: [p.member, p.spendId, p.reason, p.memo, p.nonce, p.deadline, p.sig],
    }),
    actor: (p) => p.member,
    deadline: (p) => p.deadline,
  }),
  resolveDispute: def({
    target: "pot",
    schema: z.object({
      ...pot,
      member: zAddress,
      disputeId: zUint(),
      outcome: zEnum(["NONE", "KEEP", "RESPLIT", "SPENDERCOVERS"]).refine((o) => o === 2 || o === 3, "outcome must be RESPLIT (2) or SPENDERCOVERS (3)"),
      split: zSplit.default({ members: [], weights: [] }),
      ...signed,
    }),
    call: (p) => ({
      abi: potAbi,
      functionName: "resolveDispute",
      args: [p.member, p.disputeId, p.outcome, p.split, p.nonce, p.deadline, p.sig],
    }),
    actor: (p) => p.member,
    deadline: (p) => p.deadline,
  }),
  voteDispute: def({
    target: "pot",
    schema: z.object({ ...pot, member: zAddress, disputeId: zUint(), spenderCovers: z.boolean(), ...signed }),
    call: (p) => ({
      abi: potAbi,
      functionName: "voteDispute",
      args: [p.member, p.disputeId, p.spenderCovers, p.nonce, p.deadline, p.sig],
    }),
    actor: (p) => p.member,
    deadline: (p) => p.deadline,
  }),
  finalizeDispute: def({
    target: "pot",
    schema: z.object({ ...pot, disputeId: zUint() }),
    call: (p) => ({ abi: potAbi, functionName: "finalizeDispute", args: [p.disputeId] }),
  }),
  freeze: def({
    target: "pot",
    schema: memberOnly,
    call: (p) => ({ abi: potAbi, functionName: "freeze", args: [p.member, p.nonce, p.deadline, p.sig] }),
    actor: (p) => p.member,
    deadline: (p) => p.deadline,
  }),
  voteUnfreeze: def({
    target: "pot",
    schema: memberOnly,
    call: (p) => ({ abi: potAbi, functionName: "voteUnfreeze", args: [p.member, p.nonce, p.deadline, p.sig] }),
    actor: (p) => p.member,
    deadline: (p) => p.deadline,
  }),
  proposeRules: def({
    target: "pot",
    schema: z.object({
      ...pot,
      member: zAddress,
      rules: zRules,
      allowAdd: z.array(zAddress).max(MAX_MEMBERS).default([]),
      allowRemove: z.array(zAddress).max(MAX_MEMBERS).default([]),
      ...signed,
    }),
    call: (p) => ({
      abi: potAbi,
      functionName: "proposeRules",
      args: [p.member, p.rules, p.allowAdd, p.allowRemove, p.nonce, p.deadline, p.sig],
    }),
    actor: (p) => p.member,
    deadline: (p) => p.deadline,
  }),
  voteRules: def({
    target: "pot",
    schema: z.object({ ...pot, member: zAddress, id: zUint(), approve: z.boolean(), ...signed }),
    call: (p) => ({ abi: potAbi, functionName: "voteRules", args: [p.member, p.id, p.approve, p.nonce, p.deadline, p.sig] }),
    actor: (p) => p.member,
    deadline: (p) => p.deadline,
  }),
  applyRules: def({ target: "pot", schema: potId, call: (p) => ({ abi: potAbi, functionName: "applyRules", args: [p.id] }) }),
  exit: def({
    target: "pot",
    schema: memberOnly,
    call: (p) => ({ abi: potAbi, functionName: "exit", args: [p.member, p.nonce, p.deadline, p.sig] }),
    actor: (p) => p.member,
    deadline: (p) => p.deadline,
  }),
  ack: def({
    target: "pot",
    schema: memberOnly,
    call: (p) => ({ abi: potAbi, functionName: "ack", args: [p.member, p.nonce, p.deadline, p.sig] }),
    actor: (p) => p.member,
    deadline: (p) => p.deadline,
  }),
  settle: def({ target: "pot", schema: z.object(pot), call: () => ({ abi: potAbi, functionName: "settle", args: [] }) }),
  payDebt: def({
    target: "pot",
    schema: z.object({ ...pot, member: zAddress, auth: zAuth3009.refine((a) => a.value > 0n, "auth is required") }),
    call: (p) => ({ abi: potAbi, functionName: "payDebt", args: [p.member, p.auth] }),
    actor: (p) => p.member,
    deadline: (p) => p.auth.validBefore,
  }),
  // After settlement, pays `member` (only) what the pot still owes them. Permissionless and
  // unsigned like settle/execute: it can only ever pay `member`, so anyone may submit it.
  collect: def({
    target: "pot",
    schema: z.object({ ...pot, member: zAddress }),
    call: (p) => ({ abi: potAbi, functionName: "collect", args: [p.member] }),
    actor: (p) => p.member,
  }),
  registerKey: def({
    target: "keyRegistry",
    schema: z.object({ account: zAddress, pubKey: zBytes32, deadline: zUint(), sig: zSig }),
    call: (p) => ({ abi: keyRegistryAbi, functionName: "register", args: [p.account, p.pubKey, p.deadline, p.sig] }),
    actor: (p) => p.account,
    deadline: (p) => p.deadline,
  }),
  send: def({
    target: "plansSend",
    schema: z.object({
      from: zAddress,
      meta: z.object({
        to: zAddress,
        fromCountry: zCountry,
        toCountry: zCountry,
        fromCurrency: zCurrency,
        toCurrency: zCurrency,
        fxRateE8: zUint(64),
        fxTimestamp: zUint(64),
        // FxReference round the app quoted from; 0 = no reference. Absent = 0 so older clients
        // still validate. The 3009 nonce is keccak256(abi.encode(meta)) over every field, so the
        // app must send exactly the fxRoundId it hashed (a mismatch reverts as a bad authorisation).
        fxRoundId: zUint(64).default(0n),
        memoHash: zBytes32.default(ZERO_BYTES32),
        salt: zBytes32,
      }),
      auth: zAuth3009.refine((a) => a.value > 0n, "auth is required"),
    }),
    call: (p) => ({ abi: plansSendAbi, functionName: "send", args: [p.from, p.meta, p.auth] }),
    actor: (p) => p.from,
    deadline: (p) => p.auth.validBefore,
  }),
  claimCreate: def({
    target: "claimEscrow",
    schema: z.object({
      from: zAddress,
      claimSigner: zAddress,
      expiry: zUint(64),
      fromCountry: zCountry,
      salt: zBytes32,
      auth: zAuth3009.refine((a) => a.value > 0n, "auth is required"),
    }),
    call: (p) => ({
      abi: claimEscrowAbi,
      functionName: "createWithAuthorization",
      args: [p.from, p.claimSigner, p.expiry, p.fromCountry, p.salt, p.auth],
    }),
    actor: (p) => p.from,
    deadline: (p) => p.auth.validBefore,
  }),
  claim: def({
    target: "claimEscrow",
    schema: z.object({ id: zUint(), recipient: zAddress, toCountry: zCountry, claimSig: zSig }),
    call: (p) => ({ abi: claimEscrowAbi, functionName: "claim", args: [p.id, p.recipient, p.toCountry, p.claimSig] }),
    actor: (p) => p.recipient,
  }),
  claimRefund: def({
    target: "claimEscrow",
    schema: z.object({ id: zUint() }),
    call: (p) => ({ abi: claimEscrowAbi, functionName: "refund", args: [p.id] }),
  }),
} as const;

export type ActionName = keyof typeof ACTIONS;
export const ACTION_NAMES = Object.keys(ACTIONS) as ActionName[];

export const relayBodySchema = z.object({
  action: z.enum(ACTION_NAMES as [ActionName, ...ActionName[]]),
  params: z.record(z.string(), z.unknown()),
});

export interface PreparedAction {
  action: ActionName;
  target: Target;
  pot?: Address;
  data: Hex;
  actor?: Address;
  deadline?: bigint;
  params: Record<string, unknown>;
}

export class ValidationError extends Error {
  constructor(public issues: { path: string; message: string }[]) {
    super(issues.map((i) => `${i.path || "(root)"}: ${i.message}`).join("; "));
  }
}

/** Validate an {action, params} body and encode calldata. Throws ValidationError. */
export function prepareAction(body: unknown): PreparedAction {
  const outer = relayBodySchema.safeParse(body);
  if (!outer.success) {
    throw new ValidationError(outer.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const action = outer.data.action;
  const d = ACTIONS[action] as unknown as ActionDef<z.ZodTypeAny>;
  const parsed = d.schema.safeParse(outer.data.params);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => ({ path: ["params", ...i.path].join("."), message: i.message })));
  }
  const p = parsed.data as Record<string, unknown>;
  const c = d.call(p);
  const data = (encodeFunctionData as (x: unknown) => Hex)({ abi: c.abi, functionName: c.functionName, args: c.args });
  return {
    action,
    target: d.target,
    pot: d.target === "pot" ? (p.pot as Address) : undefined,
    data,
    actor: d.actor?.(p),
    deadline: d.deadline?.(p),
    params: p,
  };
}
