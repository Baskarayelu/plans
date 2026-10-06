/**
 * Multi-step flows that combine keys, encryption and relayed actions. Screens call these; they
 * never build signatures themselves.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../../config";
import { fetchClaimBySigner, type ClaimRow } from "../api/envio";
import { getFx, putBlob, type RelayResult } from "../api/relayer";
import * as A from "../chain/actions";
import { codeToBytes, SpendKind, ZERO_BYTES32, type Rules, type Split } from "../chain/eip712";
import { ausdBalance, registeredKey } from "../chain/rpc";
import { fromHex, randomBytes, toBase64Url, toHex, utf8 } from "../crypto/bytes";
import { inviteKeyPair } from "../crypto/keys";
import { encodeMemo, encodeMeta, encodeProfileWrap, encodeSendNote, groupEncrypt, newGroupKey, wrapGroupKey, type PlanMeta } from "../crypto/seal";
import { currentAccount, currentKeys, identity } from "../identity/session";
import { blobWrite, cacheRead, cacheWrite } from "../state/cache";
import { queryClient, qk } from "../state/data";
import { claimUrl, inviteUrl } from "./links";
import { groupKeyFor, inviteSecretFor, rememberContact, rememberGroupKey, rememberInviteSecret } from "./groups";
import { ONE_DOLLAR } from "./currency";

const lc = (s: string) => s.toLowerCase();

export class NeedsKeysError extends Error {
  constructor() {
    super("keys locked");
  }
}

function requireKeys() {
  const k = currentKeys();
  if (!k) throw new NeedsKeysError();
  return k;
}

function profile() {
  const p = identity.get().profile;
  return { name: p?.name ?? "Friend", city: p?.city, country: p?.country ?? "US", currency: p?.currency ?? "USD" };
}

/** Default safety-net allowance offered when joining (screen 14): small for small-amount plans. */
export function defaultSafetyNet(rules: Pick<Rules, "instantMax" | "oneApprovalMax">): bigint {
  return rules.oneApprovalMax <= 5n * ONE_DOLLAR ? 5n * ONE_DOLLAR : 100n * ONE_DOLLAR;
}

// ─────────────── create a plan (10–13) ───────────────

export type NewPlanInput = {
  meta: PlanMeta;
  rules: Rules;
  startTime: number;
  endTime: number;
  reviewWindowSec: number;
  deposit: bigint;
  safetyNet: bigint;
};

export async function createPlan(input: NewPlanInput): Promise<{ pot: Address; inviteUrl: string; result: RelayResult }> {
  const keys = requireKeys();
  const me = currentAccount().address;
  const salt = toHex(randomBytes(32));
  const pot = await A.predictPot(me, salt);
  const gk = newGroupKey();
  const inviteSecret = randomBytes(32);
  const inviteSigner = privateKeyToAccount(toHex(inviteSecret)).address;
  const p = profile();
  const params = {
    rules: input.rules,
    startTime: BigInt(input.startTime),
    endTime: BigInt(input.endTime),
    reviewWindow: input.reviewWindowSec,
    inviteSigner,
    creatorCountry: codeToBytes(p.country, 2),
    creatorSafetyNet: input.safetyNet,
    meta: toHex(encodeMeta(gk, pot, input.meta)) as Hex,
    creatorKeyWrap: toHex(wrapGroupKey(keys.x25519Public, gk, pot)) as Hex,
    inviteKeyWrap: toHex(wrapGroupKey(inviteKeyPair(inviteSecret).publicKey, gk, pot)) as Hex,
    salt,
  };
  const result = await A.createPot({ params, pot, deposit: input.deposit, pubKey: toHex(keys.x25519Public) as Hex });
  rememberGroupKey(pot, gk);
  rememberInviteSecret(pot, inviteSecret);
  void postMyProfile(pot, gk).catch(() => undefined);
  void queryClient.invalidateQueries({ queryKey: qk.myPlans(me) });
  return { pot, inviteUrl: inviteUrl(config.linkHost, pot, inviteSecret, p.name), result };
}

/** Posts this member's encrypted profile (name, city, country, currency) into the plan. */
export async function postMyProfile(pot: Address, gk: Uint8Array, extraSelfWrap = false): Promise<RelayResult> {
  const me = currentAccount().address;
  const p = profile();
  const wraps: { member: Address; wrap: Hex }[] = [{ member: me, wrap: toHex(encodeProfileWrap(gk, pot, p)) as Hex }];
  const k = currentKeys();
  if (extraSelfWrap && k) wraps.unshift({ member: me, wrap: toHex(wrapGroupKey(k.x25519Public, gk, pot)) as Hex });
  return A.postKeyWraps(pot, wraps);
}

