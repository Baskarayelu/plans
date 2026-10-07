/**
 * Signs every Plans action exactly like the app and posts it to the relayer.
 *
 * The EIP-712 builders, struct hashes, 3009 nonce bindings (sendAuthNonce, claimAuthNonce),
 * code helpers and the nonce allocator are imported straight from the app
 * (app/src/lib/chain/eip712.ts, app/src/lib/chain/nonces.ts), so a mismatch between the app and the
 * contracts shows up here as a failing signature. app/src/lib/chain/actions.ts itself imports React
 * Native config and the passkey session, so its glue (deadline choice, receiveAuth, permitFor,
 * keyRegFor, the request bodies) is mirrored below one for one. The only deliberate difference:
 * deadlines are taken from the fork's clock (which the harness moves forward) instead of the wall
 * clock, so they stay valid after time warps.
 */
import { parseSignature, type Address, type Hex, type LocalAccount, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  claimAuthNonce,
  codeToBytes,
  EMPTY_AUTH,
  EMPTY_KEYREG,
  EMPTY_PERMIT,
  sendAuthNonce,
  typed,
  ZERO_BYTES32,
  type Auth3009,
  type CreatePotParams,
  type DisputeOutcome,
  type KeyReg,
  type KeyWrapEntry,
  type Permit2612,
  type Rules,
  type SendMeta,
  type SpendKind,
  type Split,
} from "../../../app/src/lib/chain/eip712";
import { MemoryNonceStore, NonceAllocator } from "../../../app/src/lib/chain/nonces";
import { randomBytes, toHex } from "../../../app/src/lib/crypto/bytes";
import { artifact, CHAIN_ID, type Deployment } from "./env";

export { codeToBytes, EMPTY_AUTH, EMPTY_KEYREG, EMPTY_PERMIT, sendAuthNonce, claimAuthNonce, typed, ZERO_BYTES32 };
export type { Rules, Split, SendMeta, CreatePotParams, Auth3009, KeyWrapEntry };

export const USD = (x: number) => BigInt(Math.round(x * 1_000_000));
export const jsonStringify = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

export const ABI = {
  pot: artifact("Pot").abi,
  factory: artifact("PlansFactory").abi,
  escrow: artifact("ClaimEscrow").abi,
  keyRegistry: artifact("KeyRegistry").abi,
  plansSend: artifact("PlansSend").abi,
  ausd: [
    { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "nonces", stateMutability: "view", inputs: [{ name: "o", type: "address" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    {
      type: "function",
      name: "permit",
      stateMutability: "nonpayable",
      inputs: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "v", type: "uint8" },
        { name: "r", type: "bytes32" },
        { name: "s", type: "bytes32" },
      ],
      outputs: [],
    },
    { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
  ] as const,
};

// ───────────── HTTP client ─────────────

export interface RelayEvent {
  address: string;
  name: string;
  logIndex: number | null;
  args: Record<string, any>;
}
export interface RelayBody {
  action?: string;
  txHash?: Hex;
  blockNumber?: string;
  status?: "success" | "reverted";
  gasUsed?: string;
  gasLimit?: string;
  latencyMs?: number;
  totalMs?: number;
  lane?: number;
  sync?: boolean;
  events?: RelayEvent[];
  error?: { code: string; message: string; reason?: number; error?: string; issues?: unknown; [k: string]: unknown };
  [k: string]: unknown;
}
export interface HttpResult<T = RelayBody> {
  status: number;
  body: T;
  headers: Headers;
  clientMs: number;
  request?: { action: string; params: Record<string, unknown> };
}

export class Api {
  constructor(readonly base: string) {}

  async req<T = RelayBody>(method: string, path: string, init: { body?: string | Uint8Array; headers?: Record<string, string> } = {}): Promise<HttpResult<T>> {
    const t0 = performance.now();
    const r = await fetch(`${this.base}${path}`, { method, body: init.body as never, headers: init.headers });
    const ms = Math.round(performance.now() - t0);
    const ct = r.headers.get("content-type") ?? "";
    let body: unknown;
    if (ct.includes("application/json")) body = await r.json();
    else if (r.status === 304) body = null;
    else body = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, body: body as T, headers: r.headers, clientMs: ms };
  }

  get<T = any>(path: string, headers?: Record<string, string>) {
    return this.req<T>("GET", path, { headers });
  }

  async relay(action: string, params: Record<string, unknown>, opts: { ip?: string } = {}): Promise<HttpResult> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.ip) headers["x-forwarded-for"] = opts.ip;
    const r = await this.req("POST", "/v1/relay", { body: jsonStringify({ action, params }), headers });
    r.request = { action, params };
    return r;
  }

  postJson(path: string, body: unknown, opts: { ip?: string } = {}) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.ip) headers["x-forwarded-for"] = opts.ip;
    return this.req("POST", path, { body: typeof body === "string" ? body : jsonStringify(body), headers });
  }
}

