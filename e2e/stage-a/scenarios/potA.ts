/**
 * Pot A: the main plan. Five members, every spend kind, approvals, rejects, cancel, freeze,
 * the Approved -> execute path, disputes (Resplit, SpenderCovers, voted), a rule change set up for
 * the time phase, and the SpendBlocked codes that a normal plan can hit.
 */
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { ausdBal, net, potRead, type Scenario } from "../lib/harness";
import { ABI, build, chainNow, findEvent, findEvents, invitee, potParams, rules, USD, type HttpResult } from "../lib/plans";
import { randomBytes, toHex } from "../../../app/src/lib/crypto/bytes";
import type { T } from "./types";

export const PAY = 0;
export const LINK = 1;
export const PERSONAL = 2;

export interface PotA {
  pot: Address;
  invite: PrivateKeyAccount;
  all: PrivateKeyAccount[];
  ruleId?: bigint;
  d4?: bigint;
  k3?: { claimId: bigint; spendId: bigint; key: PrivateKeyAccount; amount: bigint };
}

export const spendIdOf = (r: HttpResult) => BigInt(findEvent(r, "SpendProposed")!.args.id);
export const splitOf = (xs: PrivateKeyAccount[], w?: number[]) => ({ members: xs.map((x) => x.address), weights: w ?? xs.map(() => 1) });

export async function status(env: T["env"], pot: Address, id: bigint): Promise<number> {
  const info = await potRead<readonly unknown[]>(env, pot, "spendInfo", [id]);
  return Number(info[0]);
}

