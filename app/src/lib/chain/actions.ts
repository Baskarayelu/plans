/**
 * Every member action: build the EIP-712 message, sign it with the Mera session (no prompt),
 * and hand it to the relayer. Nonces come from the 248-bit-prefix allocator (gas), and a
 * "nonce already used" answer rotates the prefix and retries once.
 */
import { keccak256, parseSignature, type Address, type Hex, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../../config";
import { relay, RelayError, type RelayResult } from "../api/relayer";
import { randomBytes, toHex } from "../crypto/bytes";
import { currentAccount } from "../identity/session";
import { secureNonceStore } from "../state/storage";
import { factoryAbi } from "./abi";
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
} from "./eip712";
import { NonceAllocator } from "./nonces";
import { ausdPermitNonce, registeredKey, rpc } from "./rpc";

export const nonces = new NonceAllocator(secureNonceStore);

const nowSec = () => Math.floor(Date.now() / 1000);
const deadline = (sec = 1800) => BigInt(nowSec() + sec);
const chainId = () => config.chainId;

function me(): LocalAccount {
  return currentAccount();
}

const sign = (a: LocalAccount, t: Parameters<LocalAccount["signTypedData"]>[0]) => a.signTypedData(t);

/** Runs a nonce-signed action; on a used nonce, rotates the prefix and retries once. */
async function withNonce<T>(account: Address, f: (nonce: bigint) => Promise<T>): Promise<T> {
  try {
    return await f(await nonces.next(account));
  } catch (e) {
    if (e instanceof RelayError && /NONCE/.test(e.code)) {
      await nonces.rotate(account);
      return f(await nonces.next(account));
    }
    throw e;
  }
}

// ─────────────── AUSD authorisations ───────────────

export async function receiveAuth(a: LocalAccount, to: Address, value: bigint, nonce?: Hex, validSec = 3600): Promise<Auth3009> {
  if (value <= 0n) return EMPTY_AUTH;
  const n = nonce ?? toHex(randomBytes(32));
  const validBefore = deadline(validSec);
  const signature = await sign(a, typed.receiveWithAuthorization(chainId(), config.contracts.ausd, { from: a.address, to, value, validAfter: 0n, validBefore, nonce: n }));
  return { value, validAfter: 0n, validBefore, nonce: n, signature };
}

export async function permitFor(a: LocalAccount, spender: Address, value: bigint): Promise<Permit2612> {
  if (value <= 0n) return EMPTY_PERMIT;
  const nonce = await ausdPermitNonce(a.address);
  const dl = deadline(24 * 3600);
  const sig = await sign(a, typed.permit(chainId(), config.contracts.ausd, { owner: a.address, spender, value, nonce, deadline: dl }));
  const p = parseSignature(sig);
  return { value, deadline: dl, v: Number(p.v ?? BigInt(27 + (p.yParity ?? 0))), r: p.r, s: p.s };
}

export async function keyRegFor(a: LocalAccount, pubKey: Hex | null): Promise<KeyReg> {
  if (!pubKey) return EMPTY_KEYREG;
  const current = await registeredKey(a.address).catch(() => null);
  if (current && current.toLowerCase() === pubKey.toLowerCase()) return EMPTY_KEYREG;
  const dl = deadline(30 * 24 * 3600);
  const signature = await sign(a, typed.registerKey(chainId(), config.contracts.keyRegistry, { account: a.address, pubKey, deadline: dl }));
  return { pubKey, deadline: dl, signature };
}

// ─────────────── key registry ───────────────

export async function registerKey(pubKey: Hex): Promise<RelayResult | null> {
  const a = me();
  const reg = await keyRegFor(a, pubKey);
  if (reg.pubKey === ZERO_BYTES32) return null;
  return relay("registerKey", { account: a.address, pubKey: reg.pubKey, deadline: reg.deadline, sig: reg.signature });
}

// ─────────────── factory ───────────────

export async function predictPot(creator: Address, salt: Hex): Promise<Address> {
  return (await rpc().readContract({ address: config.contracts.plansFactory, abi: factoryAbi, functionName: "predictPot", args: [creator, salt] })) as Address;
}