export function currentInviteUrl(pot: string): string | null {
  const s = inviteSecretFor(pot);
  if (!s) return null;
  return inviteUrl(config.linkHost, pot, s, identity.get().profile?.name);
}

/** "Turn off link" / "Make a new link": rotate the invite signer. A new invite wrap is not possible
 * (events only), so new joiners read the plan through re-wraps once they're in. */
export async function newInviteLink(pot: Address): Promise<string> {
  const secret = randomBytes(32);
  await A.rotateInvite(pot, privateKeyToAccount(toHex(secret)).address);
  rememberInviteSecret(pot, secret);
  return inviteUrl(config.linkHost, pot, secret, identity.get().profile?.name);
}

export async function turnOffInvite(pot: Address): Promise<void> {
  const burn = privateKeyToAccount(toHex(randomBytes(32))).address;
  await A.rotateInvite(pot, burn);
}

// ─────────────── join (14–15) ───────────────

export async function joinPlan(input: { pot: Address; inviteSecret: Uint8Array; inviteKeyWrap: string; deposit: bigint; safetyNet: bigint }): Promise<RelayResult> {
  const me = currentAccount().address;
  const k = currentKeys();
  const p = profile();
  const result = await A.join({
    pot: input.pot,
    inviteSecret: input.inviteSecret,
    country: p.country,
    deposit: input.deposit,
    safetyNet: input.safetyNet,
    pubKey: k ? (toHex(k.x25519Public) as Hex) : null,
  });
  if (k) rememberInviteSecret(input.pot, input.inviteSecret);
  const gk = groupKeyFor(input.pot, { inviteKeyWrap: input.inviteKeyWrap, inviteSecret: input.inviteSecret });
  if (gk) {
    if (k) rememberGroupKey(input.pot, gk);
    // own group-key wrap (so a restored phone can read the plan) + profile, in one call
    void postMyProfile(input.pot, gk, true).catch(() => undefined);
  }
  void queryClient.invalidateQueries({ queryKey: qk.myPlans(me) });
  void queryClient.invalidateQueries({ queryKey: qk.balance(me) });
  return result;
}

// ─────────────── spends (20–26) ───────────────

export type SpendInput = {
  pot: Address;
  kind: SpendKind;
  payee?: Address;
  amount: bigint;
  category: number;
  split: Split;
  note?: string;
  photoJpeg?: Uint8Array;
};

export type SpendOutcome = { result: RelayResult; spendId?: bigint; executed: boolean; approvalsRequired: number; claimLink?: string; receiptHash: Hex };

function linkKeys(): Record<string, string> {
  return cacheRead<Record<string, string>>("linkkeys") ?? {};
}

export function payLinkFor(pot: string, spendId: bigint | string, extra: { sender?: string; note?: string; amount?: string } = {}): string | null {
  const h = linkKeys()[`${lc(pot)}:${String(spendId)}`];
  return h ? claimUrl(config.linkHost, fromHex(h), extra) : null;
}

export async function proposeSpend(s: SpendInput): Promise<SpendOutcome> {
  const gk = groupKeyFor(s.pot, { me: identity.get().address });
  let memo: Hex = "0x";
  if (s.note && gk) memo = toHex(encodeMemo(gk, s.pot, "memo", { text: s.note })) as Hex;
  let receiptHash: Hex = ZERO_BYTES32;
  if (s.photoJpeg && gk) {
    const ct = groupEncrypt(gk, "receipt", s.pot, s.photoJpeg);
    receiptHash = toHex(sha256(ct)) as Hex;
    blobWrite(receiptHash, ct);
    void putBlob(receiptHash, toBase64Url(ct));
  }
  let payee = s.payee ?? ("0x0000000000000000000000000000000000000000" as Address);
  let claimKey: Uint8Array | null = null;
  if (s.kind === SpendKind.LINK) {
    claimKey = randomBytes(32);
    payee = privateKeyToAccount(toHex(claimKey)).address;
  } else if (s.kind === SpendKind.PERSONAL) {
    payee = currentAccount().address;
  }
  const result = await A.propose({ pot: s.pot, kind: s.kind, payee, amount: s.amount, category: s.category, split: s.split, receiptHash, memo });
  const proposed = result.events?.find((e) => e.name === "SpendProposed");
  const executed = result.events?.some((e) => e.name === "SpendExecuted") ?? false;
  const spendId = proposed ? BigInt(String(proposed.args.id)) : undefined;
  const approvalsRequired = proposed ? Number(proposed.args.approvalsRequired) : 1;
  let claimLink: string | undefined;
  if (claimKey && spendId !== undefined) {
    const all = linkKeys();
    all[`${lc(s.pot)}:${spendId}`] = toHex(claimKey);
    cacheWrite("linkkeys", all);
    claimLink = claimUrl(config.linkHost, claimKey, { sender: identity.get().profile?.name, note: s.note, amount: s.amount.toString() });
  }
  void queryClient.invalidateQueries({ queryKey: qk.plan(s.pot) });
  return { result, spendId, executed, approvalsRequired, claimLink, receiptHash };
}

