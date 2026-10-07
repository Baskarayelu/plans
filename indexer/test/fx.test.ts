// FxReference rounds, FX fields on sends and settlements, and payouts made through collect().
import { describe, expect, it } from "vitest";
import {
  ALICE, BOB, CARL, DIA, FX, SEND, Sim, USD, cc, checkPotInvariants, edges, equalShares, global, member,
} from "./helpers.js";

const POT = "0x9000000000000000000000000000000000000031";
const POT2 = "0x9000000000000000000000000000000000000032";
const OWNER = "0x0a0e000000000000000000000000000000000001";
const NEW_OWNER = "0x0a0e000000000000000000000000000000000002";
const SIM_FORWARDER = "0xb9f79d863261869b234c481d1f9a7af84aead192";
const PROD_FORWARDER = "0xf8344cfd5c43616a4366c34e3eee75af79a74482";
const TRANSMITTER = "0x7a0e000000000000000000000000000000000003";
const WORKFLOW_OWNER = "0x3f0e000000000000000000000000000000000004";
const WORKFLOW_ID = "0x" + "ab".repeat(32);

// GBP, EUR, INR, NGN (absent), JPY, CHF, AED, SGD — USD per unit, 8 decimals
const RATES = [127_000_000n, 108_000_000n, 1_200_000n, 0n, 670_000n, 113_000_000n, 27_225_701n, 74_000_000n];
const MASKS = [3n, 3n, 3n, 0n, 3n, 3n, 6n, 3n];

/** FxReference deployment: the constructor emits OwnershipTransferred, SimulationModeSet, MaxMoveSet. */
function deployFx(sim: Sim) {
  sim.tx();
  sim.ev("FxReference", "OwnershipTransferred", FX, { previousOwner: "0x0000000000000000000000000000000000000000", newOwner: OWNER });
  sim.ev("FxReference", "SimulationModeSet", FX, { forwarder: SIM_FORWARDER, simTransmitter: TRANSMITTER });
  sim.ev("FxReference", "MaxMoveSet", FX, { maxMoveBps: 1_000n });
}

function writeRound(sim: Sim, roundId: bigint, rates = RATES, masks = MASKS) {
  sim.tx(3_600);
  sim.ev("FxReference", "RoundWritten", FX, {
    roundId,
    scheduledTime: BigInt(sim.ts - 20),
    rateDate: 20251009n,
    sourceMask: masks.reduce((a, m) => a | m, 0n),
    usdPerUnitE8: rates,
    sourceMasks: masks,
  });
}

function sent(sim: Sim, from: string, to: string, amount: bigint, fx: { round: bigint; applied: bigint; ref: bigint; diff: bigint }) {
  return sim.tx().ev("PlansSend", "Sent", SEND, {
    from, to, amount, fromCountry: cc("GB"), toCountry: cc("IN"), fromCurrency: cc("GBP"), toCurrency: cc("INR"),
    fxRateE8: fx.applied, fxTimestamp: BigInt(sim.ts - 30), memoHash: "0x" + "cd".repeat(32),
    fxRoundId: fx.round, refRateE8: fx.ref, fxDiffBps: fx.diff,
  });
}