export async function createPot(p: { params: CreatePotParams; pot: Address; deposit: bigint; pubKey: Hex | null }): Promise<RelayResult> {
  const a = me();
  return withNonce(a.address, async (nonce) => {
    const dl = deadline();
    const sig = await sign(a, typed.createPot(chainId(), config.contracts.plansFactory, { creator: a.address, params: p.params, nonce, deadline: dl }));
    const deposit = await receiveAuth(a, p.pot, p.deposit);
    const safetyNet = await permitFor(a, p.pot, p.params.creatorSafetyNet);
    const keyReg = await keyRegFor(a, p.pubKey);
    return relay("createPot", { creator: a.address, params: p.params, nonce, deadline: dl, sig, deposit, safetyNet, keyReg });
  });
}

// ─────────────── pot: membership ───────────────

export async function join(p: { pot: Address; inviteSecret: Uint8Array; country: string; deposit: bigint; safetyNet: bigint; pubKey: Hex | null }): Promise<RelayResult> {
  const a = me();
  const invite = privateKeyToAccount(toHex(p.inviteSecret));
  return withNonce(a.address, async (nonce) => {
    const dl = deadline();
    const country = codeToBytes(p.country, 2);
    const memberSig = await sign(a, typed.join(chainId(), p.pot, { member: a.address, country, safetyNet: p.safetyNet, nonce, deadline: dl }));
    const inviteSig = await invite.signTypedData(typed.invite(chainId(), p.pot, a.address) as never);
    const deposit = await receiveAuth(a, p.pot, p.deposit);
    const safetyNet = await permitFor(a, p.pot, p.safetyNet);
    const keyReg = await keyRegFor(a, p.pubKey);
    return relay("join", { pot: p.pot, member: a.address, country, nonce, deadline: dl, memberSig, inviteSig, deposit, safetyNet, keyReg });
  });
}

export async function contribute(pot: Address, amount: bigint): Promise<RelayResult> {
  const a = me();
  const auth = await receiveAuth(a, pot, amount);
  return relay("contribute", { pot, member: a.address, auth });
}

export async function payDebt(pot: Address, amount: bigint): Promise<RelayResult> {
  const a = me();
  const auth = await receiveAuth(a, pot, amount);
  return relay("payDebt", { pot, member: a.address, auth });
}

export async function rotateInvite(pot: Address, newSigner: Address): Promise<RelayResult> {
  const a = me();
  return withNonce(a.address, async (nonce) => {
    const dl = deadline();
    const sig = await sign(a, typed.rotateInvite(chainId(), pot, { member: a.address, newSigner, nonce, deadline: dl }));
    return relay("rotateInvite", { pot, member: a.address, newSigner, nonce, deadline: dl, sig });
  });
}

export async function postKeyWraps(pot: Address, wraps: KeyWrapEntry[]): Promise<RelayResult> {
  const a = me();
  return withNonce(a.address, async (nonce) => {
    const dl = deadline();
    const sig = await sign(a, typed.postKeyWraps(chainId(), pot, { member: a.address, wraps, nonce, deadline: dl }));
    return relay("postKeyWraps", { pot, member: a.address, wraps, nonce, deadline: dl, sig });
  });
}

// ─────────────── pot: spending ───────────────

export async function propose(p: { pot: Address; kind: SpendKind; payee: Address; amount: bigint; category: number; split: Split; receiptHash?: Hex; memo?: Hex }): Promise<RelayResult> {
  const a = me();
  const memo = p.memo ?? "0x";
  const receiptHash = p.receiptHash ?? ZERO_BYTES32;
  return withNonce(a.address, async (nonce) => {
    const dl = deadline();
    const sig = await sign(
      a,
      typed.propose(chainId(), p.pot, { proposer: a.address, kind: p.kind, payee: p.payee, amount: p.amount, category: p.category, split: p.split, receiptHash, memo, nonce, deadline: dl }),
    );
    return relay("propose", { pot: p.pot, proposer: a.address, kind: p.kind, payee: p.payee, amount: p.amount, category: p.category, split: p.split, receiptHash, memo, nonce, deadline: dl, sig });
  });
}

export async function vote(pot: Address, id: bigint, approve: boolean): Promise<RelayResult> {
  const a = me();
  return withNonce(a.address, async (nonce) => {
    const dl = deadline();
    const sig = await sign(a, typed.vote(chainId(), pot, { member: a.address, id, approve, nonce, deadline: dl }));
    return relay("vote", { pot, member: a.address, id, approve, nonce, deadline: dl, sig });
  });
}