export const findEvent = (r: HttpResult, name: string) => r.body.events?.find((e) => e.name === name);
export const findEvents = (r: HttpResult, name: string) => (r.body.events ?? []).filter((e) => e.name === name);

// ───────────── signing (mirrors app/src/lib/chain/actions.ts) ─────────────

export interface Ctx {
  pub: PublicClient;
  dep: Deployment;
  chainId: number;
  nonces: NonceAllocator;
}

export function makeCtx(pub: PublicClient, dep: Deployment): Ctx {
  return { pub, dep, chainId: CHAIN_ID, nonces: new NonceAllocator(new MemoryNonceStore()) };
}

export async function chainNow(ctx: Ctx): Promise<bigint> {
  const b = await ctx.pub.getBlock({ blockTag: "latest" });
  const wall = BigInt(Math.floor(Date.now() / 1000));
  return b.timestamp > wall ? b.timestamp : wall;
}

/** Same windows as the app: 30 min for actions, 1 h for 3009, 24 h for permits, 30 days for keys. */
export async function deadline(ctx: Ctx, sec = 1800): Promise<bigint> {
  return (await chainNow(ctx)) + BigInt(sec);
}

const sign = (a: LocalAccount, t: unknown) => a.signTypedData(t as never);

export interface SignOpts {
  nonce?: bigint;
  deadline?: bigint;
  /** sign with this account instead of the member's (bad-signature tests) */
  signer?: LocalAccount;
}

export async function receiveAuth(ctx: Ctx, a: LocalAccount, to: Address, value: bigint, o: { nonce?: Hex; validBefore?: bigint; signer?: LocalAccount } = {}): Promise<Auth3009> {
  if (value <= 0n) return EMPTY_AUTH;
  const n = o.nonce ?? toHex(randomBytes(32));
  const validBefore = o.validBefore ?? (await deadline(ctx, 3600));
  const signature = await sign(o.signer ?? a, typed.receiveWithAuthorization(ctx.chainId, ctx.dep.ausd, { from: a.address, to, value, validAfter: 0n, validBefore, nonce: n }));
  return { value, validAfter: 0n, validBefore, nonce: n, signature };
}

export async function permitFor(ctx: Ctx, a: LocalAccount, spender: Address, value: bigint): Promise<Permit2612> {
  if (value <= 0n) return EMPTY_PERMIT;
  const nonce = (await ctx.pub.readContract({ address: ctx.dep.ausd, abi: ABI.ausd, functionName: "nonces", args: [a.address] })) as bigint;
  const dl = await deadline(ctx, 24 * 3600);
  const sig = await sign(a, typed.permit(ctx.chainId, ctx.dep.ausd, { owner: a.address, spender, value, nonce, deadline: dl }));
  const p = parseSignature(sig);
  return { value, deadline: dl, v: Number(p.v ?? BigInt(27 + (p.yParity ?? 0))), r: p.r, s: p.s };
}

export async function keyRegFor(ctx: Ctx, a: LocalAccount, pubKey: Hex | null): Promise<KeyReg> {
  if (!pubKey) return EMPTY_KEYREG;
  const current = (await ctx.pub.readContract({ address: ctx.dep.keyRegistry, abi: ABI.keyRegistry, functionName: "keyOf", args: [a.address] })) as Hex;
  if (current.toLowerCase() === pubKey.toLowerCase()) return EMPTY_KEYREG;
  const dl = await deadline(ctx, 30 * 24 * 3600);
  const signature = await sign(a, typed.registerKey(ctx.chainId, ctx.dep.keyRegistry, { account: a.address, pubKey, deadline: dl }));
  return { pubKey, deadline: dl, signature };
}

async function nonceAndDeadline(ctx: Ctx, a: LocalAccount, o: SignOpts) {
  return { nonce: o.nonce ?? (await ctx.nonces.next(a.address)), dl: o.deadline ?? (await deadline(ctx)) };
}

export const randomHex32 = () => toHex(randomBytes(32));
export const invitee = () => privateKeyToAccount(toHex(randomBytes(32)));