describe("FxReference", () => {
  it("RoundWritten creates an FxRound with every rate and mask; config follows the mode events", async () => {
    const sim = new Sim();
    deployFx(sim);
    writeRound(sim, 1n);
    await sim.run();

    const r = await sim.indexer.FxRound.getOrThrow("1");
    expect([r.roundId, r.fxReference, r.writtenAt, r.scheduledTime, r.rateDate, r.sourceMask]).toEqual([
      1n, FX, sim.ts, BigInt(sim.ts - 20), 20251009, 7,
    ]);
    expect([r.rateGBP, r.rateEUR, r.rateINR, r.rateNGN, r.rateJPY, r.rateCHF, r.rateAED, r.rateSGD]).toEqual(RATES);
    expect([r.maskGBP, r.maskEUR, r.maskINR, r.maskNGN, r.maskJPY, r.maskCHF, r.maskAED, r.maskSGD]).toEqual(MASKS.map(Number));
    expect(r.currencies).toEqual(["GBP", "EUR", "INR", "NGN", "JPY", "CHF", "AED", "SGD"]);
    expect(r.usdPerUnitE8).toEqual(RATES);
    expect(r.sourceMasks).toEqual(MASKS.map(Number));
    expect(r.presentCount).toBe(7);
    expect([r.blockNumber, r.txHash]).toEqual([sim.block, `0x${sim.block.toString(16).padStart(64, "0")}`]);

    let cfg = await sim.indexer.FxReferenceConfig.getOrThrow(FX);
    expect([cfg.mode, cfg.forwarder, cfg.simTransmitter, cfg.workflowId, cfg.maxMoveBps, cfg.owner]).toEqual([
      "Simulation", SIM_FORWARDER, TRANSMITTER, undefined, 1_000, OWNER,
    ]);
    expect([cfg.latestRound_id, cfg.latestRoundId, cfg.roundCount]).toEqual(["1", 1n, 1]);

    // production mode, a tighter max move, an ownership handover, a second round
    sim.tx().ev("FxReference", "ProductionModeSet", FX, { forwarder: PROD_FORWARDER, workflowId: WORKFLOW_ID, workflowOwner: WORKFLOW_OWNER });
    sim.ev("FxReference", "MaxMoveSet", FX, { maxMoveBps: 500n });
    sim.ev("FxReference", "OwnershipTransferStarted", FX, { previousOwner: OWNER, newOwner: NEW_OWNER });
    await sim.run();
    cfg = await sim.indexer.FxReferenceConfig.getOrThrow(FX);
    expect([cfg.mode, cfg.forwarder, cfg.simTransmitter, cfg.workflowId, cfg.workflowOwner, cfg.maxMoveBps, cfg.pendingOwner]).toEqual([
      "Production", PROD_FORWARDER, undefined, WORKFLOW_ID, WORKFLOW_OWNER, 500, NEW_OWNER,
    ]);

    sim.tx().ev("FxReference", "OwnershipTransferred", FX, { previousOwner: OWNER, newOwner: NEW_OWNER });
    writeRound(sim, 2n, RATES.map((x, i) => (i === 3 ? 0n : x + 1n)));
    await sim.run();
    cfg = await sim.indexer.FxReferenceConfig.getOrThrow(FX);
    expect([cfg.owner, cfg.pendingOwner, cfg.latestRound_id, cfg.latestRoundId, cfg.roundCount]).toEqual([NEW_OWNER, undefined, "2", 2n, 2]);
    expect((await sim.indexer.FxRound.getOrThrow("2")).rateGBP).toBe(127_000_001n);
    expect((await sim.indexer.FxRound.getOrThrow("1")).rateGBP).toBe(127_000_000n);
  });

  it("Sent stores fxRoundId / refRateE8 / signed fxDiffBps and links the round only when non-zero", async () => {
    const sim = new Sim();
    deployFx(sim);
    writeRound(sim, 1n);
    // GBP→INR reference = 1.27 / 0.012 = 105.83333333 INR per GBP
    sent(sim, ALICE, BOB, USD(100), { round: 1n, applied: 10_600_000_000n, ref: 10_583_333_333n, diff: 15n });
    sent(sim, ALICE, CARL, USD(20), { round: 1n, applied: 10_540_000_000n, ref: 10_583_333_333n, diff: -40n });
    sent(sim, BOB, DIA, USD(5), { round: 0n, applied: 10_500_000_000n, ref: 0n, diff: 0n });
    await sim.run();

    const sends = (await sim.indexer.Send.getAll()).sort((a, b) => a.timestamp - b.timestamp);
    expect(sends.length).toBe(3);
    const [a, b, c] = sends as [(typeof sends)[0], (typeof sends)[0], (typeof sends)[0]];
    expect([a.fxRoundId, a.fxRound_id, a.refRateE8, a.fxDiffBps, a.fxRateE8, a.amount]).toEqual([
      1n, "1", 10_583_333_333n, 15n, 10_600_000_000n, USD(100),
    ]);
    expect([b.fxRoundId, b.fxRound_id, b.fxDiffBps]).toEqual([1n, "1", -40n]);
    expect([c.fxRoundId, c.fxRound_id, c.refRateE8, c.fxDiffBps, c.fxRateE8]).toEqual([0n, undefined, 0n, 0n, 10_500_000_000n]);
    expect([a.fromCurrency, a.toCurrency, a.memoHash]).toEqual(["GBP", "INR", "0x" + "cd".repeat(32)]);
    // FX never changes the AUSD amount: traction still counts the sent amounts
    const g = await global(sim);
    expect([g.sends, g.sendVolume]).toEqual([3, USD(125)]);
  });

  it("Settled records fxRoundId: 0 (no fresh round) and non-zero (linked)", async () => {
    const sim = new Sim();
    deployFx(sim);
    writeRound(sim, 1n);
    for (const pot of [POT, POT2]) {
      sim.createPot(pot, ALICE, "GB").join(pot, BOB, "IN");
      sim.contribute(pot, ALICE, USD(10));
    }
    sim.tx(8 * 86_400);
    sim.pot(POT, "Payout", { member: ALICE, amount: USD(10) });
    sim.pot(POT, "Settled", { by: BOB, paidOut: USD(10), pulledIn: 0n, unpaidClaims: 0n, fxRoundId: 0n });
    sim.tx();
    sim.pot(POT2, "Payout", { member: ALICE, amount: USD(10) });
    sim.pot(POT2, "Settled", { by: ALICE, paidOut: USD(10), pulledIn: 0n, unpaidClaims: 0n, fxRoundId: 1n });
    await sim.run();

    const st = await sim.indexer.PotSettlement.getAll();
    const s1 = st.find((x) => x.pot_id === POT)!;
    const s2 = st.find((x) => x.pot_id === POT2)!;
    expect([s1.fxRoundId, s1.fxRound_id, s1.paidOut]).toEqual([0n, undefined, USD(10)]);
    expect([s2.fxRoundId, s2.fxRound_id, s2.paidOut]).toEqual([1n, "1", USD(10)]);
    for (const pot of [POT, POT2]) {
      const p = await sim.indexer.Pot.getOrThrow(pot);
      expect([p.status, p.balance, p.settlementCount, p.totalCollected]).toEqual(["Settled", 0n, 1, 0n]);
      await checkPotInvariants(sim, pot);
    }
    expect((await sim.indexer.Payout.getAll()).every((p) => p.source === "Automatic" && p.collectedBy_id === undefined)).toBe(true);
  });
});

