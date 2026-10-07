/** KeyRegistry, PlansSend (with receipt metadata binding) and send-by-link through ClaimEscrow. */
import { getAddress, keccak256, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { ausdBal, warp } from "../lib/harness";
import { ABI, build, chainNow, codeToBytes, findEvent, randomHex32, USD, type SendMeta } from "../lib/plans";
import { randomBytes, toHex } from "../../../app/src/lib/crypto/bytes";
import type { T } from "./types";

export interface Later {
  expiringLinkId?: bigint;
  expiringLinkKey?: PrivateKeyAccount;
  expiringLinkExpiry?: bigint;
}

const newKey = () => privateKeyToAccount(toHex(randomBytes(32)));
const pubKey = () => toHex(randomBytes(32));

export async function peripheryScenarios({ R, env, A }: T): Promise<Later> {
  const api = env.api;
  const ctx = env.ctx;
  const later: Later = {};

  // ───── KeyRegistry ─────
  R.group = "keys";
  const aliceKey = pubKey();
  let regParams: Awaited<ReturnType<typeof build.registerKey>> | undefined;
  await R.run("registerKey", "flow", "KeyRegistered, keyOf = pubKey", async (s) => {
    regParams = await build.registerKey(ctx, A.alice, aliceKey);
    s.ok(await api.relay("registerKey", regParams), "KeyRegistered");
    s.eq(await env.anvil.pub.readContract({ address: env.dep.keyRegistry, abi: ABI.keyRegistry, functionName: "keyOf", args: [A.alice.address] }), aliceKey, "keyOf");
  });
  await R.run("registerKey replay (same deadline)", "failure", "422 STALE_REGISTRATION", async (s) => {
    await s.rejects(() => api.relay("registerKey", regParams!), { status: 422, code: "STALE_REGISTRATION" }, env.dep.keyRegistry);
  });
  await R.run("registerKey signed by another account", "failure", "422 INVALID_SIGNATURE", async (s) => {
    const p = await build.registerKey(ctx, A.alice, pubKey(), { signer: A.bob, deadline: (await chainNow(ctx)) + 40n * 86400n });
    await s.rejects(() => api.relay("registerKey", p), { status: 422, code: "INVALID_SIGNATURE" }, env.dep.keyRegistry);
  });
  await R.run("registerKey with an expired deadline", "failure", "422 EXPIRED (refused before simulation)", async (s) => {
    const p = await build.registerKey(ctx, A.bob, pubKey(), { deadline: BigInt(Math.floor(Date.now() / 1000) - 60) });
    await s.rejects(() => api.relay("registerKey", p), { status: 422, code: "EXPIRED" }, env.dep.keyRegistry);
  });
  await R.run("registerKey zero key", "failure", "422 ZERO_KEY", async (s) => {
    const p = await build.registerKey(ctx, A.bob, `0x${"00".repeat(32)}`);
    await s.rejects(() => api.relay("registerKey", p), { status: 422, code: "ZERO_KEY" }, env.dep.keyRegistry);
  });
  await R.invariants("keys");

  // ───── PlansSend ─────
  R.group = "send";
  const amount = USD(12.34);
  let meta: SendMeta | undefined;
  let sendParams: Awaited<ReturnType<typeof build.send>> | undefined;
  await R.run("PlansSend send with FX receipt bound into the 3009 nonce", "flow", "Sent with the signed receipt fields; recipient +12.34; PlansSend holds 0", async (s) => {
    const q = await api.get("/v1/fx?from=GBP&to=INR");
    s.eq(q.status, 200, "fx");
    const memo = stringToHex("dinner, thanks!");
    meta = {
      to: A.frank.address,
      fromCountry: codeToBytes("GB", 2),
      toCountry: codeToBytes("IN", 2),
      fromCurrency: codeToBytes("GBP", 3),
      toCurrency: codeToBytes("INR", 3),
      fxRateE8: BigInt(q.body.rateE8),
      fxTimestamp: BigInt(q.body.timestamp),
      memoHash: keccak256(memo),
      salt: randomHex32(),
    };
    const f0 = await ausdBal(env, A.frank.address);
    const g0 = await ausdBal(env, A.gina.address);
    sendParams = await build.send(ctx, A.gina, amount, meta);
    const r = s.ok(await api.relay("send", sendParams), "Sent");
    const ev = findEvent(r, "Sent")!.args;
    s.eq([getAddress(ev.from), getAddress(ev.to), ev.amount, ev.fromCountry, ev.toCountry, ev.fromCurrency, ev.toCurrency, ev.fxRateE8, ev.memoHash],
      [A.gina.address, A.frank.address, amount.toString(), "0x4742", "0x494e", "0x474250", "0x494e52", "10650000000", meta.memoHash], "Sent args");
    s.eq((await ausdBal(env, A.frank.address)) - f0, amount, "recipient delta");
    s.eq(g0 - (await ausdBal(env, A.gina.address)), amount, "sender delta");
    const tx = await api.get(`/v1/tx/${r.body.txHash}`);
    s.eq([tx.status, tx.body.action, tx.body.status], [200, "send", "success"], "/v1/tx");
    s.expect(typeof tx.body.latencyMs === "number" && typeof tx.body.totalMs === "number" && tx.body.submittedAt > 0, "/v1/tx timing fields");
    s.actual = `Sent; /v1/tx latencyMs ${tx.body.latencyMs}, totalMs ${tx.body.totalMs}`;
  });
  await R.run("PlansSend with recipient swapped after signing", "failure", "422 NONCE_MISMATCH", async (s) => {
    const p = await build.send(ctx, A.gina, USD(1), { ...meta!, to: A.stranger, salt: randomHex32() }, { signedMeta: { ...meta!, salt: randomHex32() } });
    await s.rejects(() => api.relay("send", p), { status: 422, code: "NONCE_MISMATCH" }, env.dep.plansSend);
  });
  await R.run("PlansSend with tampered FX rate (metadata vs 3009 nonce)", "failure", "422 NONCE_MISMATCH", async (s) => {
    const signed = { ...meta!, salt: randomHex32() };
    const p = await build.send(ctx, A.gina, USD(1), { ...signed, fxRateE8: signed.fxRateE8 * 2n }, { signedMeta: signed });
    await s.rejects(() => api.relay("send", p), { status: 422, code: "NONCE_MISMATCH" }, env.dep.plansSend);
  });
  await R.run("PlansSend with tampered amount (3009 signature no longer matches)", "failure", "422, plain-English message", async (s) => {
    const p = await build.send(ctx, A.gina, USD(1), { ...meta!, salt: randomHex32() });
    p.auth = { ...p.auth, value: USD(99) };
    const r = await s.rejects(() => api.relay("send", p), { status: 422, code: "*" }, env.dep.plansSend);
    s.note(`AUSD's revert for a bad ERC-3009 signature decodes to ${r.body.error!.code} (${r.body.error!.error})`);
  });
  await R.run("PlansSend replay of a used authorisation", "failure", "422, plain-English message", async (s) => {
    const r = await s.rejects(() => api.relay("send", sendParams!), { status: 422, code: "*" }, env.dep.plansSend);
    s.note(`AUSD's revert for a used ERC-3009 nonce decodes to ${r.body.error!.code} (${r.body.error!.error})`);
  });
  await R.run("PlansSend without an authorisation", "failure", "400 INVALID_PARAMS", async (s) => {
    await s.rejects(() => api.relay("send", { from: A.gina.address, meta: meta! }), { status: 400, code: "INVALID_PARAMS" });
  });
  await R.invariants("send");

  // ───── send-by-link (ClaimEscrow) ─────
  R.group = "send-by-link";
  const k2 = newKey();
  let linkId = 0n;
  await R.run("claimCreate (send-by-link)", "flow", "ClaimCreated from gina, escrow +5", async (s) => {
    const e0 = await ausdBal(env, env.dep.claimEscrow);
    const p = await build.claimCreate(ctx, A.gina, USD(5), k2.address, (await chainNow(ctx)) + 2n * 3600n, "GB");
    const r = s.ok(await api.relay("claimCreate", p), "ClaimCreated");
    const ev = findEvent(r, "ClaimCreated")!.args;
    linkId = BigInt(ev.id);
    s.eq([getAddress(ev.source), getAddress(ev.claimSigner), ev.amount, ev.sourceSpendId, ev.fromCountry], [A.gina.address, k2.address, USD(5).toString(), "0", "0x4742"], "ClaimCreated args");
    s.eq((await ausdBal(env, env.dep.claimEscrow)) - e0, USD(5), "escrow delta");
  });
  await R.run("claimCreate with claim terms not bound by the 3009 nonce", "failure", "422 NONCE_MISMATCH", async (s) => {
    const p = await build.claimCreate(ctx, A.gina, USD(5), A.stranger, (await chainNow(ctx)) + 3600n, "GB", { boundSigner: k2.address });
    await s.rejects(() => api.relay("claimCreate", p), { status: 422, code: "NONCE_MISMATCH" }, env.dep.claimEscrow);
  });
  await R.run("claimCreate with expiry in the past", "failure", "422 INVALID_EXPIRY", async (s) => {
    const p = await build.claimCreate(ctx, A.gina, USD(1), newKey().address, (await chainNow(ctx)) - 10n, "GB");
    await s.rejects(() => api.relay("claimCreate", p), { status: 422, code: "INVALID_EXPIRY" }, env.dep.claimEscrow);
  });
  await R.run("claim with the wrong key", "failure", "422 INVALID_SIGNATURE", async (s) => {
    const p = await build.claim(ctx, linkId, newKey(), A.frank.address, "IN");
    await s.rejects(() => api.relay("claim", p), { status: 422, code: "INVALID_SIGNATURE" }, env.dep.claimEscrow);
  });
  await R.run("claim (send-by-link)", "flow", "Claimed to frank, frank +5, escrow -5", async (s) => {
    const f0 = await ausdBal(env, A.frank.address);
    s.ok(await api.relay("claim", await build.claim(ctx, linkId, k2, A.frank.address, "IN")), "Claimed");
    s.eq((await ausdBal(env, A.frank.address)) - f0, USD(5), "recipient delta");
  });
  await R.run("claim twice", "failure", "422 NOT_OPEN", async (s) => {
    await s.rejects(async () => api.relay("claim", await build.claim(ctx, linkId, k2, A.erin.address, "IN")), { status: 422, code: "NOT_OPEN" }, env.dep.claimEscrow);
  });
  await R.run("refund a claimed link", "failure", "422 NOT_OPEN", async (s) => {
    await s.rejects(() => api.relay("claimRefund", { id: linkId }), { status: 422, code: "NOT_OPEN" }, env.dep.claimEscrow);
  });
  await R.run("claimCreate a link that will expire", "flow", "ClaimCreated, expiry in 1 h", async (s) => {
    const key = newKey();
    const expiry = (await chainNow(ctx)) + 3600n;
    const r = s.ok(await api.relay("claimCreate", await build.claimCreate(ctx, A.gina, USD(3), key.address, expiry, "US")), "ClaimCreated");
    later.expiringLinkId = BigInt(findEvent(r, "ClaimCreated")!.args.id);
    later.expiringLinkKey = key;
    later.expiringLinkExpiry = expiry;
  });
  await R.run("refund before expiry", "failure", "422 NOT_EXPIRED", async (s) => {
    await s.rejects(() => api.relay("claimRefund", { id: later.expiringLinkId! }), { status: 422, code: "NOT_EXPIRED" }, env.dep.claimEscrow);
  });
  await R.invariants("send-by-link");
  return later;
}

/** Runs after the fork's clock has passed the link's expiry. */
export async function peripheryAfterExpiry({ R, env, A }: T, later: Later) {
  R.group = "send-by-link (after expiry)";
  const api = env.api;
  const now = await chainNow(env.ctx);
  if (later.expiringLinkExpiry && now <= later.expiringLinkExpiry) await warp(env, Number(later.expiringLinkExpiry - now) + 1);
  await R.run("claim after expiry", "failure", "422 CLAIM_EXPIRED", async (s) => {
    await s.rejects(async () => api.relay("claim", await build.claim(env.ctx, later.expiringLinkId!, later.expiringLinkKey!, A.frank.address, "IN")), { status: 422, code: "CLAIM_EXPIRED" }, env.dep.claimEscrow);
  });
  await R.run("claimRefund after expiry (send-by-link)", "flow", "ClaimRefunded to the sender, gina +3", async (s) => {
    const g0 = await ausdBal(env, A.gina.address);
    const r = s.ok(await api.relay("claimRefund", { id: later.expiringLinkId! }), "ClaimRefunded");
    s.eq(getAddress(findEvent(r, "ClaimRefunded")!.args.to), A.gina.address, "refunded to");
    s.eq((await ausdBal(env, A.gina.address)) - g0, USD(3), "sender delta");
  });
  await R.invariants("send-by-link refunds");
}

export type { Address, Hex };