/** Builders return the exact /v1/relay `params` the app would send. */
export const build = {
  async registerKey(ctx: Ctx, a: LocalAccount, pubKey: Hex, o: { deadline?: bigint; signer?: LocalAccount } = {}) {
    const dl = o.deadline ?? (await deadline(ctx, 30 * 24 * 3600));
    const sig = await sign(o.signer ?? a, typed.registerKey(ctx.chainId, ctx.dep.keyRegistry, { account: a.address, pubKey, deadline: dl }));
    return { account: a.address, pubKey, deadline: dl, sig };
  },

  async createPot(ctx: Ctx, a: LocalAccount, params: CreatePotParams, x: { deposit?: bigint; pubKey?: Hex | null; safetyNetValue?: bigint } & SignOpts = {}) {
    const { nonce, dl } = await nonceAndDeadline(ctx, a, x);
    const sig = await sign(x.signer ?? a, typed.createPot(ctx.chainId, ctx.dep.plansFactory, { creator: a.address, params, nonce, deadline: dl }));
    const pot = (await ctx.pub.readContract({ address: ctx.dep.plansFactory, abi: ABI.factory, functionName: "predictPot", args: [a.address, params.salt] })) as Address;
    const deposit = await receiveAuth(ctx, a, pot, x.deposit ?? 0n);
    const safetyNet = await permitFor(ctx, a, pot, x.safetyNetValue ?? params.creatorSafetyNet);
    const keyReg = await keyRegFor(ctx, a, x.pubKey ?? null);
    return { pot, params: { creator: a.address, params, nonce, deadline: dl, sig, deposit, safetyNet, keyReg } };
  },

  async join(ctx: Ctx, pot: Address, a: LocalAccount, invite: LocalAccount, x: { country?: string; deposit?: bigint; safetyNet?: bigint; pubKey?: Hex | null } & SignOpts = {}) {
    const { nonce, dl } = await nonceAndDeadline(ctx, a, x);
    const country = codeToBytes(x.country ?? "GB", 2);
    const safetyNetValue = x.safetyNet ?? 0n;
    const memberSig = await sign(x.signer ?? a, typed.join(ctx.chainId, pot, { member: a.address, country, safetyNet: safetyNetValue, nonce, deadline: dl }));
    const inviteSig = await invite.signTypedData(typed.invite(ctx.chainId, pot, a.address) as never);
    const deposit = await receiveAuth(ctx, a, pot, x.deposit ?? 0n);
    const safetyNet = await permitFor(ctx, a, pot, safetyNetValue);
    const keyReg = await keyRegFor(ctx, a, x.pubKey ?? null);
    return { pot, member: a.address, country, nonce, deadline: dl, memberSig, inviteSig, deposit, safetyNet, keyReg };
  },

  async contribute(ctx: Ctx, pot: Address, a: LocalAccount, amount: bigint, o: { validBefore?: bigint; signer?: LocalAccount } = {}) {
    return { pot, member: a.address, auth: await receiveAuth(ctx, a, pot, amount, o) };
  },

  async payDebt(ctx: Ctx, pot: Address, a: LocalAccount, amount: bigint) {
    return { pot, member: a.address, auth: await receiveAuth(ctx, a, pot, amount) };
  },

  async rotateInvite(ctx: Ctx, pot: Address, a: LocalAccount, newSigner: Address, o: SignOpts = {}) {
    const { nonce, dl } = await nonceAndDeadline(ctx, a, o);
    const sig = await sign(o.signer ?? a, typed.rotateInvite(ctx.chainId, pot, { member: a.address, newSigner, nonce, deadline: dl }));
    return { pot, member: a.address, newSigner, nonce, deadline: dl, sig };
  },

  async postKeyWraps(ctx: Ctx, pot: Address, a: LocalAccount, wraps: KeyWrapEntry[], o: SignOpts = {}) {
    const { nonce, dl } = await nonceAndDeadline(ctx, a, o);
    const sig = await sign(o.signer ?? a, typed.postKeyWraps(ctx.chainId, pot, { member: a.address, wraps, nonce, deadline: dl }));
    return { pot, member: a.address, wraps, nonce, deadline: dl, sig };
  },

  async propose(
    ctx: Ctx,
    pot: Address,
    a: LocalAccount,
    p: { kind: SpendKind; payee: Address; amount: bigint; category: number; split: Split; receiptHash?: Hex; memo?: Hex },
    o: SignOpts & { signAmount?: bigint } = {},
  ) {
    const { nonce, dl } = await nonceAndDeadline(ctx, a, o);
    const memo = p.memo ?? "0x";
    const receiptHash = p.receiptHash ?? ZERO_BYTES32;
    const sig = await sign(
      o.signer ?? a,
      typed.propose(ctx.chainId, pot, { proposer: a.address, kind: p.kind, payee: p.payee, amount: o.signAmount ?? p.amount, category: p.category, split: p.split, receiptHash, memo, nonce, deadline: dl }),
    );
    return { pot, proposer: a.address, kind: p.kind, payee: p.payee, amount: p.amount, category: p.category, split: p.split, receiptHash, memo, nonce, deadline: dl, sig };
  },

  async vote(ctx: Ctx, pot: Address, a: LocalAccount, id: bigint, approve: boolean, o: SignOpts = {}) {
    const { nonce, dl } = await nonceAndDeadline(ctx, a, o);
    const sig = await sign(o.signer ?? a, typed.vote(ctx.chainId, pot, { member: a.address, id, approve, nonce, deadline: dl }));
    return { pot, member: a.address, id, approve, nonce, deadline: dl, sig };
  },

  async cancelSpend(ctx: Ctx, pot: Address, a: LocalAccount, id: bigint, o: SignOpts = {}) {
    const { nonce, dl } = await nonceAndDeadline(ctx, a, o);
    const sig = await sign(o.signer ?? a, typed.cancelSpend(ctx.chainId, pot, { member: a.address, id, nonce, deadline: dl }));
    return { pot, member: a.address, id, nonce, deadline: dl, sig };
  },

  async openDispute(ctx: Ctx, pot: Address, a: LocalAccount, spendId: bigint, reason: number, memo: Hex = "0x", o: SignOpts = {}) {
    const { nonce, dl } = await nonceAndDeadline(ctx, a, o);
    const sig = await sign(o.signer ?? a, typed.openDispute(ctx.chainId, pot, { member: a.address, spendId, reason, memo, nonce, deadline: dl }));
    return { pot, member: a.address, spendId, reason, memo, nonce, deadline: dl, sig };
  },

  async resolveDispute(ctx: Ctx, pot: Address, a: LocalAccount, disputeId: bigint, outcome: DisputeOutcome, split: Split, o: SignOpts = {}) {
    const { nonce, dl } = await nonceAndDeadline(ctx, a, o);
    const sig = await sign(o.signer ?? a, typed.resolveDispute(ctx.chainId, pot, { member: a.address, disputeId, outcome, split, nonce, deadline: dl }));
    return { pot, member: a.address, disputeId, outcome, split, nonce, deadline: dl, sig };
  },

  async voteDispute(ctx: Ctx, pot: Address, a: LocalAccount, disputeId: bigint, spenderCovers: boolean, o: SignOpts = {}) {
    const { nonce, dl } = await nonceAndDeadline(ctx, a, o);
    const sig = await sign(o.signer ?? a, typed.disputeVote(ctx.chainId, pot, { member: a.address, disputeId, spenderCovers, nonce, deadline: dl }));
    return { pot, member: a.address, disputeId, spenderCovers, nonce, deadline: dl, sig };
  },

  async freeze(ctx: Ctx, pot: Address, a: LocalAccount, o: SignOpts = {}) {
    const { nonce, dl } = await nonceAndDeadline(ctx, a, o);
    const sig = await sign(o.signer ?? a, typed.freeze(ctx.chainId, pot, { member: a.address, nonce, deadline: dl }));
    return { pot, member: a.address, nonce, deadline: dl, sig };
  },

  async voteUnfreeze(ctx: Ctx, pot: Address, a: LocalAccount, o: SignOpts = {}) {
    const { nonce, dl } = await nonceAndDeadline(ctx, a, o);
    const sig = await sign(o.signer ?? a, typed.unfreezeVote(ctx.chainId, pot, { member: a.address, nonce, deadline: dl }));
    return { pot, member: a.address, nonce, deadline: dl, sig };
  },

  async proposeRules(ctx: Ctx, pot: Address, a: LocalAccount, rules: Rules, allowAdd: Address[] = [], allowRemove: Address[] = [], o: SignOpts = {}) {
    const { nonce, dl } = await nonceAndDeadline(ctx, a, o);
    const sig = await sign(o.signer ?? a, typed.proposeRules(ctx.chainId, pot, { member: a.address, rules, allowAdd, allowRemove, nonce, deadline: dl }));
    return { pot, member: a.address, rules, allowAdd, allowRemove, nonce, deadline: dl, sig };
  },

  async voteRules(ctx: Ctx, pot: Address, a: LocalAccount, id: bigint, approve: boolean, o: SignOpts = {}) {
    const { nonce, dl } = await nonceAndDeadline(ctx, a, o);
    const sig = await sign(o.signer ?? a, typed.voteRules(ctx.chainId, pot, { member: a.address, id, approve, nonce, deadline: dl }));
    return { pot, member: a.address, id, approve, nonce, deadline: dl, sig };
  },

  async exit(ctx: Ctx, pot: Address, a: LocalAccount, o: SignOpts = {}) {
    const { nonce, dl } = await nonceAndDeadline(ctx, a, o);
    const sig = await sign(o.signer ?? a, typed.exit(ctx.chainId, pot, { member: a.address, nonce, deadline: dl }));
    return { pot, member: a.address, nonce, deadline: dl, sig };
  },

  async ack(ctx: Ctx, pot: Address, a: LocalAccount, o: SignOpts = {}) {
    const { nonce, dl } = await nonceAndDeadline(ctx, a, o);
    const sig = await sign(o.signer ?? a, typed.ack(ctx.chainId, pot, { member: a.address, nonce, deadline: dl }));
    return { pot, member: a.address, nonce, deadline: dl, sig };
  },

  /** PlansSend: the 3009 nonce = keccak256(abi.encode(meta)) (app sendAuthNonce). */
  async send(ctx: Ctx, a: LocalAccount, amount: bigint, meta: SendMeta, o: { signedMeta?: SendMeta } = {}) {
    const auth = await receiveAuth(ctx, a, ctx.dep.plansSend, amount, { nonce: sendAuthNonce(o.signedMeta ?? meta) });
    return { from: a.address, meta, auth };
  },

  /** Send-by-link: the 3009 nonce = keccak256(abi.encode(claimSigner, expiry, fromCountry, salt)) (app claimAuthNonce). */
  async claimCreate(ctx: Ctx, a: LocalAccount, amount: bigint, claimSigner: Address, expiry: bigint, fromCountry: string, o: { boundSigner?: Address } = {}) {
    const fc = codeToBytes(fromCountry, 2);
    const salt = randomHex32();
    const auth = await receiveAuth(ctx, a, ctx.dep.claimEscrow, amount, { nonce: claimAuthNonce(o.boundSigner ?? claimSigner, expiry, fc, salt) });
    return { from: a.address, claimSigner, expiry, fromCountry: fc, salt, auth };
  },

  async claim(ctx: Ctx, id: bigint, claimKey: LocalAccount, recipient: Address, toCountry: string) {
    const tc = codeToBytes(toCountry, 2);
    const claimSig = await claimKey.signTypedData(typed.claim(ctx.chainId, ctx.dep.claimEscrow, { id, recipient, toCountry: tc }) as never);
    return { id, recipient, toCountry: tc, claimSig };
  },
};

