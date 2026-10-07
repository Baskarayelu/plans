/**
 * Everything that needs the fork's clock to move: rule timelock and allowlist, proposal expiry,
 * contract-side signature expiry, Pot G's end (escrow refund before settlement, settlement by time
 * with pulls and debts, payDebt, the gas-starved payout attempt), the 48 h dispute period, exits,
 * Pot A's clean settlement and what a settled pot refuses, and an escrow refund after settlement.
 */
import { encodeFunctionData, getAddress, keccak256, stringToHex, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sendLocal, setMon } from "../lib/env";
import { ausdBal, net, potRead, warp, type Scenario } from "../lib/harness";
import { ABI, build, chainNow, codeToBytes, findEvent, findEvents, randomHex32, rules, USD, type HttpResult } from "../lib/plans";
import type { Later } from "./periphery";
import { PAY, PERSONAL, spendIdOf, splitOf, status, type PotA } from "./potA";
import type { Others } from "./otherPots";
import type { T } from "./types";

const INSUFFICIENT_GAS = keccak256(stringToHex("InsufficientGas()")).slice(0, 10);

export async function timeScenarios(t: T, A_: PotA, O: Others, _later: Later) {
  const { R, env, A } = t;
  const api = env.api;
  const ctx = env.ctx;
  const pot = A_.pot;
  const { alice, bob, carol, dave, erin, frank, ivy, kim, hank } = A;
  const ids: Record<string, bigint> = {};

  // ───── rule timelock and allowlist ─────
  R.group = "pot A: rules (after timelock)";
  await warp(env, 601);
  await R.run("applyRules after the timelock", "flow", "RuleChangeApplied, RulesSet; policy MEMBERS_AND_ALLOWLIST; shop allowlisted", async (s) => {
    s.ok(await api.relay("applyRules", { pot, id: A_.ruleId! }), "RuleChangeApplied", "RulesSet", "AllowlistChanged", "AcksReset");
    const r = await potRead<{ payeePolicy: number }>(env, pot, "getRules");
    s.eq(Number(r.payeePolicy), 2, "payeePolicy");
    s.eq(await potRead(env, pot, "isAllowedPayee", [A.shop]), true, "isAllowedPayee(shop)");
  });
  await R.run("applyRules twice", "failure", "422 INVALID_STATUS", async (s) => {
    await s.rejects(() => api.relay("applyRules", { pot, id: A_.ruleId! }), { status: 422, code: "INVALID_STATUS" }, pot);
  });
  await R.run("allowlist: PAY to an allowlisted business and to a member", "flow", "both SpendExecuted", async (s) => {
    s.ok(await api.relay("propose", await build.propose(ctx, pot, alice, { kind: PAY, payee: A.shop, amount: USD(5), category: 3, split: splitOf([alice]) })), "SpendExecuted");
    s.ok(await api.relay("propose", await build.propose(ctx, pot, alice, { kind: PAY, payee: bob.address, amount: USD(5), category: 3, split: splitOf([alice]) })), "SpendExecuted");
  });
  await R.run("SpendBlocked 5: allowlist enforcement (payee not allowlisted)", "failure", "422 PAYEE_NOT_ALLOWED (reason 5)", async (s) => {
    await s.rejects(async () => api.relay("propose", await build.propose(ctx, pot, alice, { kind: PAY, payee: A.stranger, amount: USD(5), category: 3, split: splitOf([alice]) })), { status: 422, code: "PAYEE_NOT_ALLOWED", reason: 5 }, pot);
  });
  let rule2 = 0n;
  await R.run("rule change removing the shop from the allowlist", "flow", "RuleChangeProposed, approved by 3 of 5", async (s) => {
    const r = s.ok(await api.relay("proposeRules", await build.proposeRules(ctx, pot, alice, rules({ payeePolicy: 2 }), [], [A.shop])), "RuleChangeProposed");
    rule2 = BigInt(findEvent(r, "RuleChangeProposed")!.args.id);
    s.ok(await api.relay("voteRules", await build.voteRules(ctx, pot, bob, rule2, true)));
    s.ok(await api.relay("voteRules", await build.voteRules(ctx, pot, carol, rule2, true)), "RuleChangeApproved");
  });

  // ───── proposal expiry ─────
  R.group = "pot A: expiry";
  await R.run("propose PAY pending (to expire)", "flow", "Pending", async (s) => {
    ids.e = spendIdOf(s.ok(await api.relay("propose", await build.propose(ctx, pot, alice, { kind: PAY, payee: bob.address, amount: USD(30), category: 0, split: splitOf([alice, bob]) }))));
  });
  await R.run("expire before expiry", "failure", "422 PROPOSAL_NOT_EXPIRED", async (s) => {
    await s.rejects(() => api.relay("expire", { pot, id: ids.e }), { status: 422, code: "PROPOSAL_NOT_EXPIRED" }, pot);
  });
  await R.run("approved while frozen, left past its expiry", "flow", "proposed, Frozen (dave), approval -> SpendApproved", async (s) => {
    ids.f = spendIdOf(s.ok(await api.relay("propose", await build.propose(ctx, pot, alice, { kind: PAY, payee: bob.address, amount: USD(40), category: 0, split: splitOf([alice, bob]) }))));
    s.ok(await api.relay("freeze", await build.freeze(ctx, pot, dave)), "Frozen");
    s.ok(await api.relay("vote", await build.vote(ctx, pot, bob, ids.f, true)), "SpendApproved");
  });
  await warp(env, 3601);
  await R.run("vote after expiry", "failure", "422 PROPOSAL_EXPIRED", async (s) => {
    await s.rejects(async () => api.relay("vote", await build.vote(ctx, pot, carol, ids.e, true)), { status: 422, code: "PROPOSAL_EXPIRED" }, pot);
  });
  await R.run("execute after expiry", "failure", "422 PROPOSAL_EXPIRED", async (s) => {
    await s.rejects(() => api.relay("execute", { pot, id: ids.f }), { status: 422, code: "PROPOSAL_EXPIRED" }, pot);
  });
  await R.run("expire (pending and approved)", "flow", "SpendCancelled reason 2 for both", async (s) => {
    for (const id of [ids.e, ids.f]) {
      const r = s.ok(await api.relay("expire", { pot, id }), "SpendCancelled");
      s.eq(findEvent(r, "SpendCancelled")!.args.reason, 2, "reason expired");
    }
  });
  await R.run("signature deadline passed onchain (but not by the wall clock)", "failure", "422 SIGNATURE_EXPIRED from the contract", async (s) => {
    const dl = (await chainNow(ctx)) - 60n;
    s.expect(dl > BigInt(Math.floor(Date.now() / 1000)), "deadline is still in the wall-clock future");
    await s.rejects(async () => api.relay("ack", await build.ack(ctx, pot, dave, { deadline: dl })), { status: 422, code: "SIGNATURE_EXPIRED" }, pot);
  });
  await R.run("contribute with a 3009 authorisation expired onchain (not by the wall clock)", "failure", "422, plain-English message, no state change", async (s) => {
    const vb = (await chainNow(ctx)) - 60n;
    s.expect(vb > BigInt(Math.floor(Date.now() / 1000)), "validBefore is still in the wall-clock future");
    const r = await s.rejects(async () => api.relay("contribute", await build.contribute(ctx, pot, bob, USD(1), { validBefore: vb })), { status: 422, code: "*" }, pot);
    s.note(`AUSD expired-authorisation revert decodes to ${r.body.error!.code}/${r.body.error!.error}`);
  });
  await R.run("unfreeze, then apply the allowlist removal", "flow", "Unfrozen; RuleChangeApplied", async (s) => {
    for (const m of [alice, bob]) s.ok(await api.relay("voteUnfreeze", await build.voteUnfreeze(ctx, pot, m)));
    s.ok(await api.relay("voteUnfreeze", await build.voteUnfreeze(ctx, pot, carol)), "Unfrozen");
    s.ok(await api.relay("applyRules", { pot, id: rule2 }), "RuleChangeApplied", "AllowlistChanged");
    s.eq(await potRead(env, pot, "isAllowedPayee", [A.shop]), false, "shop removed");
  });
  await R.run("SpendBlocked 5: payee removed from the allowlist", "failure", "422 PAYEE_NOT_ALLOWED (reason 5)", async (s) => {
    await s.rejects(async () => api.relay("propose", await build.propose(ctx, pot, alice, { kind: PAY, payee: A.shop, amount: USD(5), category: 3, split: splitOf([alice]) })), { status: 422, code: "PAYEE_NOT_ALLOWED", reason: 5 }, pot);
  });
  await R.invariants("pot A rules and expiry");

  // ───── Pot G at its end: refund before settlement, settle by time, debts, payDebt, gas ─────
  R.group = "pot G: ending";
  if (!O.G) {
    await R.run("Pot G ending scenarios", "flow", "Pot G set up", async () => {
      throw new Error("skipped: Pot G setup failed earlier");
    });
  } else await potGEnding(t, O.G);

  // ───── the 48 h dispute ─────
  R.group = "pot A: dispute period";
  await R.run("voteDispute against", "flow", "DisputeVoted (dave, spenderCovers=false)", async (s) => {
    s.ok(await api.relay("voteDispute", await build.voteDispute(ctx, pot, dave, A_.d4!, false)), "DisputeVoted");
  });
  await warp(env, 48 * 3600);
  await R.run("voteDispute after the voting period", "failure", "422 VOTING_CLOSED", async (s) => {
    await s.rejects(async () => api.relay("voteDispute", await build.voteDispute(ctx, pot, bob, A_.d4!, true)), { status: 422, code: "VOTING_CLOSED" }, pot);
  });
  await R.run("finalizeDispute after DISPUTE_PERIOD", "flow", "no majority for spenderCovers (0 of 1) -> Keep, shares unchanged", async (s) => {
    const before = await Promise.all(A_.all.map((m) => net(env, pot, m.address)));
    const r = s.ok(await api.relay("finalizeDispute", { pot, disputeId: A_.d4! }), "DisputeResolved");
    s.eq(findEvent(r, "DisputeResolved")!.args.outcome, 1, "outcome Keep");
    s.eq(await Promise.all(A_.all.map((m) => net(env, pot, m.address))), before, "nets unchanged");
  });
  await R.invariants("pot A disputes closed");

  R.group = "pot F: settle 50 members";
  if (O.F) {
    const F = O.F;
    await R.run("settle a 50-member pot by time (49 debtors, one creditor short of funds)", "flow", "Settled within the relayer's settle gas cap; 49 DebtRecorded; I1 holds", async (s) => {
      const n = await chainNow(ctx);
      if (n < F.endTime) await warp(env, Number(F.endTime - n) + 1);
      const r = s.ok(await api.relay("settle", { pot: F.pot }), "Settled");
      s.eq(findEvents(r, "DebtRecorded").length, 49, "debts");
      s.note(`settle with 50 members: gasUsed ${r.body.gasUsed}, gasLimit ${r.body.gasLimit} (relayer cap 5,000,000)`);
    });
  }

  // ───── exits ─────
  R.group = "pot A: exits";
  await R.run("two late joiners take on a cost", "flow", "kim (no money) and hank (permit 30) join; dave PERSONAL 40 split between them, approved", async (s) => {
    s.ok(await api.relay("join", await build.join(ctx, pot, kim, A_.invite)), "MemberJoined");
    s.ok(await api.relay("join", await build.join(ctx, pot, hank, A_.invite, { safetyNet: USD(30) })), "MemberJoined");
    const id = spendIdOf(s.ok(await api.relay("propose", await build.propose(ctx, pot, dave, { kind: PERSONAL, payee: dave.address, amount: USD(40), category: 7, split: splitOf([kim, hank]) }))));
    s.ok(await api.relay("vote", await build.vote(ctx, pot, bob, id, true)), "SpendExecuted");
    s.eq([await net(env, pot, kim.address), await net(env, pot, hank.address)], [-USD(20), -USD(20)], "nets");
  });
  await R.run("payDebt by an active member before settlement", "failure", "422 DEBT_NOT_DUE", async (s) => {
    await s.rejects(async () => api.relay("payDebt", await build.payDebt(ctx, pot, hank, USD(5))), { status: 422, code: "DEBT_NOT_DUE" }, pot);
  });
  await R.run("exit with an open proposal", "failure", "422 HAS_OPEN_ITEMS", async (s) => {
    ids.open = spendIdOf(s.ok(await api.relay("propose", await build.propose(ctx, pot, alice, { kind: PAY, payee: bob.address, amount: USD(30), category: 0, split: splitOf([alice]) }))));
    await s.rejects(async () => api.relay("exit", await build.exit(ctx, pot, alice)), { status: 422, code: "HAS_OPEN_ITEMS" }, pot);
    s.ok(await api.relay("cancelSpend", await build.cancelSpend(ctx, pot, alice, ids.open)), "SpendCancelled");
  });
  await R.run("exit with a negative net and no allowance", "flow", "MemberExited(-20, 0, 0), DebtRecorded 20", async (s) => {
    const r = s.ok(await api.relay("exit", await build.exit(ctx, pot, kim)), "MemberExited", "DebtRecorded");
    const e = findEvent(r, "MemberExited")!.args;
    s.eq([e.netAtExit, e.paidOut, e.pulledIn], [(-USD(20)).toString(), "0", "0"], "MemberExited");
    s.eq(await potRead(env, pot, "isMember", [kim.address]), false, "inactive");
  });
  await R.run("join again after exiting", "failure", "422 ALREADY_MEMBER", async (s) => {
    await s.rejects(async () => api.relay("join", await build.join(ctx, pot, kim, A_.invite)), { status: 422, code: "ALREADY_MEMBER" }, pot);
  });
  await R.run("payDebt by an exited member before settlement", "flow", "kim is sent 20 (PlansSend), pays her debt; DebtPaid; money stays in the pot", async (s) => {
    const meta = { to: kim.address, fromCountry: codeToBytes("GB", 2), toCountry: codeToBytes("GB", 2), fromCurrency: codeToBytes("GBP", 3), toCurrency: codeToBytes("GBP", 3), fxRateE8: 100000000n, fxTimestamp: 0n, memoHash: `0x${"00".repeat(32)}` as Hex, salt: randomHex32() };
    s.ok(await api.relay("send", await build.send(ctx, frank, USD(20), meta)), "Sent");
    const b0 = await ausdBal(env, pot);
    s.ok(await api.relay("payDebt", await build.payDebt(ctx, pot, kim, USD(20))), "DebtPaid");
    s.eq(await net(env, pot, kim.address), 0n, "kim net");
    s.eq((await ausdBal(env, pot)) - b0, USD(20), "pot delta");
  });
  await R.run("exit with a negative net, pulled through the safety-net allowance", "flow", "Pulled 20, MemberExited(-20, 0, 20), no debt", async (s) => {
    const r = s.ok(await api.relay("exit", await build.exit(ctx, pot, hank)), "Pulled", "MemberExited");
    s.expect(!findEvent(r, "DebtRecorded"), "no DebtRecorded");
    s.eq(findEvent(r, "MemberExited")!.args.pulledIn, USD(20).toString(), "pulledIn");
    s.eq(await net(env, pot, hank.address), 0n, "hank net");
  });
  await R.run("exit with a positive net", "flow", "Payout = net, MemberExited", async (s) => {
    const n = await net(env, pot, erin.address);
    s.expect(n > 0n, `erin's net is positive (${n})`);
    const e0 = await ausdBal(env, erin.address);
    const r = s.ok(await api.relay("exit", await build.exit(ctx, pot, erin)), "Payout", "MemberExited");
    s.eq((await ausdBal(env, erin.address)) - e0, n, "paid out");
    s.eq(findEvent(r, "MemberExited")!.args.paidOut, n.toString(), "paidOut");
  });
  await R.run("exit by a member who already left", "failure", "422 NOT_ACTIVE_MEMBER", async (s) => {
    await s.rejects(async () => api.relay("exit", await build.exit(ctx, pot, erin)), { status: 422, code: "NOT_ACTIVE_MEMBER" }, pot);
  });
  await R.invariants("pot A exits");

  // ───── clean settlement ─────
  R.group = "pot A: settle";
  const active = [alice, bob, carol, dave];
  await R.run("members who owe top up (contribute)", "flow", "every active net >= 0", async (s) => {
    for (const m of active) {
      const n = await net(env, pot, m.address);
      if (n < 0n) s.ok(await api.relay("contribute", await build.contribute(ctx, pot, m, -n)), "Contributed");
    }
    for (const m of active) s.expect((await net(env, pot, m.address)) >= 0n, `${m.address} net >= 0`);
  });
  await R.run("settle with an open proposal (everyone acked)", "failure", "422 CANNOT_SETTLE", async (s) => {
    ids.block = spendIdOf(s.ok(await api.relay("propose", await build.propose(ctx, pot, bob, { kind: PAY, payee: alice.address, amount: USD(30), category: 0, split: splitOf([bob]) }))));
    for (const m of active) s.ok(await api.relay("ack", await build.ack(ctx, pot, m)), "Acked");
    s.eq(await potRead(env, pot, "canSettle"), false, "canSettle");
    await s.rejects(() => api.relay("settle", { pot }), { status: 422, code: "CANNOT_SETTLE" }, pot);
  });
  await R.run("settle by unanimous acks (ends early), full payout", "flow", "Settled; every positive net paid; pot holds 0", async (s) => {
    s.ok(await api.relay("cancelSpend", await build.cancelSpend(ctx, pot, bob, ids.block)), "SpendCancelled");
    s.eq(await potRead(env, pot, "canSettle"), true, "canSettle (cancel keeps acks)");
    const nets = await Promise.all(active.map((m) => net(env, pot, m.address)));
    const r = s.ok(await api.relay("settle", { pot }), "Settled");
    s.expect(!findEvent(r, "DebtRecorded"), "no debts");
    s.eq(findEvent(r, "Settled")!.args.unpaidClaims, "0", "no unpaid claims");
    s.eq(await ausdBal(env, pot), 0n, "pot balance");
    s.note(`payouts: ${findEvents(r, "Payout").map((e) => e.args.amount).join(", ")} (nets before ${nets.join(", ")})`);
  });
  await R.invariants("pot A settled", { cleanSettled: [pot] });

  R.group = "pot A: after settlement";
  const fresh = privateKeyToAccount(generatePrivateKey());
  const settledCases: [string, () => Promise<HttpResult>, string, number?][] = [
    ["join a settled pot", async () => api.relay("join", await build.join(ctx, pot, fresh, A_.invite)), "POT_SETTLED"],
    ["settle twice", async () => api.relay("settle", { pot }), "CANNOT_SETTLE"],
    ["propose after settlement", async () => api.relay("propose", await build.propose(ctx, pot, alice, { kind: PERSONAL, payee: alice.address, amount: USD(1), category: 0, split: splitOf([alice]) })), "PLAN_NOT_OPEN", 2],
    ["ack after settlement", async () => api.relay("ack", await build.ack(ctx, pot, alice)), "POT_SETTLED"],
    ["freeze after settlement", async () => api.relay("freeze", await build.freeze(ctx, pot, alice)), "POT_SETTLED"],
    ["exit after settlement", async () => api.relay("exit", await build.exit(ctx, pot, alice)), "POT_SETTLED"],
    ["contribute after settlement", async () => api.relay("contribute", await build.contribute(ctx, pot, alice, USD(1))), "POT_SETTLED"],
    ["proposeRules after settlement", async () => api.relay("proposeRules", await build.proposeRules(ctx, pot, alice, rules())), "POT_SETTLED"],
    ["openDispute after settlement", async () => api.relay("openDispute", await build.openDispute(ctx, pot, alice, 1n, 0)), "POT_SETTLED"],
  ];
  for (const [name, send, code, reason] of settledCases) {
    await R.run(name, "failure", `422 ${code}${reason ? ` (reason ${reason})` : ""}`, async (s) => {
      await s.rejects(send, { status: 422, code, reason }, pot);
    });
  }

  // ───── escrow refund after settlement ─────
  R.group = "pot A: escrow refund after settlement";
  await R.run("claimRefund of a pot LINK after settlement", "flow", "ClaimRefunded, EscrowRefunded; the 15 is paid out to the positive nets (dave, carol)", async (s) => {
    const info = (await env.anvil.pub.readContract({ address: env.dep.claimEscrow, abi: ABI.escrow, functionName: "claimInfo", args: [A_.k3!.claimId] })) as readonly unknown[];
    const expiry = BigInt(info[3] as bigint);
    const n = await chainNow(ctx);
    if (n <= expiry) await warp(env, Number(expiry - n) + 1);
    const d0 = await ausdBal(env, dave.address);
    const c0 = await ausdBal(env, carol.address);
    const r = s.ok(await api.relay("claimRefund", { id: A_.k3!.claimId }), "ClaimRefunded", "EscrowRefunded", "Payout");
    const paid = (await ausdBal(env, dave.address)) - d0 + (await ausdBal(env, carol.address)) - c0;
    s.eq(paid, USD(15), "paid out to dave + carol");
    s.note(`payouts ${findEvents(r, "Payout").map((e) => `${e.args.member}:${e.args.amount}`).join(", ")}; pot left ${await ausdBal(env, pot)}`);
  });
  await R.invariants("escrow refund after settlement");
}