// ─────────────── sends (43–51) ───────────────

export type SendInput = {
  to: Address;
  amount: bigint;
  toCountry?: string;
  toCurrency: string;
  note?: string;
};

export async function sendMoney(s: SendInput): Promise<{ result: RelayResult; rateE8: bigint; fxTimestamp: number; fromCurrency: string }> {
  const me = currentAccount().address;
  const p = profile();
  const fromCurrency = p.currency;
  const fx = fromCurrency === s.toCurrency ? { rateE8: "100000000", timestamp: Math.floor(Date.now() / 1000) } : await getFx(fromCurrency, s.toCurrency);
  const keys = currentKeys();
  let salt: Hex = toHex(randomBytes(32)) as Hex;
  const theirKey = await registeredKey(s.to).catch(() => null);
  if (keys && theirKey) salt = toHex(encodeSendNote(keys.x25519Secret, fromHex(theirKey), me, s.to, { name: p.name, city: p.city, note: s.note })) as Hex;
  const result = await A.send({
    to: s.to,
    amount: s.amount,
    meta: {
      fromCountry: codeToBytes(p.country, 2),
      toCountry: codeToBytes(s.toCountry, 2),
      fromCurrency: codeToBytes(fromCurrency, 3),
      toCurrency: codeToBytes(s.toCurrency, 3),
      fxRateE8: BigInt(fx.rateE8),
      fxTimestamp: BigInt(fx.timestamp),
      memoHash: s.note ? keccak256(toHex(utf8(s.note)) as Hex) : ZERO_BYTES32,
      salt,
    },
  });
  void queryClient.invalidateQueries({ queryKey: qk.balance(me) });
  void queryClient.invalidateQueries({ queryKey: qk.activity(me) });
  return { result, rateE8: BigInt(fx.rateE8), fxTimestamp: fx.timestamp, fromCurrency };
}

export async function createSendLink(amount: bigint, expirySec: number, note?: string): Promise<{ url: string; result: RelayResult; expiry: bigint; claimId?: bigint }> {
  const p = profile();
  const r = await A.createClaimLink({ amount, expirySec, fromCountry: p.country });
  const url = claimUrl(config.linkHost, r.claimKey, { sender: p.name, note, amount: amount.toString() });
  const all = cacheRead<Record<string, string>>("sentlinks") ?? {};
  all[String(r.claimId ?? r.result.txHash)] = url;
  cacheWrite("sentlinks", all);
  return { url, result: r.result, expiry: r.expiry, claimId: r.claimId };
}

export async function lookupClaim(key: Uint8Array): Promise<ClaimRow | null> {
  return fetchClaimBySigner(A.claimSignerOf(key));
}

export async function claimLink(key: Uint8Array): Promise<RelayResult> {
  const c = await lookupClaim(key);
  if (!c) throw new Error("This link isn't ready yet. Try again in a moment.");
  const p = profile();
  const r = await A.claim({ id: BigInt(c.claimId), claimKey: key, toCountry: p.country });
  const me = currentAccount().address;
  void queryClient.invalidateQueries({ queryKey: qk.balance(me) });
  return r;
}

/** Remember who a Plans code belongs to (name/city/country from the code). */
export function rememberCode(address: string, c: { name?: string; city?: string; country?: string; currency?: string }) {
  if (c.name) rememberContact(address, { name: c.name, city: c.city, country: c.country, currency: c.currency });
}

export async function myBalance(): Promise<bigint> {
  return ausdBalance(currentAccount().address);
}
