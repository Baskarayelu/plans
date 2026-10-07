/**
 * Smaller pots for the rule-driven SpendBlocked codes (2, 4, 6, 7, 8), a front-run permit,
 * MAX_MEMBERS, frozen creditors at settlement and `collect` afterwards, and Pot G (partial settlement with debts; its end is
 * reached in the time phase).
 */
import { encodeFunctionData, getAddress, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { sendLocal, setAusdFrozen, setMon } from "../lib/env";
import { ausdBal, net, potRead } from "../lib/harness";
import { ABI, build, findEvent, findEvents, invitee, potParams, rules, USD, HOUR } from "../lib/plans";
import { randomBytes, toHex } from "../../../app/src/lib/crypto/bytes";
import { LINK, PAY, PERSONAL, splitOf } from "./potA";
import type { T } from "./types";

export interface Others {
  G?: { pot: Address; endTime: bigint; k5ClaimId: bigint; invite: PrivateKeyAccount };
  F?: { pot: Address; endTime: bigint };
}

export async function otherPotScenarios({ R, env, A }: T): Promise<Others> {
  const api = env.api;
  const ctx = env.ctx;
  const out: Others = {};
  const { alice, bob, carol, dave, erin, gina, ivy } = A;
  const create = async (label: string, creator: PrivateKeyAccount, over: Parameters<typeof potParams>[2], x: { deposit?: bigint } = {}) => {
    const invite = invitee();
    const b = await build.createPot(ctx, creator, await potParams(ctx, invite.address, over), x);
    const r = await api.relay("createPot", b.params);
    if (r.status === 200 && r.body.status === "success") {
      env.pots.set(b.pot, label);
      env.tracked.set(b.pot.toLowerCase(), `pot ${label}`);
    }
    return { r, pot: b.pot, invite };
  };

  // ───── Pot B: min contribution, category budget, daily cap ─────
  R.group = "pot B: rules";
  let B: Address | undefined;
  let iB: PrivateKeyAccount | undefined;
  await R.run("createPot bare", "flow", "PotCreated + MemberJoined, no deposit", async (s) => {
    const c = await create("B", bob, { rules: rules({ minContribution: USD(10), memberDailyCap: USD(30), categoryBudgets: [0n, 0n, 0n, USD(20), 0n, 0n, 0n, 0n] }) });
    s.ok(c.r, "PotCreated", "MemberJoined");
    s.expect(!findEvent(c.r, "Contributed"), "no Contributed");
    B = c.pot;
    iB = c.invite;
  });
  await R.run("join with a safety-net permit that was front-run", "flow", "permit submitted directly to AUSD first; join still succeeds (try/catch), allowance 5", async (s) => {
    const p = await build.join(ctx, B!, carol, iB!, { safetyNet: USD(5) });
    await setMon(env.anvil, A.griefer.address, 10n ** 19n);
    const sp = p.safetyNet;
    const fr = await sendLocal(env.anvil, A.griefer, {
      to: env.dep.ausd,
      data: encodeFunctionData({ abi: ABI.ausd, functionName: "permit", args: [carol.address, B!, sp.value, sp.deadline, sp.v, sp.r, sp.s] }),
    });
    s.eq(fr.status, "success", "front-run permit tx");
    s.txs.push(fr.hash);
    s.ok(await api.relay("join", p), "MemberJoined");
    s.eq(await env.anvil.pub.readContract({ address: env.dep.ausd, abi: ABI.ausd, functionName: "allowance", args: [carol.address, B!] }), USD(5), "allowance");
  });
  const blockedB = (reason: number, code: string, name: string, who: PrivateKeyAccount, p: Parameters<typeof build.propose>[3], pot?: () => Address) =>
    R.run(`SpendBlocked ${reason}: ${name}`, "failure", `422 ${code} (reason ${reason})`, async (s) => {
      const target = (pot ?? (() => B!))();
      await s.rejects(async () => api.relay("propose", await build.propose(ctx, target, who, p)), { status: 422, code, reason, error: "SpendBlocked" }, target);
    });
  await blockedB(4, "MIN_CONTRIBUTION_NOT_MET", "minimum contribution not met", bob, { kind: PAY, payee: A.shop, amount: USD(5), category: 0, split: splitOf([bob, carol]) });
  await R.run("contributions meet the minimum", "flow", "Contributed x2", async (s) => {
    s.ok(await api.relay("contribute", await build.contribute(ctx, B!, bob, USD(50))), "Contributed");
    s.ok(await api.relay("contribute", await build.contribute(ctx, B!, carol, USD(10))), "Contributed");
  });
  await R.run("settle before the end with only some acks (no open items)", "failure", "422 CANNOT_SETTLE", async (s) => {
    s.ok(await api.relay("ack", await build.ack(ctx, B!, bob)), "Acked");
    s.eq(await potRead(env, B!, "canSettle"), false, "canSettle");
    await s.rejects(() => api.relay("settle", { pot: B! }), { status: 422, code: "CANNOT_SETTLE" }, B!);
  });
  await blockedB(6, "OVER_CATEGORY_BUDGET", "over the category budget", bob, { kind: PAY, payee: A.shop, amount: USD(25), category: 3, split: splitOf([bob, carol]) });
  await R.run("spend within the daily cap", "flow", "SpendExecuted (20 of 30)", async (s) => {
    s.ok(await api.relay("propose", await build.propose(ctx, B!, bob, { kind: PAY, payee: A.shop, amount: USD(20), category: 0, split: splitOf([bob, carol]) })), "SpendExecuted");
  });
  await blockedB(7, "OVER_DAILY_CAP", "over the member daily cap", bob, { kind: PAY, payee: A.shop, amount: USD(15), category: 0, split: splitOf([bob, carol]) });

  // ───── Pot C: total cap; Pot D: not started ─────
  R.group = "pot C/D: rules";
  let C: Address | undefined;
  await R.run("createPot with a deposit only", "flow", "PotCreated, Contributed 50", async (s) => {
    const c = await create("C", dave, { rules: rules({ memberTotalCap: USD(15) }) }, { deposit: USD(50) });
    s.ok(c.r, "PotCreated", "Contributed");
    C = c.pot;
  });
  await blockedB(8, "OVER_TOTAL_CAP", "over the member total cap", dave, { kind: PAY, payee: A.shop, amount: USD(20), category: 0, split: splitOf([dave]) }, () => C!);
  let D: Address | undefined;
  await R.run("createPot starting tomorrow", "flow", "PotCreated", async (s) => {
    const c = await create("D", erin, { startIn: 86400 });
    s.ok(c.r, "PotCreated");
    D = c.pot;
  });
  await blockedB(2, "PLAN_NOT_OPEN", "plan has not started", erin, { kind: PERSONAL, payee: erin.address, amount: USD(5), category: 0, split: splitOf([erin]) }, () => D!);
  await R.invariants("pots B/C/D");

  // ───── Pot F: MAX_MEMBERS ─────
  R.group = "pot F: MAX_MEMBERS";
  await R.run("50 members (creator + 49 joins), then the 51st", "failure", "49 joins succeed; 51st -> 422 POT_FULL", async (s) => {
    const c = await create("F", gina, { rules: rules({ instantMax: USD(1000) }), endIn: 49 * HOUR, reviewWindow: 0 }, { deposit: USD(100) });
    s.ok(c.r, "PotCreated", "Contributed");
    const joined: PrivateKeyAccount[] = [gina];
    for (let i = 0; i < 49; i++) {
      const m = privateKeyToAccount(generatePrivateKey());
      joined.push(m);
      const r = await api.relay("join", await build.join(ctx, c.pot, m, c.invite));
      if (r.status !== 200 || r.body.status !== "success") s.expect(false, `join ${i + 2} failed: ${JSON.stringify(r.body.error)}`);
    }
    s.eq(Number(await potRead(env, c.pot, "memberCount")), 50, "memberCount");
    s.note("49 join transactions not listed individually");
    const extra = privateKeyToAccount(generatePrivateKey());
    await s.rejects(async () => api.relay("join", await build.join(ctx, c.pot, extra, c.invite)), { status: 422, code: "POT_FULL" }, c.pot);
    // a 50-way split, settled in the time phase (worst-case loops)
    s.ok(await api.relay("propose", await build.propose(ctx, c.pot, gina, { kind: PERSONAL, payee: gina.address, amount: USD(100), category: 7, split: splitOf(joined) })), "SpendExecuted");
    out.F = { pot: c.pot, endTime: BigInt(await potRead(env, c.pot, "endTime")) };
  });

  // ───── Pot H: creditors AUSD refuses at settlement; collect afterwards (finding F1) ─────
  R.group = "pot H: frozen creditor";
  let H: Address | undefined;
  const { rex } = A;
  await R.run("settle while two creditors are frozen by AUSD", "flow", "Settled; the frozen members' payouts are skipped and kept as their claims; alice paid", async (s) => {
    const c = await create("H", alice, { rules: rules() }, { deposit: USD(20) });
    s.ok(c.r, "PotCreated", "Contributed");
    H = c.pot;
    s.ok(await api.relay("join", await build.join(ctx, H, bob, c.invite, { deposit: USD(10) })), "MemberJoined");
    s.ok(await api.relay("join", await build.join(ctx, H, rex, c.invite, { deposit: USD(5) })), "MemberJoined");
    for (const m of [alice, bob, rex]) s.ok(await api.relay("ack", await build.ack(ctx, H, m)), "Acked");
    // bob: frozen now, unfrozen later. rex: frozen for the rest of the run (a recipient AUSD always refuses).
    await setAusdFrozen(env.anvil, bob.address, true);
    await setAusdFrozen(env.anvil, rex.address, true);
    const a0 = await ausdBal(env, alice.address);
    const b0 = await ausdBal(env, bob.address);
    const r = s.ok(await api.relay("settle", { pot: H }), "Settled");
    const payouts = findEvents(r, "Payout").map((e) => getAddress(e.args.member));
    s.eq((await ausdBal(env, alice.address)) - a0, USD(20), "alice paid");
    s.eq([payouts.includes(bob.address), payouts.includes(rex.address)], [false, false], "no Payout to the frozen members");
    s.eq(await ausdBal(env, bob.address), b0, "bob unpaid");
    s.eq([await net(env, H, bob.address), await net(env, H, rex.address)], [USD(10), USD(5)], "claims kept");
    s.eq(await ausdBal(env, H), USD(15), "pot still holds the two claims");
    s.eq(findEvent(r, "Settled")!.args.unpaidClaims, USD(15).toString(), "Settled.unpaidClaims");
  });
  await R.run("collect while the creditor is still frozen", "failure", "422 PAYOUT_REFUSED, claim kept", async (s) => {
    await s.rejects(() => api.relay("collect", { pot: H!, member: bob.address }), { status: 422, code: "PAYOUT_REFUSED", error: "PayoutRefused" }, H!);
  });
  await R.run("collect after AUSD unfreezes the creditor (frozen-then-unfrozen recipient)", "flow", "Payout + Collected to bob only, +10; submitted by a third party; rex (still refused) does not block it", async (s) => {
    await setAusdFrozen(env.anvil, bob.address, false);
    const b0 = await ausdBal(env, bob.address);
    const a0 = await ausdBal(env, alice.address);
    const r = s.ok(await api.relay("collect", { pot: H!, member: bob.address }), "Payout", "Collected");
    const ev = findEvent(r, "Collected")!.args;
    s.eq([getAddress(ev.member), ev.amount], [bob.address, USD(10).toString()], "Collected");
    s.eq(findEvents(r, "Payout").map((e) => getAddress(e.args.member)), [bob.address], "only bob paid");
    s.eq((await ausdBal(env, bob.address)) - b0, USD(10), "bob +10");
    s.eq(await ausdBal(env, alice.address), a0, "alice unchanged");
    s.eq(await net(env, H!, bob.address), 0n, "bob's claim cleared");
    s.eq([await ausdBal(env, H!), await net(env, H!, rex.address)], [USD(5), USD(5)], "rex's claim still held");
    s.note(`Collected.by = ${getAddress(ev.by)} (a relayer lane; anyone may submit)`);
  });
  await R.run("collect for a recipient AUSD always refuses", "failure", "422 PAYOUT_REFUSED every time; claim kept, nothing moves", async (s) => {
    for (let i = 0; i < 2; i++) await s.rejects(() => api.relay("collect", { pot: H!, member: rex.address }), { status: 422, code: "PAYOUT_REFUSED" }, H!);
  });
  await R.run("collect again with nothing owed", "failure", "422 NOTHING_TO_COLLECT", async (s) => {
    await s.rejects(() => api.relay("collect", { pot: H!, member: bob.address }), { status: 422, code: "NOTHING_TO_COLLECT" }, H!);
  });
  await R.run("collect for an address that never joined", "failure", "422 NOT_MEMBER", async (s) => {
    await s.rejects(() => api.relay("collect", { pot: H!, member: A.stranger }), { status: 422, code: "NOT_MEMBER" }, H!);
  });
  await R.run("collect on a pot that is not settled", "failure", "422 NOT_SETTLED", async (s) => {
    await s.rejects(() => api.relay("collect", { pot: B!, member: bob.address }), { status: 422, code: "NOT_SETTLED" }, B!);
  });
  await R.run("collect with a malformed member", "failure", "400 INVALID_PARAMS", async (s) => {
    await s.rejects(() => api.relay("collect", { pot: H!, member: "0x1234" }), { status: 400, code: "INVALID_PARAMS" });
  });
  await R.invariants("pot F/H");

  // ───── Pot G: partial settlement with debts (settled in the time phase) ─────
  R.group = "pot G: setup";
  await R.run("Pot G: creditor ivy paid personally, two members owe, an unclaimed pot LINK", "flow", "nets carol -25, erin -30, ivy +60; balance 5; LINK 5 in escrow", async (s) => {
    const c = await create("G", carol, { rules: rules({ instantMax: USD(100), oneApprovalMax: USD(200) }), endIn: 3 * HOUR, reviewWindow: 0 }, { deposit: USD(10) });
    s.ok(c.r, "PotCreated", "Contributed");
    const G = c.pot;
    s.ok(await api.relay("join", await build.join(ctx, G, erin, c.invite, { safetyNet: USD(10) })), "MemberJoined");
    s.ok(await api.relay("join", await build.join(ctx, G, ivy, c.invite)), "MemberJoined");
    s.ok(await api.relay("propose", await build.propose(ctx, G, ivy, { kind: PERSONAL, payee: ivy.address, amount: USD(90), category: 0, split: splitOf([carol, erin, ivy]) })), "SpendExecuted");
    const k5 = privateKeyToAccount(toHex(randomBytes(32)));
    const l = s.ok(await api.relay("propose", await build.propose(ctx, G, carol, { kind: LINK, payee: k5.address, amount: USD(5), category: 2, split: splitOf([carol]) })), "SpendExecuted", "ClaimCreated");
    s.eq([await net(env, G, carol.address), await net(env, G, erin.address), await net(env, G, ivy.address)], [-USD(25), -USD(30), USD(60)], "nets");
    s.eq(await ausdBal(env, G), USD(5), "balance");
    out.G = { pot: G, endTime: BigInt(await potRead(env, G, "endTime")), k5ClaimId: BigInt(findEvent(l, "SpendExecuted")!.args.claimId), invite: c.invite };
  });
  await R.invariants("pot G setup");
  return out;
}