async function potGEnding(t: T, g: NonNullable<Others["G"]>) {
  const { R, env, A } = t;
  const api = env.api;
  const ctx = env.ctx;
  const { carol, erin, frank, ivy } = A;
  const G = g.pot;
  const now = await chainNow(ctx);
  if (now <= g.endTime) await warp(env, Number(g.endTime - now) + 5);
  await R.run("SpendBlocked 2: plan has ended", "failure", "422 PLAN_NOT_OPEN (reason 2)", async (s) => {
    await s.rejects(async () => api.relay("propose", await build.propose(ctx, G, ivy, { kind: PERSONAL, payee: ivy.address, amount: USD(1), category: 0, split: splitOf([ivy]) })), { status: 422, code: "PLAN_NOT_OPEN", reason: 2 }, G);
  });
  await R.run("claimRefund of a pot LINK before settlement", "flow", "ClaimRefunded to the pot, EscrowRefunded, AcksReset; carol's share reversed (-25 -> -20)", async (s) => {
    const r = s.ok(await api.relay("claimRefund", { id: g.k5ClaimId }), "ClaimRefunded", "EscrowRefunded", "AcksReset");
    s.eq(getAddress(findEvent(r, "ClaimRefunded")!.args.to), G, "refund to the pot");
    s.eq(await net(env, G, carol.address), -USD(20), "carol net");
    s.eq(await ausdBal(env, G), USD(10), "pot balance");
  });
  await R.run("settle after endTime + reviewWindow, partial, with a pull and debts", "flow", "Pulled erin 10; ivy paid 20 of 60 pro rata; DebtRecorded carol 20, erin 20; Settled(20, 10, 40)", async (s) => {
    s.eq(await potRead(env, G, "canSettle"), true, "canSettle without acks");
    const r = s.ok(await api.relay("settle", { pot: G }), "Settled", "Pulled", "Payout", "DebtRecorded");
    const st = findEvent(r, "Settled")!.args;
    s.eq([st.paidOut, st.pulledIn, st.unpaidClaims], [USD(20).toString(), USD(10).toString(), USD(40).toString()], "Settled args");
    s.eq(findEvents(r, "DebtRecorded").map((e) => [getAddress(e.args.member), e.args.amount]), [[carol.address, USD(20).toString()], [erin.address, USD(20).toString()]], "debts");
    s.eq([await net(env, G, carol.address), await net(env, G, erin.address), await net(env, G, ivy.address)], [-USD(20), -USD(20), USD(40)], "nets");
    s.eq(await ausdBal(env, G), 0n, "pot balance");
  });
  await R.run("payDebt by a member who owes nothing", "failure", "422 INVALID_AMOUNT", async (s) => {
    await s.rejects(async () => api.relay("payDebt", await build.payDebt(ctx, G, ivy, USD(1))), { status: 422, code: "INVALID_AMOUNT" }, G);
  });
  await R.run("payDebt of more than the debt", "failure", "422 INVALID_AMOUNT", async (s) => {
    await s.rejects(async () => api.relay("payDebt", await build.payDebt(ctx, G, erin, USD(25))), { status: 422, code: "INVALID_AMOUNT" }, G);
  });
  await R.run("payDebt by a non-member", "failure", "422 NOT_MEMBER", async (s) => {
    await s.rejects(async () => api.relay("payDebt", await build.payDebt(ctx, G, frank, USD(1))), { status: 422, code: "NOT_MEMBER" }, G);
  });
  await R.run("payDebt after settlement (distributed at once)", "flow", "DebtPaid erin 20, Payout ivy 20", async (s) => {
    const i0 = await ausdBal(env, ivy.address);
    s.ok(await api.relay("payDebt", await build.payDebt(ctx, G, erin, USD(20))), "DebtPaid", "Payout");
    s.eq((await ausdBal(env, ivy.address)) - i0, USD(20), "ivy delta");
    s.eq(await net(env, G, erin.address), 0n, "erin net");
  });
  await R.run("creditor empties her wallet with PlansSend (fresh balance slot for the gas test)", "flow", "Sent; ivy holds 0", async (s) => {
    const all = await ausdBal(env, ivy.address);
    const meta = { to: frank.address, fromCountry: codeToBytes("IN", 2), toCountry: codeToBytes("GB", 2), fromCurrency: codeToBytes("INR", 3), toCurrency: codeToBytes("GBP", 3), fxRateE8: 0n, fxTimestamp: 0n, memoHash: `0x${"00".repeat(32)}` as Hex, salt: randomHex32() };
    s.ok(await api.relay("send", await build.send(ctx, ivy, all, meta)), "Sent");
    s.eq(await ausdBal(env, ivy.address), 0n, "ivy balance");
  });
  await R.run("gas-starved payDebt cannot skip the creditor's payout", "failure", "every gas limit either reverts or pays the creditor; the starved window reverts InsufficientGas; a real starved tx reverts and changes nothing", async (s) => {
    await gasScan(s, t, G);
  });
  await R.run("payDebt clears the last debt (via the relayer's estimate)", "flow", "DebtPaid, Payout ivy 20; all nets 0; pot holds 0", async (s) => {
    const r = s.ok(await api.relay("payDebt", await build.payDebt(ctx, G, carol, USD(20))), "DebtPaid", "Payout");
    s.eq(getAddress(findEvent(r, "Payout")!.args.member), ivy.address, "payout to ivy");
    s.eq([await net(env, G, carol.address), await net(env, G, erin.address), await net(env, G, ivy.address)], [0n, 0n, 0n], "nets");
  });
  await R.invariants("pot G settled", { cleanSettled: [G] });

}