export async function potAScenarios({ R, env, A }: T): Promise<PotA> {
  R.group = "pot A: membership";
  const api = env.api;
  const ctx = env.ctx;
  const invite1 = invitee();
  const out: PotA = { pot: "0x" as Address, invite: invite1, all: [A.alice, A.bob, A.carol, A.dave, A.erin] };
  const { alice, bob, carol, dave, erin, frank } = A;
  const all5 = out.all;
  let createBody: Record<string, unknown> | undefined;

  const ok = R.run("createPot with deposit + safety-net permit + key registration", "flow", "PotCreated, MemberJoined, Contributed, KeyRegistered; net 100, allowance 50", async (s) => {
    const params = await potParams(ctx, invite1.address, { creatorSafetyNet: USD(50), meta: "0x00aa" as Hex, creatorKeyWrap: "0x01" as Hex, inviteKeyWrap: "0x02" as Hex });
    const key = toHex(randomBytes(32));
    const b = await build.createPot(ctx, alice, params, { deposit: USD(100), pubKey: key });
    createBody = b.params;
    const r = s.ok(await api.relay("createPot", b.params), "PotCreated", "MemberJoined", "Contributed", "KeyRegistered");
    out.pot = getAddress(findEvent(r, "PotCreated")!.args.pot);
    s.eq(out.pot, b.pot, "pot address = factory.predictPot");
    env.pots.set(out.pot, "A");
    env.tracked.set(out.pot.toLowerCase(), "pot A");
    s.eq(await net(env, out.pot, alice.address), USD(100), "net");
    s.eq(await env.anvil.pub.readContract({ address: env.dep.ausd, abi: ABI.ausd, functionName: "allowance", args: [alice.address, out.pot] }), USD(50), "allowance");
    s.eq(await env.anvil.pub.readContract({ address: env.dep.keyRegistry, abi: ABI.keyRegistry, functionName: "keyOf", args: [alice.address] }), key, "keyOf");
    s.eq(await potRead(env, out.pot, "isMember", [alice.address]), true, "isMember");
  });
  if (!(await ok)) throw new Error("Pot A could not be created; later Pot A scenarios depend on it");
  const pot = out.pot;

  await R.run("createPot replay of the same signed request", "failure", "422 NONCE_ALREADY_USED", async (s) => {
    await s.rejects(() => api.relay("createPot", createBody!), { status: 422, code: "NONCE_ALREADY_USED" }, env.dep.plansFactory);
  });
  await R.run("createPot with a safety net that doesn't match the signed params", "failure", "422 SAFETY_NET_MISMATCH", async (s) => {
    const b = await build.createPot(ctx, bob, await potParams(ctx, invitee().address, { creatorSafetyNet: USD(10) }), { safetyNetValue: 0n });
    await s.rejects(() => api.relay("createPot", b.params), { status: 422, code: "SAFETY_NET_MISMATCH" }, env.dep.plansFactory);
  });
  await R.run("createPot ending before it starts", "failure", "422 INVALID_SCHEDULE", async (s) => {
    const now = await chainNow(ctx);
    const b = await build.createPot(ctx, bob, await potParams(ctx, invitee().address, { startTime: now + 7200n, endTime: now + 3600n }));
    await s.rejects(() => api.relay("createPot", b.params), { status: 422, code: "INVALID_SCHEDULE" }, env.dep.plansFactory);
  });

  await R.run("join with deposit + safety-net permit + key registration", "flow", "MemberJoined, Contributed, KeyRegistered; allowance 100", async (s) => {
    s.ok(await api.relay("join", await build.join(ctx, pot, bob, invite1, { country: "IN", deposit: USD(100), safetyNet: USD(100), pubKey: toHex(randomBytes(32)) })), "MemberJoined", "Contributed", "KeyRegistered");
    s.eq(await env.anvil.pub.readContract({ address: env.dep.ausd, abi: ABI.ausd, functionName: "allowance", args: [bob.address, pot] }), USD(100), "allowance");
    s.eq(await net(env, pot, bob.address), USD(100), "net");
  });
  await R.run("join bare, then contribute", "flow", "MemberJoined; Contributed 60", async (s) => {
    s.ok(await api.relay("join", await build.join(ctx, pot, carol, invite1, { country: "US" })), "MemberJoined");
    s.ok(await api.relay("contribute", await build.contribute(ctx, pot, carol, USD(60))), "Contributed");
    s.eq(await net(env, pot, carol.address), USD(60), "net");
  });
  await R.run("contribute with a 3009 authorisation signed by someone else", "failure", "422, plain-English message, no state change", async (s) => {
    const r = await s.rejects(async () => api.relay("contribute", await build.contribute(ctx, pot, carol, USD(5), { signer: dave })), { status: 422, code: "*" }, pot);
    s.note(`AUSD bad-signature revert decodes to ${r.body.error!.code}/${r.body.error!.error}`);
  });
  await R.run("contribute more than the member holds", "failure", "422, plain-English message, no state change", async (s) => {
    const r = await s.rejects(async () => api.relay("contribute", await build.contribute(ctx, pot, carol, USD(5000))), { status: 422, code: "*" }, pot);
    s.note(`AUSD insufficient-balance revert decodes to ${r.body.error!.code}/${r.body.error!.error}`);
  });
  await R.run("contribute with an expired authorisation", "failure", "422 EXPIRED", async (s) => {
    await s.rejects(async () => api.relay("contribute", await build.contribute(ctx, pot, carol, USD(5), { validBefore: BigInt(Math.floor(Date.now() / 1000) - 5) })), { status: 422, code: "EXPIRED" }, pot);
  });
  await R.run("contribute by a non-member", "failure", "422 NOT_ACTIVE_MEMBER", async (s) => {
    await s.rejects(async () => api.relay("contribute", await build.contribute(ctx, pot, frank, USD(5))), { status: 422, code: "NOT_ACTIVE_MEMBER" }, pot);
  });
  await R.run("join with deposit", "flow", "MemberJoined, Contributed 50", async (s) => {
    s.ok(await api.relay("join", await build.join(ctx, pot, dave, invite1, { deposit: USD(50) })), "MemberJoined", "Contributed");
  });
  await R.run("join with an invite from the wrong signer", "failure", "422 INVALID_INVITE", async (s) => {
    await s.rejects(async () => api.relay("join", await build.join(ctx, pot, erin, invitee())), { status: 422, code: "INVALID_INVITE" }, pot);
  });
  await R.run("join twice", "failure", "422 ALREADY_MEMBER", async (s) => {
    await s.rejects(async () => api.relay("join", await build.join(ctx, pot, bob, invite1)), { status: 422, code: "ALREADY_MEMBER" }, pot);
  });
  await R.run("join with a Join signature by someone else", "failure", "422 INVALID_SIGNATURE", async (s) => {
    await s.rejects(async () => api.relay("join", await build.join(ctx, pot, erin, invite1, { signer: frank })), { status: 422, code: "INVALID_SIGNATURE" }, pot);
  });

  const invite2 = invitee();
  await R.run("rotateInvite", "flow", "InviteRotated; inviteSigner = new key", async (s) => {
    s.ok(await api.relay("rotateInvite", await build.rotateInvite(ctx, pot, alice, invite2.address)), "InviteRotated");
    s.eq(await potRead(env, pot, "inviteSigner"), invite2.address, "inviteSigner");
    out.invite = invite2;
  });
  await R.run("join with the old invite after rotation", "failure", "422 INVALID_INVITE", async (s) => {
    await s.rejects(async () => api.relay("join", await build.join(ctx, pot, erin, invite1)), { status: 422, code: "INVALID_INVITE" }, pot);
  });
  await R.run("join with the new invite (deposit)", "flow", "MemberJoined, Contributed 40", async (s) => {
    s.ok(await api.relay("join", await build.join(ctx, pot, erin, invite2, { deposit: USD(40) })), "MemberJoined", "Contributed");
  });
  await R.run("rotateInvite by a non-member", "failure", "422 NOT_ACTIVE_MEMBER", async (s) => {
    await s.rejects(async () => api.relay("rotateInvite", await build.rotateInvite(ctx, pot, frank, frank.address)), { status: 422, code: "NOT_ACTIVE_MEMBER" }, pot);
  });
  await R.run("postKeyWraps", "flow", "two KeyWrapped events", async (s) => {
    const r = s.ok(await api.relay("postKeyWraps", await build.postKeyWraps(ctx, pot, alice, [{ member: bob.address, wrap: "0xbeef" }, { member: carol.address, wrap: "0xcafe" }])), "KeyWrapped");
    s.eq(findEvents(r, "KeyWrapped").length, 2, "KeyWrapped count");
  });
  await R.run("postKeyWraps by a non-member", "failure", "422 NOT_ACTIVE_MEMBER", async (s) => {
    await s.rejects(async () => api.relay("postKeyWraps", await build.postKeyWraps(ctx, pot, frank, [{ member: bob.address, wrap: "0xbeef" }])), { status: 422, code: "NOT_ACTIVE_MEMBER" }, pot);
  });
  await R.invariants("pot A membership");

  // ───── spending ─────
  R.group = "pot A: spending";
  const ids: Record<string, bigint> = {};
  const propose = async (s: Scenario, who: PrivateKeyAccount, p: Parameters<typeof build.propose>[3], ...events: string[]) =>
    s.ok(await api.relay("propose", await build.propose(ctx, pot, who, p)), "SpendProposed", ...events);

  await R.run("propose PAY instant (executes inside propose)", "flow", "SpendExecuted; shop +10; shares 2 each", async (s) => {
    const s0 = await ausdBal(env, A.shop);
    const r = await propose(s, bob, { kind: PAY, payee: A.shop, amount: USD(10), category: 3, split: splitOf(all5), memo: "0x1234" }, "SpendExecuted");
    ids.payInstant = spendIdOf(r);
    s.eq(findEvent(r, "SpendProposed")!.args.approvalsRequired, 1, "approvalsRequired");
    s.eq((await ausdBal(env, A.shop)) - s0, USD(10), "shop delta");
    s.eq(findEvent(r, "SpendExecuted")!.args.shares, ["2000000", "2000000", "2000000", "2000000", "2000000"], "shares");
  });
  await R.run("propose PAY needing one approval, then approve", "flow", "Pending (2 approvals), Voted, SpendExecuted", async (s) => {
    const r = await propose(s, alice, { kind: PAY, payee: A.shop, amount: USD(60), category: 0, split: splitOf(all5) });
    ids.payApproved = spendIdOf(r);
    s.eq(findEvent(r, "SpendProposed")!.args.approvalsRequired, 2, "approvalsRequired");
    s.expect(!findEvent(r, "SpendExecuted"), "not executed yet");
    s.eq(await status(env, pot, ids.payApproved), 1, "Pending");
    s.ok(await api.relay("vote", await build.vote(ctx, pot, bob, ids.payApproved, true)), "Voted", "SpendExecuted");
    s.eq(await status(env, pot, ids.payApproved), 3, "Executed");
  });
  await R.run("propose PAY pending for vote failures", "flow", "Pending", async (s) => {
    ids.payVotes = spendIdOf(await propose(s, carol, { kind: PAY, payee: A.shop, amount: USD(70), category: 1, split: splitOf(all5) }));
  });
  await R.run("vote twice (proposer's vote is implied)", "failure", "422 ALREADY_VOTED", async (s) => {
    await s.rejects(async () => api.relay("vote", await build.vote(ctx, pot, carol, ids.payVotes, true)), { status: 422, code: "ALREADY_VOTED" }, pot);
  });
  await R.run("vote by a non-member", "failure", "422 NOT_ACTIVE_MEMBER", async (s) => {
    await s.rejects(async () => api.relay("vote", await build.vote(ctx, pot, frank, ids.payVotes, true)), { status: 422, code: "NOT_ACTIVE_MEMBER" }, pot);
  });
  await R.run("vote with a signature by someone else", "failure", "422 INVALID_SIGNATURE", async (s) => {
    await s.rejects(async () => api.relay("vote", await build.vote(ctx, pot, dave, ids.payVotes, true, { signer: erin })), { status: 422, code: "INVALID_SIGNATURE" }, pot);
  });
  await R.run("approve -> executes", "flow", "SpendExecuted", async (s) => {
    s.ok(await api.relay("vote", await build.vote(ctx, pot, dave, ids.payVotes, true)), "Voted", "SpendExecuted");
  });
  await R.run("vote twice (after it executed)", "failure", "422 INVALID_STATUS", async (s) => {
    await s.rejects(async () => api.relay("vote", await build.vote(ctx, pot, erin, ids.payVotes, true)), { status: 422, code: "INVALID_STATUS" }, pot);
  });
  await R.run("high-tier PERSONAL rejected by votes", "flow", "needs 3 of 5; two rejects keep it pending, the third cancels (SpendCancelled reason 1)", async (s) => {
    const r = await propose(s, alice, { kind: PERSONAL, payee: alice.address, amount: USD(250), category: 7, split: splitOf(all5) });
    ids.rejected = spendIdOf(r);
    s.eq(findEvent(r, "SpendProposed")!.args.approvalsRequired, 3, "MAJORITY of 5");
    s.ok(await api.relay("vote", await build.vote(ctx, pot, bob, ids.rejected, false)), "Voted");
    s.ok(await api.relay("vote", await build.vote(ctx, pot, carol, ids.rejected, false)), "Voted");
    s.eq(await status(env, pot, ids.rejected), 1, "still Pending after 2 rejects");
    const c = s.ok(await api.relay("vote", await build.vote(ctx, pot, dave, ids.rejected, false)), "Voted", "SpendCancelled");
    s.eq(findEvent(c, "SpendCancelled")!.args.reason, 1, "reason rejected");
  });
  await R.run("vote on a cancelled proposal", "failure", "422 INVALID_STATUS", async (s) => {
    await s.rejects(async () => api.relay("vote", await build.vote(ctx, pot, erin, ids.rejected, true)), { status: 422, code: "INVALID_STATUS" }, pot);
  });
  await R.run("propose PAY pending for cancelSpend", "flow", "Pending", async (s) => {
    ids.cancel = spendIdOf(await propose(s, erin, { kind: PAY, payee: A.shop, amount: USD(40), category: 4, split: splitOf(all5) }));
  });
  await R.run("cancelSpend by someone other than the proposer", "failure", "422 NOT_PROPOSER", async (s) => {
    await s.rejects(async () => api.relay("cancelSpend", await build.cancelSpend(ctx, pot, alice, ids.cancel)), { status: 422, code: "NOT_PROPOSER" }, pot);
  });
  await R.run("cancelSpend by the proposer", "flow", "SpendCancelled reason 0", async (s) => {
    const r = s.ok(await api.relay("cancelSpend", await build.cancelSpend(ctx, pot, erin, ids.cancel)), "SpendCancelled");
    s.eq(findEvent(r, "SpendCancelled")!.args.reason, 0, "reason withdrawn");
  });
  await R.run("propose LINK instant, then claim with the link key", "flow", "SpendExecuted with claimId, ClaimCreated (source pot), Claimed to frank +20", async (s) => {
    const k1 = privateKeyToAccount(toHex(randomBytes(32)));
    const r = await propose(s, carol, { kind: LINK, payee: k1.address, amount: USD(20), category: 4, split: splitOf(all5) }, "SpendExecuted", "ClaimCreated");
    const claimId = BigInt(findEvent(r, "SpendExecuted")!.args.claimId);
    s.expect(claimId > 0n, "claimId");
    const cc = findEvent(r, "ClaimCreated")!.args;
    s.eq([getAddress(cc.source), cc.sourceSpendId], [pot, spendIdOf(r).toString()], "ClaimCreated source/spend");
    const f0 = await ausdBal(env, frank.address);
    s.ok(await api.relay("claim", await build.claim(ctx, claimId, k1, frank.address, "IN")), "Claimed");
    s.eq((await ausdBal(env, frank.address)) - f0, USD(20), "frank delta");
  });
  await R.run("propose LINK instant left unclaimed (refunded after settlement later)", "flow", "SpendExecuted, ClaimCreated; escrow holds 15", async (s) => {
    const key = privateKeyToAccount(toHex(randomBytes(32)));
    const r = await propose(s, dave, { kind: LINK, payee: key.address, amount: USD(15), category: 3, split: splitOf([dave, carol]) }, "SpendExecuted", "ClaimCreated");
    out.k3 = { claimId: BigInt(findEvent(r, "SpendExecuted")!.args.claimId), spendId: spendIdOf(r), key, amount: USD(15) };
  });
  let personalBody: Record<string, unknown> | undefined;
  await R.run("propose PERSONAL instant", "flow", "SpendExecuted; dave net +20 - 10 share, alice -10", async (s) => {
    const before = [await net(env, pot, dave.address), await net(env, pot, alice.address)];
    personalBody = await build.propose(ctx, pot, dave, { kind: PERSONAL, payee: dave.address, amount: USD(20), category: 3, split: splitOf([dave, alice]) });
    const r = s.ok(await api.relay("propose", personalBody), "SpendExecuted");
    ids.personal = spendIdOf(r);
    s.eq([(await net(env, pot, dave.address)) - before[0], (await net(env, pot, alice.address)) - before[1]], [USD(10), -USD(10)], "net deltas");
  });
  await R.run("nonce replay (resubmit an executed propose)", "failure", "422 NONCE_ALREADY_USED", async (s) => {
    await s.rejects(() => api.relay("propose", personalBody!), { status: 422, code: "NONCE_ALREADY_USED" }, pot);
  });
  await R.run("propose signed by another member", "failure", "422 INVALID_SIGNATURE", async (s) => {
    await s.rejects(async () => api.relay("propose", await build.propose(ctx, pot, alice, { kind: PAY, payee: A.shop, amount: USD(5), category: 0, split: splitOf(all5) }, { signer: erin })), { status: 422, code: "INVALID_SIGNATURE" }, pot);
  });
  await R.run("propose with the amount changed after signing", "failure", "422 INVALID_SIGNATURE", async (s) => {
    await s.rejects(async () => api.relay("propose", await build.propose(ctx, pot, alice, { kind: PAY, payee: A.shop, amount: USD(6), category: 0, split: splitOf(all5) }, { signAmount: USD(5) })), { status: 422, code: "INVALID_SIGNATURE" }, pot);
  });
  await R.run("propose with an expired deadline", "failure", "422 EXPIRED (refused before simulation)", async (s) => {
    await s.rejects(async () => api.relay("propose", await build.propose(ctx, pot, alice, { kind: PAY, payee: A.shop, amount: USD(5), category: 0, split: splitOf(all5) }, { deadline: BigInt(Math.floor(Date.now() / 1000) - 1) })), { status: 422, code: "EXPIRED" }, pot);
  });

  // SpendBlocked reasons reachable on an ordinary open plan
  const blocked = async (name: string, code: string, reason: number, who: PrivateKeyAccount, p: Parameters<typeof build.propose>[3]) =>
    R.run(`SpendBlocked ${reason}: ${name}`, "failure", `422 ${code} (reason ${reason})`, async (s) => {
      const pv = (await potRead<readonly unknown[]>(env, pot, "previewSpend", [who.address, p.kind, p.payee, p.amount, p.category]));
      await s.rejects(async () => api.relay("propose", await build.propose(ctx, pot, who, p)), { status: 422, code, reason, error: "SpendBlocked" }, pot);
      if (reason !== 10) s.eq(Number(pv[2]), reason, "previewSpend agrees");
    });
  await blocked("proposer is not a member", "NOT_ACTIVE_MEMBER", 1, frank, { kind: PAY, payee: A.shop, amount: USD(5), category: 0, split: splitOf(all5) });
  await blocked("PAY to the pot itself", "PAYEE_NOT_ALLOWED", 5, alice, { kind: PAY, payee: pot, amount: USD(5), category: 0, split: splitOf(all5) });
  await blocked("PAY to the ClaimEscrow", "PAYEE_NOT_ALLOWED", 5, alice, { kind: PAY, payee: env.dep.claimEscrow, amount: USD(5), category: 0, split: splitOf(all5) });
  await blocked("PAY more than the pot holds", "INSUFFICIENT_POT_BALANCE", 9, alice, { kind: PAY, payee: A.shop, amount: USD(5000), category: 0, split: splitOf(all5) });
  await blocked("split includes a non-member", "INVALID_SPLIT", 10, alice, { kind: PAY, payee: A.shop, amount: USD(5), category: 0, split: splitOf([alice, frank]) });
  await blocked("amount does not fit 96 bits", "INVALID_AMOUNT_OR_CATEGORY", 11, alice, { kind: PERSONAL, payee: alice.address, amount: 1n << 96n, category: 0, split: splitOf(all5) });
  await blocked("PAY to the zero address", "INVALID_AMOUNT_OR_CATEGORY", 11, alice, { kind: PAY, payee: "0x0000000000000000000000000000000000000000", amount: USD(5), category: 0, split: splitOf(all5) });

  await R.run("propose PAY pending for the freeze / execute path", "flow", "Pending", async (s) => {
    ids.frozenExec = spendIdOf(await propose(s, alice, { kind: PAY, payee: A.shop, amount: USD(50), category: 5, split: splitOf(all5) }));
  });
  await R.run("execute a proposal that is still pending (too early)", "failure", "422 INVALID_STATUS", async (s) => {
    await s.rejects(() => api.relay("execute", { pot, id: ids.frozenExec }), { status: 422, code: "INVALID_STATUS" }, pot);
  });
  await R.invariants("pot A spending");

  // ───── freeze ─────
  R.group = "pot A: freeze";
  await R.run("freeze", "flow", "Frozen until now + 24 h", async (s) => {
    const r = s.ok(await api.relay("freeze", await build.freeze(ctx, pot, erin)), "Frozen");
    const until = BigInt(findEvent(r, "Frozen")!.args.until);
    s.expect(until > (await chainNow(ctx)) + 86000n, "until ~ now + 24 h");
  });
  await blocked("plan is frozen", "FROZEN", 3, bob, { kind: PAY, payee: A.shop, amount: USD(5), category: 0, split: splitOf(all5) });
  await R.run("approval reached while frozen -> Approved, not executed", "flow", "Voted, SpendApproved, status Approved", async (s) => {
    s.ok(await api.relay("vote", await build.vote(ctx, pot, bob, ids.frozenExec, true)), "Voted", "SpendApproved");
    s.eq(await status(env, pot, ids.frozenExec), 2, "Approved");
  });
  await R.run("execute while frozen", "failure", "422 FROZEN (reason 3)", async (s) => {
    await s.rejects(() => api.relay("execute", { pot, id: ids.frozenExec }), { status: 422, code: "FROZEN", reason: 3 }, pot);
  });
  await R.run("freeze twice in 24 h", "failure", "422 FREEZE_COOLDOWN", async (s) => {
    await s.rejects(async () => api.relay("freeze", await build.freeze(ctx, pot, erin)), { status: 422, code: "FREEZE_COOLDOWN" }, pot);
  });
  await R.run("voteUnfreeze below majority", "flow", "2 of 5 votes: still frozen", async (s) => {
    s.ok(await api.relay("voteUnfreeze", await build.voteUnfreeze(ctx, pot, alice)));
    s.ok(await api.relay("voteUnfreeze", await build.voteUnfreeze(ctx, pot, bob)));
    s.expect(BigInt(await potRead(env, pot, "frozenUntil")) > (await chainNow(ctx)), "still frozen");
  });
  await R.run("voteUnfreeze twice", "failure", "422 ALREADY_VOTED", async (s) => {
    await s.rejects(async () => api.relay("voteUnfreeze", await build.voteUnfreeze(ctx, pot, alice)), { status: 422, code: "ALREADY_VOTED" }, pot);
  });
  await R.run("voteUnfreeze reaching majority", "flow", "Unfrozen", async (s) => {
    s.ok(await api.relay("voteUnfreeze", await build.voteUnfreeze(ctx, pot, carol)), "Unfrozen");
  });
  await R.run("voteUnfreeze when not frozen", "failure", "422 NOT_FROZEN", async (s) => {
    await s.rejects(async () => api.relay("voteUnfreeze", await build.voteUnfreeze(ctx, pot, dave)), { status: 422, code: "NOT_FROZEN" }, pot);
  });
  await R.run("execute an Approved proposal", "flow", "SpendExecuted; shop +50", async (s) => {
    const s0 = await ausdBal(env, A.shop);
    s.ok(await api.relay("execute", { pot, id: ids.frozenExec }), "SpendExecuted");
    s.eq((await ausdBal(env, A.shop)) - s0, USD(50), "shop delta");
  });
  await R.invariants("pot A freeze");

  // ───── disputes ─────
  R.group = "pot A: disputes";
  const did = (r: HttpResult) => BigInt(findEvent(r, "DisputeOpened")!.args.disputeId);
  let d1 = 0n;
  await R.run("openDispute", "flow", "DisputeOpened, AcksReset", async (s) => {
    d1 = did(s.ok(await api.relay("openDispute", await build.openDispute(ctx, pot, carol, ids.payInstant, 1, "0x77")), "DisputeOpened", "AcksReset"));
  });
  await R.run("double dispute on the same spend", "failure", "422 DISPUTE_ALREADY_OPEN", async (s) => {
    await s.rejects(async () => api.relay("openDispute", await build.openDispute(ctx, pot, dave, ids.payInstant, 0)), { status: 422, code: "DISPUTE_ALREADY_OPEN" }, pot);
  });
  await R.run("dispute by a member who is not in the split", "failure", "422 NOT_IN_SPLIT", async (s) => {
    await s.rejects(async () => api.relay("openDispute", await build.openDispute(ctx, pot, erin, ids.personal, 1)), { status: 422, code: "NOT_IN_SPLIT" }, pot);
  });
  await R.run("dispute by a non-member", "failure", "422 NOT_ACTIVE_MEMBER", async (s) => {
    await s.rejects(async () => api.relay("openDispute", await build.openDispute(ctx, pot, frank, ids.payApproved, 1)), { status: 422, code: "NOT_ACTIVE_MEMBER" }, pot);
  });
  await R.run("dispute a cancelled spend", "failure", "422 NOTHING_TO_DISPUTE", async (s) => {
    await s.rejects(async () => api.relay("openDispute", await build.openDispute(ctx, pot, dave, ids.rejected, 1)), { status: 422, code: "NOTHING_TO_DISPUTE" }, pot);
  });
  await R.run("dispute with an invalid reason", "failure", "400 INVALID_PARAMS (caught by the relayer)", async (s) => {
    await s.rejects(async () => api.relay("openDispute", await build.openDispute(ctx, pot, dave, ids.payApproved, 3)), { status: 400, code: "INVALID_PARAMS" }, pot);
  });
  await R.run("exit by a dispute's opener", "failure", "422 HAS_OPEN_ITEMS", async (s) => {
    await s.rejects(async () => api.relay("exit", await build.exit(ctx, pot, carol)), { status: 422, code: "HAS_OPEN_ITEMS" }, pot);
  });
  await R.run("exit by a dispute's subject", "failure", "422 HAS_OPEN_ITEMS", async (s) => {
    await s.rejects(async () => api.relay("exit", await build.exit(ctx, pot, bob)), { status: 422, code: "HAS_OPEN_ITEMS" }, pot);
  });
  await R.run("settle with an open dispute", "failure", "422 CANNOT_SETTLE", async (s) => {
    await s.rejects(() => api.relay("settle", { pot }), { status: 422, code: "CANNOT_SETTLE" }, pot);
  });
  await R.run("resolveDispute by someone other than the spend's proposer", "failure", "422 NOT_PROPOSER", async (s) => {
    await s.rejects(async () => api.relay("resolveDispute", await build.resolveDispute(ctx, pot, alice, d1, 2, splitOf([bob, carol]))), { status: 422, code: "NOT_PROPOSER" }, pot);
  });
  await R.run("resolveDispute Resplit with an invalid split", "failure", "422 INVALID_SPLIT", async (s) => {
    await s.rejects(async () => api.relay("resolveDispute", await build.resolveDispute(ctx, pot, bob, d1, 2, splitOf([bob, frank]))), { status: 422, code: "INVALID_SPLIT" }, pot);
  });
  await R.run("resolveDispute Resplit", "flow", "DisputeResolved(Resplit): alice/dave/erin +2, bob/carol -3", async (s) => {
    const before = await Promise.all(all5.map((m) => net(env, pot, m.address)));
    const r = s.ok(await api.relay("resolveDispute", await build.resolveDispute(ctx, pot, bob, d1, 2, splitOf([bob, carol]))), "DisputeResolved", "AcksReset");
    s.eq(findEvent(r, "DisputeResolved")!.args.outcome, 2, "outcome");
    const after = await Promise.all(all5.map((m) => net(env, pot, m.address)));
    s.eq(after.map((x, i) => x - before[i]), [USD(2), -USD(3), -USD(3), USD(2), USD(2)], "net deltas");
  });
  await R.run("resolveDispute SpenderCovers", "flow", "DisputeResolved(SpenderCovers): alice carries all 60", async (s) => {
    const d2 = did(s.ok(await api.relay("openDispute", await build.openDispute(ctx, pot, dave, ids.payApproved, 2)), "DisputeOpened"));
    const before = await net(env, pot, alice.address);
    const r = s.ok(await api.relay("resolveDispute", await build.resolveDispute(ctx, pot, alice, d2, 3, { members: [], weights: [] })), "DisputeResolved");
    s.eq(findEvent(r, "DisputeResolved")!.args.outcome, 3, "outcome");
    s.eq((await net(env, pot, alice.address)) - before, -USD(48), "alice takes the other 4 shares of 12");
  });
  let d3 = 0n;
  await R.run("openDispute for voting", "flow", "DisputeOpened", async (s) => {
    d3 = did(s.ok(await api.relay("openDispute", await build.openDispute(ctx, pot, erin, ids.payVotes, 2)), "DisputeOpened"));
  });
  await R.run("finalizeDispute before the period ends or everyone voted", "failure", "422 TOO_EARLY", async (s) => {
    await s.rejects(() => api.relay("finalizeDispute", { pot, disputeId: d3 }), { status: 422, code: "TOO_EARLY" }, pot);
  });
  await R.run("voteDispute by the opener", "failure", "422 NOT_ELIGIBLE_VOTER", async (s) => {
    await s.rejects(async () => api.relay("voteDispute", await build.voteDispute(ctx, pot, erin, d3, true)), { status: 422, code: "NOT_ELIGIBLE_VOTER" }, pot);
  });
  await R.run("voteDispute by the spend's proposer", "failure", "422 NOT_ELIGIBLE_VOTER", async (s) => {
    await s.rejects(async () => api.relay("voteDispute", await build.voteDispute(ctx, pot, carol, d3, false)), { status: 422, code: "NOT_ELIGIBLE_VOTER" }, pot);
  });
  await R.run("voteDispute", "flow", "DisputeVoted x2", async (s) => {
    s.ok(await api.relay("voteDispute", await build.voteDispute(ctx, pot, alice, d3, true)), "DisputeVoted");
    s.ok(await api.relay("voteDispute", await build.voteDispute(ctx, pot, bob, d3, true)), "DisputeVoted");
  });
  await R.run("voteDispute twice", "failure", "422 ALREADY_VOTED", async (s) => {
    await s.rejects(async () => api.relay("voteDispute", await build.voteDispute(ctx, pot, alice, d3, false)), { status: 422, code: "ALREADY_VOTED" }, pot);
  });
  await R.run("finalizeDispute early once every eligible voter voted", "flow", "2 of 3 for spenderCovers -> DisputeResolved(SpenderCovers)", async (s) => {
    s.ok(await api.relay("voteDispute", await build.voteDispute(ctx, pot, dave, d3, false)), "DisputeVoted");
    const r = s.ok(await api.relay("finalizeDispute", { pot, disputeId: d3 }), "DisputeResolved");
    s.eq(findEvent(r, "DisputeResolved")!.args.outcome, 3, "outcome");
  });
  await R.run("finalizeDispute on a closed dispute", "failure", "422 INVALID_STATUS", async (s) => {
    await s.rejects(() => api.relay("finalizeDispute", { pot, disputeId: d3 }), { status: 422, code: "INVALID_STATUS" }, pot);
  });
  await R.run("openDispute left open for the 48 h period", "flow", "DisputeOpened", async (s) => {
    out.d4 = did(s.ok(await api.relay("openDispute", await build.openDispute(ctx, pot, carol, ids.frozenExec, 0)), "DisputeOpened"));
  });
  await R.invariants("pot A disputes");

  // ───── rule change (applied in the time phase) ─────
  R.group = "pot A: rules";
  await R.run("proposeRules (allowlist policy, add shop)", "flow", "RuleChangeProposed, needs 3 of 5", async (s) => {
    const r = s.ok(await api.relay("proposeRules", await build.proposeRules(ctx, pot, alice, rules({ payeePolicy: 2 }), [A.shop], [])), "RuleChangeProposed");
    out.ruleId = BigInt(findEvent(r, "RuleChangeProposed")!.args.id);
    const info = await potRead<readonly unknown[]>(env, pot, "ruleChangeInfo", [out.ruleId]);
    s.eq(Number(info[2]), 3, "approvalsRequired");
  });
  await R.run("voteRules approve", "flow", "RuleChangeVoted", async (s) => {
    s.ok(await api.relay("voteRules", await build.voteRules(ctx, pot, bob, out.ruleId!, true)), "RuleChangeVoted");
  });
  await R.run("voteRules twice", "failure", "422 ALREADY_VOTED", async (s) => {
    await s.rejects(async () => api.relay("voteRules", await build.voteRules(ctx, pot, bob, out.ruleId!, true)), { status: 422, code: "ALREADY_VOTED" }, pot);
  });
  await R.run("voteRules by a non-member", "failure", "422 NOT_ACTIVE_MEMBER", async (s) => {
    await s.rejects(async () => api.relay("voteRules", await build.voteRules(ctx, pot, frank, out.ruleId!, true)), { status: 422, code: "NOT_ACTIVE_MEMBER" }, pot);
  });
  await R.run("voteRules reject does not cancel", "flow", "still Pending", async (s) => {
    s.ok(await api.relay("voteRules", await build.voteRules(ctx, pot, dave, out.ruleId!, false)), "RuleChangeVoted");
    const info = await potRead<readonly unknown[]>(env, pot, "ruleChangeInfo", [out.ruleId!]);
    s.eq(Number(info[0]), 1, "Pending");
  });
  await R.run("voteRules reaching majority", "flow", "RuleChangeApproved with eta = now + 600 s", async (s) => {
    const r = s.ok(await api.relay("voteRules", await build.voteRules(ctx, pot, carol, out.ruleId!, true)), "RuleChangeApproved");
    const eta = BigInt(findEvent(r, "RuleChangeApproved")!.args.eta);
    s.expect(eta >= (await chainNow(ctx)) + 590n, "eta ~ +600 s");
  });
  await R.run("applyRules before the timelock", "failure", "422 TOO_EARLY", async (s) => {
    await s.rejects(() => api.relay("applyRules", { pot, id: out.ruleId! }), { status: 422, code: "TOO_EARLY" }, pot);
  });
  await R.run("proposeRules with invalid rules (proposalTtl 0)", "failure", "422 INVALID_RULES", async (s) => {
    await s.rejects(async () => api.relay("proposeRules", await build.proposeRules(ctx, pot, alice, rules({ proposalTtl: 0 }))), { status: 422, code: "INVALID_RULES" }, pot);
  });

  // ───── acks ─────
  R.group = "pot A: acks";
  await R.run("ack", "flow", "Acked", async (s) => {
    s.ok(await api.relay("ack", await build.ack(ctx, pot, bob)), "Acked");
  });
  await R.run("ack twice", "failure", "422 ALREADY_ACKED", async (s) => {
    await s.rejects(async () => api.relay("ack", await build.ack(ctx, pot, bob)), { status: 422, code: "ALREADY_ACKED" }, pot);
  });
  await R.invariants("pot A");
  return out;
}
