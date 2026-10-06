// Ledger correctness against docs/protocol.md, through the real handlers.
import { describe, expect, it } from "vitest";
import {
  ALICE,
  BOB,
  CARL,
  DIA,
  ESCROW,
  Sim,
  USD,
  checkPotInvariants,
  edges,
  equalShares,
  member,
} from "./helpers.js";

const POT = "0x9000000000000000000000000000000000000001";

/** Alice (GB) creates, Bob (IN) and Carl (US) join; Alice adds 100, Bob 50. */
async function trip(budgets?: bigint[]) {
  const sim = new Sim();
  sim.createPot(POT, ALICE, "GB", budgets).join(POT, BOB, "IN").join(POT, CARL, "US");
  sim.contribute(POT, ALICE, USD(100)).contribute(POT, BOB, USD(50));
  await sim.run();
  return sim;
}

describe("ledger", () => {
  it("contributions, PAY with approval, PERSONAL spend, category budgets", async () => {
    const budgets = Array.from({ length: 8 }, () => 0n);
    budgets[3] = USD(200); // Food & drink
    const sim = await trip(budgets);

    // PAY 100 for Food & drink, split 3 ways, needs 2 approvals: Bob approves, then executes.
    const shares = equalShares(USD(100), 3); // [33.333334, 33.333333, 33.333333]
    sim.tx().proposeOnly(POT, 1n, ALICE, 0, USD(100), 3, [ALICE, BOB, CARL], 2);
    sim.tx().pot(POT, "Voted", { id: 1n, member: BOB, approve: true });
    sim.pot(POT, "SpendExecuted", { id: 1n, amount: USD(100), members: [ALICE, BOB, CARL], shares, claimId: 0n });
    // PERSONAL 60 paid by Carl for Stay, split Alice/Carl
    sim.spend(POT, 2n, CARL, 2, USD(60), 0, [ALICE, CARL], equalShares(USD(60), 2));
    await sim.run();

    const a = await member(sim, POT, ALICE);
    const b = await member(sim, POT, BOB);
    const c = await member(sim, POT, CARL);
    expect([a.contributed, a.share, a.net]).toEqual([USD(100), 63_333_334n, 36_666_666n]);
    expect([b.contributed, b.share, b.net]).toEqual([USD(50), 33_333_333n, 16_666_667n]);
    expect([c.personalPaid, c.share, c.net]).toEqual([USD(60), 63_333_333n, -3_333_333n]);

    const pot = await sim.indexer.Pot.getOrThrow(POT);
    expect(pot.balance).toBe(USD(50)); // 150 in − 100 PAY out; PERSONAL moves no money
    expect(pot.totalSpent).toBe(USD(160));
    expect(pot.totalPotSpent).toBe(USD(100));
    expect(pot.totalPersonalSpent).toBe(USD(60));
    expect([pot.memberCount, pot.activeMemberCount, pot.countryCount]).toEqual([3, 3, 3]);
    expect(pot.countries).toEqual(["GB", "IN", "US"]);

    const spend = await sim.indexer.Spend.getOrThrow(`${POT}-1`);
    expect(spend.status).toBe("Executed");
    expect(spend.approvals).toBe(2);
    expect(spend.categoryName).toBe("Food & drink");

    const food = await sim.indexer.CategorySpend.getOrThrow(`${POT}-c3`);
    expect([food.budget, food.spent, food.remaining, food.spendCount]).toEqual([USD(200), USD(100), USD(100), 1]);
    const stay = await sim.indexer.CategorySpend.getOrThrow(`${POT}-c0`);
    expect([stay.budget, stay.spent, stay.remaining]).toEqual([0n, USD(60), undefined]);

    // Carl owes Alice 3.333333; the pot's 50 goes to Alice (33.333333) and Bob (16.666667).
    const es = await edges(sim, POT);
    expect(es.map((e) => [e.kind, e.from_id, e.to_id, e.amount]).sort()).toEqual(
      [
        ["MemberToMember", CARL, ALICE, 3_333_333n],
        ["PotToMember", undefined, ALICE, 33_333_333n],
        ["PotToMember", undefined, BOB, 16_666_667n],
      ].sort(),
    );
    await checkPotInvariants(sim, POT);
  });

  it("deletes stale settlement edges when nets change", async () => {
    const sim = await trip();
    sim.spend(POT, 1n, CARL, 2, USD(90), 3, [ALICE, BOB, CARL], equalShares(USD(90), 3));
    await sim.run();
    // Carl paid 90 personally: credits Alice 70, Bob 20, Carl 60, pot 150 ⇒ only pot edges
    expect((await edges(sim, POT)).every((e) => e.kind === "PotToMember")).toBe(true);

    // Dia joins and gets a 40 share of a PERSONAL spend paid by Bob ⇒ Dia → Bob edge
    sim.join(POT, DIA, "GB", 3n);
    sim.spend(POT, 2n, BOB, 2, USD(40), 1, [DIA], [USD(40)]);
    await sim.run();
    let es = await edges(sim, POT);
    expect(es.find((e) => e.from_id === DIA)?.amount).toBe(USD(40));
    await checkPotInvariants(sim, POT);

    // Dia contributes 40 ⇒ the Dia edge disappears
    sim.contribute(POT, DIA, USD(40));
    await sim.run();
    es = await edges(sim, POT);
    expect(es.some((e) => e.from_id === DIA)).toBe(false);
    expect(await sim.indexer.SettlementEdge.get(`${POT}-${DIA}-${BOB}`)).toBeUndefined();
    await checkPotInvariants(sim, POT);
  });

  it("dispute resolution replaces the spend's shares (SpenderCovers, then Resplit)", async () => {
    const sim = await trip();
    sim.spend(POT, 1n, ALICE, 0, USD(90), 3, [ALICE, BOB, CARL], equalShares(USD(90), 3));
    sim.tx().pot(POT, "DisputeOpened", { disputeId: 1n, spendId: 1n, by: CARL, reason: 2n, memo: "0x" });
    sim.tx().pot(POT, "DisputeVoted", { disputeId: 1n, member: BOB, spenderCovers: true });
    sim.tx().pot(POT, "DisputeResolved", { disputeId: 1n, outcome: 3n, members: [ALICE], shares: [USD(90)] });
    await sim.run();

    const d = await sim.indexer.Dispute.getOrThrow(`${POT}-d1`);
    expect([d.status, d.outcome, d.votesSpenderCovers]).toEqual(["Resolved", "SpenderCovers", 1]);
    expect(d.previousShares).toEqual([USD(30), USD(30), USD(30)]);
    expect((await member(sim, POT, ALICE)).share).toBe(USD(90));
    expect((await member(sim, POT, BOB)).share).toBe(0n);
    expect((await member(sim, POT, CARL)).share).toBe(0n);
    expect(await sim.indexer.SpendShare.get(`${POT}-1-${CARL}`)).toBeUndefined();
    const spend = await sim.indexer.Spend.getOrThrow(`${POT}-1`);
    expect([spend.shareVersion, spend.shareMembers, spend.hasOpenDispute]).toEqual([2, [ALICE], false]);
    await checkPotInvariants(sim, POT);

    // A second dispute resplits 90 as Bob 60 / Carl 30.
    sim.tx().pot(POT, "DisputeOpened", { disputeId: 2n, spendId: 1n, by: ALICE, reason: 1n, memo: "0x" });
    sim.tx().pot(POT, "DisputeResolved", { disputeId: 2n, outcome: 2n, members: [BOB, CARL], shares: [USD(60), USD(30)] });
    await sim.run();
    expect((await member(sim, POT, ALICE)).share).toBe(0n);
    expect((await member(sim, POT, BOB)).share).toBe(USD(60));
    expect((await member(sim, POT, CARL)).share).toBe(USD(30));
    expect(await sim.indexer.SpendShare.get(`${POT}-1-${ALICE}`)).toBeUndefined();
    await checkPotInvariants(sim, POT);

    // Keep: the contract re-emits the current assignment and moves nothing.
    sim.tx().pot(POT, "DisputeOpened", { disputeId: 3n, spendId: 1n, by: BOB, reason: 0n, memo: "0x" });
    sim.tx().pot(POT, "DisputeResolved", { disputeId: 3n, outcome: 1n, members: [BOB, CARL], shares: [USD(60), USD(30)] });
    await sim.run();
    expect((await member(sim, POT, BOB)).share).toBe(USD(60));
    expect((await sim.indexer.Spend.getOrThrow(`${POT}-1`)).shareVersion).toBe(3);
    expect((await sim.indexer.Dispute.getOrThrow(`${POT}-d3`)).outcome).toBe("Keep");
    await checkPotInvariants(sim, POT);
  });

  it("escrow refund reverses a LINK spend's shares and restores the balance", async () => {
    const sim = await trip();
    const before = await Promise.all([ALICE, BOB, CARL].map((m) => member(sim, POT, m)));
    const shares = equalShares(USD(100), 3);
    sim.spend(POT, 1n, BOB, 1, USD(100), 2, [ALICE, BOB, CARL], shares, { claimId: 7n, payee: "0xc1a1000000000000000000000000000000000007" });
    sim.ev("ClaimEscrow", "ClaimCreated", ESCROW, {
      id: 7n, source: POT, claimSigner: "0xc1a1000000000000000000000000000000000007", amount: USD(100), expiry: 0n, sourceSpendId: 1n, fromCountry: "0x0000",
    });
    await sim.run();
    expect((await sim.indexer.Pot.getOrThrow(POT)).balance).toBe(USD(50));
    expect((await member(sim, POT, ALICE)).share).toBe(33_333_334n);
    await checkPotInvariants(sim, POT);

    sim.tx(8 * 86_400).ev("ClaimEscrow", "ClaimRefunded", ESCROW, { id: 7n, to: POT, amount: USD(100) });
    sim.pot(POT, "EscrowRefunded", { spendId: 1n, amount: USD(100) });
    await sim.run();
    const after = await Promise.all([ALICE, BOB, CARL].map((m) => member(sim, POT, m)));
    expect(after.map((m) => m.net)).toEqual(before.map((m) => m.net));
    expect(after.map((m) => m.share)).toEqual([0n, 0n, 0n]);
    const pot = await sim.indexer.Pot.getOrThrow(POT);
    expect([pot.balance, pot.totalRefunded]).toEqual([USD(150), USD(100)]);
    const spend = await sim.indexer.Spend.getOrThrow(`${POT}-1`);
    expect([spend.refunded, spend.claimId]).toEqual([USD(100), 7n]);
    const share = await sim.indexer.SpendShare.getOrThrow(`${POT}-1-${ALICE}`);
    expect([share.originalAmount, share.refunded, share.amount]).toEqual([33_333_334n, 33_333_334n, 0n]);
    const cat = await sim.indexer.CategorySpend.getOrThrow(`${POT}-c2`);
    expect([cat.spent, cat.refunded, cat.netSpent]).toEqual([USD(100), USD(100), 0n]);
    expect((await sim.indexer.Claim.getOrThrow(`${ESCROW}-7`)).status).toBe("Refunded");
    await checkPotInvariants(sim, POT);
  });

  it("partial escrow refund mirrors the contract's _parts(refund, weights) rounding", async () => {
    const sim = await trip();
    // LINK 5 base units, weights Alice 1 : Bob 3 ⇒ parts [5 − 3, 5·3/4 = 3] = [2, 3]
    sim.tx();
    sim.pot(POT, "SpendProposed", {
      id: 1n, proposer: ALICE, kind: 1n, payee: "0xc1a1000000000000000000000000000000000008", amount: 5n, category: 7n,
      splitMembers: [ALICE, BOB], splitWeights: [1n, 3n], receiptHash: "0x" + "00".repeat(32), memo: "0x",
      approvalsRequired: 1n, expiresAt: 0n,
    });
    sim.pot(POT, "SpendExecuted", { id: 1n, amount: 5n, members: [ALICE, BOB], shares: [2n, 3n], claimId: 8n });
    // refund 3: weights give [3 − 3·3/4 = 1, 2]; pro rata on shares would give [2, 1]
    sim.tx().pot(POT, "EscrowRefunded", { spendId: 1n, amount: 3n });
    await sim.run();
    const a = await sim.indexer.SpendShare.getOrThrow(`${POT}-1-${ALICE}`);
    const b = await sim.indexer.SpendShare.getOrThrow(`${POT}-1-${BOB}`);
    expect([a.refunded, a.amount, b.refunded, b.amount]).toEqual([1n, 1n, 2n, 1n]);
    await checkPotInvariants(sim, POT);
  });

  it("settlement: pulls, payouts, debts, exit and Settled", async () => {
    const sim = await trip();
    // Carl paid 90 personally for all three: Alice +70, Bob +20, Carl +60; pot 150
    sim.spend(POT, 1n, CARL, 2, USD(90), 0, [ALICE, BOB, CARL], equalShares(USD(90), 3));
    // PAY 150 split Carl 150 ⇒ Carl −90, pot 0
    sim.spend(POT, 2n, ALICE, 0, USD(150), 1, [CARL], [USD(150)]);
    await sim.run();
    expect((await member(sim, POT, CARL)).net).toBe(USD(-90));
    await checkPotInvariants(sim, POT);

    // settle(): pull 50 from Carl (allowance), pay Alice and Bob pro rata (B < C), record Carl's 40 debt.
    sim.tx(10 * 86_400);
    sim.pot(POT, "Pulled", { member: CARL, amount: USD(50) });
    sim.pot(POT, "Payout", { member: ALICE, amount: 38_888_888n });
    sim.pot(POT, "Payout", { member: BOB, amount: 11_111_111n });
    sim.pot(POT, "DebtRecorded", { member: CARL, amount: USD(40) });
    sim.pot(POT, "Settled", { by: DIA, paidOut: 49_999_999n, pulledIn: USD(50), unpaidClaims: 40_000_001n });
    await sim.run();
    const pot = await sim.indexer.Pot.getOrThrow(POT);
    expect([pot.status, pot.balance, pot.settlementCount, pot.settledVolume]).toEqual(["Settled", 1n, 1, 49_999_999n]);
    const c = await member(sim, POT, CARL);
    expect([c.contributed, c.pulled, c.debt, c.net]).toEqual([USD(50), USD(50), USD(40), USD(-40)]);
    await checkPotInvariants(sim, POT);

    // payDebt: Carl pays 40, distributed to Alice and Bob
    sim.tx();
    sim.pot(POT, "DebtPaid", { member: CARL, amount: USD(40) });
    sim.pot(POT, "Payout", { member: ALICE, amount: 31_111_112n });
    sim.pot(POT, "Payout", { member: BOB, amount: 8_888_889n });
    await sim.run();
    const c2 = await member(sim, POT, CARL);
    expect([c2.debt, c2.debtPaid, c2.net]).toEqual([0n, USD(40), 0n]);
    expect((await sim.indexer.Payout.getAll()).filter((p) => p.afterSettlement).length).toBe(2);
    await checkPotInvariants(sim, POT);
  });

  it("exit makes a member inactive and keeps assigned shares", async () => {
    const sim = await trip();
    sim.spend(POT, 1n, ALICE, 0, USD(30), 3, [ALICE, BOB, CARL], equalShares(USD(30), 3));
    sim.tx().pot(POT, "Payout", { member: BOB, amount: USD(40) });
    sim.pot(POT, "MemberExited", { member: BOB, netAtExit: USD(40), paidOut: USD(40), pulledIn: 0n });
    await sim.run();
    const b = await member(sim, POT, BOB);
    expect([b.status, b.share, b.withdrawn, b.net]).toEqual(["Exited", USD(10), USD(40), 0n]);
    const pot = await sim.indexer.Pot.getOrThrow(POT);
    expect([pot.memberCount, pot.activeMemberCount]).toEqual([3, 2]);
    await checkPotInvariants(sim, POT);
  });
});