/**
 * Plays an attacker who submits a third party's payDebt with a chosen gas limit. Scans eth_call
 * over gas limits (no state change), classifies each as success / InsufficientGas / other revert,
 * checks every successful limit with debug_traceCall that the creditor's Payout is in the logs,
 * then sends one real starved transaction (local anvil only) and checks nothing changed.
 */
async function gasScan(s: Scenario, t: T, G: Address) {
  const { env, A } = t;
  const a = env.anvil;
  await setMon(a, A.griefer.address, 10n ** 19n);
  const p = await build.payDebt(env.ctx, G, A.carol, USD(20));
  const data = encodeFunctionData({ abi: ABI.pot, functionName: "payDebt", args: [A.carol.address, p.auth] });
  const call = { from: A.griefer.address, to: G, data };
  const est = BigInt(await a.rpc<Hex>("eth_estimateGas", [call, "latest"]));
  const payoutTopic = keccak256(stringToHex("Payout(address,uint256)"));
  const ivyTopic = `0x${A.ivy.address.slice(2).toLowerCase().padStart(64, "0")}`;
  let ok = 0, starved = 0, other = 0, skipped = 0, traced = 0;
  let highestStarved = 0n;
  const step = 250n;
  for (let g = 30_000n; g <= est + 2_000n; g += step) {
    try {
      await a.rpc("eth_call", [{ ...call, gas: toHex(g) }, "latest"]);
      ok++;
      try {
        const tr = await a.rpc<any>("debug_traceCall", [{ ...call, gas: toHex(g) }, "latest", { tracer: "callTracer", tracerConfig: { withLog: true } }]);
        traced++;
        const logs: { address: string; topics: string[] }[] = [];
        const walk = (c: any) => {
          for (const l of c.logs ?? []) logs.push(l);
          for (const x of c.calls ?? []) walk(x);
        };
        walk(tr);
        const paid = logs.some((l) => l.address.toLowerCase() === G.toLowerCase() && l.topics[0] === payoutTopic && l.topics[1]?.toLowerCase() === ivyTopic);
        if (!paid) skipped++;
      } catch {
        /* tracer unavailable: counted as untraced */
      }
    } catch (e) {
      const d = String((e as { data?: unknown }).data ?? "");
      if (d.startsWith(INSUFFICIENT_GAS)) {
        starved++;
        if (g > highestStarved) highestStarved = g;
      } else other++;
    }
  }
  s.note(`estimate ${est}; scanned 30,000..${est + 2000n} step ${step}: ${ok} succeed (${traced} traced, ${skipped} without the creditor's Payout), ${starved} revert InsufficientGas, ${other} other reverts (out of gas)`);
  s.eq(skipped, 0, "successful calls that skipped the creditor's payout");
  s.expect(traced === ok, `every successful gas limit was traced (${traced}/${ok}); debug_traceCall must be available`);
  s.expect(starved > 0, "no gas limit hit InsufficientGas: the starved window was not found");
  // A real starved transaction on the fork.
  const n0 = await net(env, G, A.carol.address);
  const b0 = await ausdBal(env, A.ivy.address);
  const tx = await sendLocal(a, A.griefer, { to: G, data, gas: highestStarved });
  s.txs.push(tx.hash);
  s.eq(tx.status, "reverted", `starved tx at gas ${highestStarved}`);
  s.eq([await net(env, G, A.carol.address), await ausdBal(env, A.ivy.address)], [n0, b0], "nothing changed");
  s.actual = `${starved} limits revert InsufficientGas, ${ok} succeed and all pay the creditor, starved tx at ${highestStarved} gas reverted (estimate ${est})`;
}