// ───────────── rules helpers ─────────────

export const HOUR = 3600;
export const DAY = 86400;

export function rules(over: Partial<Rules> = {}): Rules {
  return {
    instantMax: USD(25),
    oneApprovalMax: USD(200),
    highTier: 0,
    memberDailyCap: 0n,
    memberTotalCap: 0n,
    payeePolicy: 0,
    minContribution: 0n,
    proposalTtl: HOUR,
    ruleTimelock: 600,
    categoryBudgets: [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
    ...over,
  } as Rules;
}

export async function potParams(ctx: Ctx, invite: Address, over: Partial<CreatePotParams> & { endIn?: number; startIn?: number } = {}): Promise<CreatePotParams> {
  const now = await chainNow(ctx);
  const blockTs = (await ctx.pub.getBlock({ blockTag: "latest" })).timestamp;
  const { endIn, startIn, ...rest } = over;
  return {
    rules: rules(),
    // A start in the past is treated as "now" by the Pot. Using the wall clock here can land a few
    // seconds ahead of the chain, which leaves the plan "not open" (SpendBlocked 2) for those seconds.
    startTime: startIn ? now + BigInt(startIn) : blockTs - 60n,
    endTime: now + BigInt(endIn ?? 30 * DAY),
    reviewWindow: DAY,
    inviteSigner: invite,
    creatorCountry: codeToBytes("GB", 2),
    creatorSafetyNet: 0n,
    meta: "0x00" as Hex,
    creatorKeyWrap: "0x" as Hex,
    inviteKeyWrap: "0x" as Hex,
    salt: randomHex32(),
    ...rest,
  };
}