export async function cancelSpend(pot: Address, id: bigint): Promise<RelayResult> {
  const a = me();
  return withNonce(a.address, async (nonce) => {
    const dl = deadline();
    const sig = await sign(a, typed.cancelSpend(chainId(), pot, { member: a.address, id, nonce, deadline: dl }));
    return relay("cancelSpend", { pot, member: a.address, id, nonce, deadline: dl, sig });
  });
}

export const execute = (pot: Address, id: bigint) => relay("execute", { pot, id });
export const expire = (pot: Address, id: bigint) => relay("expire", { pot, id });

// ─────────────── pot: disputes ───────────────

export async function openDispute(pot: Address, spendId: bigint, reason: number, memo: Hex = "0x"): Promise<RelayResult> {
  const a = me();
  return withNonce(a.address, async (nonce) => {
    const dl = deadline();
    const sig = await sign(a, typed.openDispute(chainId(), pot, { member: a.address, spendId, reason, memo, nonce, deadline: dl }));
    return relay("openDispute", { pot, member: a.address, spendId, reason, memo, nonce, deadline: dl, sig });
  });
}

export async function resolveDispute(pot: Address, disputeId: bigint, outcome: DisputeOutcome, split: Split): Promise<RelayResult> {
  const a = me();
  return withNonce(a.address, async (nonce) => {
    const dl = deadline();
    const sig = await sign(a, typed.resolveDispute(chainId(), pot, { member: a.address, disputeId, outcome, split, nonce, deadline: dl }));
    return relay("resolveDispute", { pot, member: a.address, disputeId, outcome, split, nonce, deadline: dl, sig });
  });
}

export async function voteDispute(pot: Address, disputeId: bigint, spenderCovers: boolean): Promise<RelayResult> {
  const a = me();
  return withNonce(a.address, async (nonce) => {
    const dl = deadline();
    const sig = await sign(a, typed.disputeVote(chainId(), pot, { member: a.address, disputeId, spenderCovers, nonce, deadline: dl }));
    return relay("voteDispute", { pot, member: a.address, disputeId, spenderCovers, nonce, deadline: dl, sig });
  });
}

export const finalizeDispute = (pot: Address, disputeId: bigint) => relay("finalizeDispute", { pot, disputeId });

// ─────────────── pot: safety ───────────────

export async function freeze(pot: Address): Promise<RelayResult> {
  const a = me();
  return withNonce(a.address, async (nonce) => {
    const dl = deadline();
    const sig = await sign(a, typed.freeze(chainId(), pot, { member: a.address, nonce, deadline: dl }));
    return relay("freeze", { pot, member: a.address, nonce, deadline: dl, sig });
  });
}

export async function voteUnfreeze(pot: Address): Promise<RelayResult> {
  const a = me();
  return withNonce(a.address, async (nonce) => {
    const dl = deadline();
    const sig = await sign(a, typed.unfreezeVote(chainId(), pot, { member: a.address, nonce, deadline: dl }));
    return relay("voteUnfreeze", { pot, member: a.address, nonce, deadline: dl, sig });
  });
}

export async function proposeRules(pot: Address, rules: Rules, allowAdd: Address[] = [], allowRemove: Address[] = []): Promise<RelayResult> {
  const a = me();
  return withNonce(a.address, async (nonce) => {
    const dl = deadline();
    const sig = await sign(a, typed.proposeRules(chainId(), pot, { member: a.address, rules, allowAdd, allowRemove, nonce, deadline: dl }));
    return relay("proposeRules", { pot, member: a.address, rules, allowAdd, allowRemove, nonce, deadline: dl, sig });
  });
}

export async function voteRules(pot: Address, id: bigint, approve: boolean): Promise<RelayResult> {
  const a = me();
  return withNonce(a.address, async (nonce) => {
    const dl = deadline();
    const sig = await sign(a, typed.voteRules(chainId(), pot, { member: a.address, id, approve, nonce, deadline: dl }));
    return relay("voteRules", { pot, member: a.address, id, approve, nonce, deadline: dl, sig });
  });
}