describe("collect", () => {
  it("a payout skipped at settlement and collected later is marked Collect and counted once", async () => {
    const sim = new Sim();
    sim.createPot(POT, ALICE, "GB").join(POT, BOB, "IN");
    sim.contribute(POT, ALICE, USD(100)).contribute(POT, BOB, USD(50));
    sim.spend(POT, 1n, ALICE, 0, USD(90), 3, [ALICE, BOB], equalShares(USD(90), 2));
    await sim.run();
    expect([(await member(sim, POT, ALICE)).net, (await member(sim, POT, BOB)).net]).toEqual([USD(55), USD(5)]);

    // settle(): AUSD refuses Alice (no Payout), Bob is paid; Alice's 55 stays as an unpaid claim
    sim.tx(8 * 86_400);
    sim.pot(POT, "Payout", { member: BOB, amount: USD(5) });
    sim.pot(POT, "Settled", { by: BOB, paidOut: USD(5), pulledIn: 0n, unpaidClaims: USD(55), fxRoundId: 0n });
    await sim.run();
    let pot = await sim.indexer.Pot.getOrThrow(POT);
    expect([pot.status, pot.balance, pot.totalPaidOut]).toEqual(["Settled", USD(55), USD(5)]);
    expect((await edges(sim, POT)).map((e) => [e.kind, e.to_id, e.amount])).toEqual([["PotToMember", ALICE, USD(55)]]);
    await checkPotInvariants(sim, POT);

    // collect(ALICE) submitted by Carl: Payout(ALICE, 55) then Collected(ALICE, CARL, 55)
    sim.tx(86_400);
    sim.pot(POT, "Payout", { member: ALICE, amount: USD(55) });
    const payoutId = `${sim.block}-0`;
    sim.pot(POT, "Collected", { member: ALICE, by: CARL, amount: USD(55) });
    const collectedId = `${sim.block}-1`;
    await sim.run();

    const a = await member(sim, POT, ALICE);
    expect([a.withdrawn, a.net]).toEqual([USD(55), 0n]); // withdrawn once, from the Payout only
    pot = await sim.indexer.Pot.getOrThrow(POT);
    expect([pot.balance, pot.totalPaidOut, pot.totalCollected, pot.settledVolume]).toEqual([0n, USD(60), USD(55), USD(5)]);
    expect(await edges(sim, POT)).toEqual([]);

    const payouts = (await sim.indexer.Payout.getAll()).filter((p) => p.pot_id === POT);
    expect(payouts.length).toBe(2);
    const collected = await sim.indexer.Payout.getOrThrow(payoutId);
    expect([collected.account_id, collected.amount, collected.afterSettlement, collected.source, collected.collectedBy_id]).toEqual([
      ALICE, USD(55), true, "Collect", CARL,
    ]);
    const bobs = payouts.find((p) => p.account_id === BOB)!;
    expect([bobs.source, bobs.collectedBy_id, bobs.afterSettlement]).toEqual(["Automatic", undefined, false]);

    const act = await sim.indexer.Activity.getOrThrow(collectedId);
    expect([act.kind, act.account_id, act.counterparty, act.amount, act.ref, act.pot_id]).toEqual([
      "Collected", ALICE, CARL, USD(55), payoutId, POT,
    ]);
    expect((await sim.indexer.Activity.getOrThrow(payoutId)).kind).toBe("Payout");
    expect((await global(sim)).settledVolume).toBe(USD(5));
    await checkPotInvariants(sim, POT);
  });

  it("a Collected without its Payout changes nothing in the ledger", async () => {
    const sim = new Sim();
    sim.createPot(POT, ALICE, "GB");
    sim.contribute(POT, ALICE, USD(10));
    sim.tx().pot(POT, "Settled", { by: ALICE, paidOut: 0n, pulledIn: 0n, unpaidClaims: USD(10), fxRoundId: 0n });
    sim.tx().pot(POT, "Collected", { member: ALICE, by: ALICE, amount: USD(10) });
    await sim.run();
    const pot = await sim.indexer.Pot.getOrThrow(POT);
    expect([pot.balance, pot.totalPaidOut, pot.totalCollected]).toEqual([USD(10), 0n, 0n]);
    expect((await member(sim, POT, ALICE)).withdrawn).toBe(0n);
    expect(await sim.indexer.Payout.getAll()).toEqual([]);
    await checkPotInvariants(sim, POT);
  });
});