export const applyRules = (pot: Address, id: bigint) => relay("applyRules", { pot, id });

// ─────────────── pot: ending ───────────────

export async function exitPot(pot: Address): Promise<RelayResult> {
  const a = me();
  return withNonce(a.address, async (nonce) => {
    const dl = deadline();
    const sig = await sign(a, typed.exit(chainId(), pot, { member: a.address, nonce, deadline: dl }));
    return relay("exit", { pot, member: a.address, nonce, deadline: dl, sig });
  });
}

export async function ack(pot: Address): Promise<RelayResult> {
  const a = me();
  return withNonce(a.address, async (nonce) => {
    const dl = deadline();
    const sig = await sign(a, typed.ack(chainId(), pot, { member: a.address, nonce, deadline: dl }));
    return relay("ack", { pot, member: a.address, nonce, deadline: dl, sig });
  });
}

export const settle = (pot: Address) => relay("settle", { pot });

/**
 * After settlement, pays `member` (default: the signed-in account) what the pot still owes them,
 * e.g. a payout that was refused at settlement. Unsigned and permissionless (it can only pay
 * `member`), like `settle`. Errors: NOT_SETTLED, NOT_MEMBER, NOTHING_TO_COLLECT, PAYOUT_REFUSED.
 */
export const collect = (pot: Address, member?: Address) => relay("collect", { pot, member: member ?? me().address });

// ─────────────── send & claim links ───────────────

/** SendMeta without `to`; `fxRoundId` is optional and defaults to 0n (no onchain FX reference). */
export type SendMetaInput = Omit<SendMeta, "to" | "fxRoundId"> & { fxRoundId?: bigint };

/** The full SendMeta for a send: the struct that is hashed into the 3009 nonce and relayed as-is. */
export const buildSendMeta = (to: Address, m: SendMetaInput): SendMeta => ({ ...m, to, fxRoundId: m.fxRoundId ?? 0n });

export async function send(p: { to: Address; amount: bigint; meta: SendMetaInput }): Promise<RelayResult> {
  const a = me();
  // The relayer gets the very meta that was hashed (incl. fxRoundId), so the nonce always matches.
  const meta = buildSendMeta(p.to, p.meta);
  const auth = await receiveAuth(a, config.contracts.plansSend, p.amount, sendAuthNonce(meta));
  return relay("send", { from: a.address, meta, auth });
}

/** Send-by-link: money locked against a fresh one-time claim key; the key goes in the link. */
export async function createClaimLink(p: { amount: bigint; expirySec: number; fromCountry: string }): Promise<{ result: RelayResult; claimKey: Uint8Array; claimId?: bigint; expiry: bigint }> {
  const a = me();
  const claimKey = randomBytes(32);
  const claimSigner = privateKeyToAccount(toHex(claimKey)).address;
  const expiry = BigInt(nowSec() + p.expirySec);
  const fromCountry = codeToBytes(p.fromCountry, 2);
  const salt = toHex(randomBytes(32));
  const auth = await receiveAuth(a, config.contracts.claimEscrow, p.amount, claimAuthNonce(claimSigner, expiry, fromCountry, salt));
  const result = await relay("claimCreate", { from: a.address, claimSigner, expiry, fromCountry, salt, auth });
  const ev = result.events?.find((e) => e.name === "ClaimCreated");
  const claimId = ev?.args?.id !== undefined ? BigInt(String(ev.args.id)) : undefined;
  return { result, claimKey, claimId, expiry };
}

export async function claim(p: { id: bigint; claimKey: Uint8Array; toCountry: string }): Promise<RelayResult> {
  const a = me();
  const signer = privateKeyToAccount(toHex(p.claimKey));
  const toCountry = codeToBytes(p.toCountry, 2);
  const claimSig = await signer.signTypedData(typed.claim(chainId(), config.contracts.claimEscrow, { id: p.id, recipient: a.address, toCountry }) as never);
  return relay("claim", { id: p.id, recipient: a.address, toCountry, claimSig });
}

export const claimRefund = (id: bigint) => relay("claimRefund", { id });

/** The claim key's public address (lookup key in the indexer). */
export function claimSignerOf(key: Uint8Array): Address {
  return privateKeyToAccount(toHex(key)).address;
}

export const memoHashOf = (memo: Hex) => keccak256(memo);
