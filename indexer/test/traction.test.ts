// Traction metrics: internal/demo exclusion (including retraction when a plan turns demo),
// users, accounts, medians and time to first funded action.
import { describe, expect, it } from "vitest";
import {
  ALICE, ASHA, BEN, BOB, CARL, DIA, EVE, ESCROW, KEYS, SEND, Sim, TEAM, USD, cc, checkPotInvariants, equalShares, global,
} from "./helpers.js";

const P1 = "0x9000000000000000000000000000000000000011";
const P2 = "0x9000000000000000000000000000000000000012";
const P3 = "0x9000000000000000000000000000000000000013";

const traction = (g: Awaited<ReturnType<typeof global>>) => ({
  users: g.users,
  potsCreated: g.potsCreated,
  fundedPots: g.fundedPots,
  contributionVolume: g.contributionVolume,
  spends: g.spends,
  approvals: g.approvals,
  settlements: g.settlements,
  settledVolume: g.settledVolume,
  crossBorderVolume: g.crossBorderVolume,
  members: g.membersPerPotHistogram.reduce((a, b) => a + b, 0),
  countries: g.countriesPerPotHistogram.reduce((a, b) => a + b, 0),
  ttffaSamples: g.ttffaSamples,
});

describe("demo / internal exclusion", () => {
  it("a plan created by an internal account is demo and never counted", async () => {
    const sim = new Sim();
    sim.createPot(P1, TEAM, "GB").join(P1, ALICE, "IN").contribute(P1, ALICE, USD(10));
    sim.spend(P1, 1n, ALICE, 0, USD(5), 3, [ALICE, TEAM], equalShares(USD(5), 2));
    await sim.run();
    const pot = await sim.indexer.Pot.getOrThrow(P1);
    expect([pot.isDemo, pot.countedInStats]).toEqual([true, false]);
    const g = await global(sim);
    expect(traction(g)).toEqual({
      users: 0, potsCreated: 0, fundedPots: 0, contributionVolume: 0n, spends: 0, approvals: 0, settlements: 0,
      settledVolume: 0n, crossBorderVolume: 0n, members: 0, countries: 0, ttffaSamples: 0,
    });
    expect([g.allPots, g.demoPots, g.internalAccounts]).toEqual([1, 1, 1]);
    // the pot itself is fully indexed for the app
    expect([pot.balance, pot.spendCount]).toEqual([USD(5), 1]);
  });

  it("a plan that a demo member joins later is retracted from every metric", async () => {
    const sim = new Sim();
    // real plan: Alice (GB) + Bob (IN), funded, a spend with approval, a settlement pull
    sim.createPot(P2, ALICE, "GB").join(P2, BOB, "IN");
    sim.contribute(P2, ALICE, USD(100), 120);
    sim.tx().proposeOnly(P2, 1n, ALICE, 0, USD(80), 3, [BOB], 2);
    sim.tx().pot(P2, "Voted", { id: 1n, member: BOB, approve: true });
    sim.pot(P2, "SpendExecuted", { id: 1n, amount: USD(80), members: [BOB], shares: [USD(80)], claimId: 0n });
    sim.tx().pot(P2, "Pulled", { member: BOB, amount: USD(80) });
    sim.pot(P2, "Payout", { member: ALICE, amount: USD(100) });
    sim.pot(P2, "Settled", { by: ALICE, paidOut: USD(100), pulledIn: USD(80), unpaidClaims: 0n });
    // an unrelated real plan that must stay counted
    sim.createPot(P3, CARL, "US").contribute(P3, CARL, USD(5));
    await sim.run();
    await checkPotInvariants(sim, P2);

    const before = traction(await global(sim));
    expect(before).toEqual({
      users: 3, potsCreated: 2, fundedPots: 2, contributionVolume: USD(105), spends: 1, approvals: 1, settlements: 1,
      settledVolume: USD(100), crossBorderVolume: USD(80), members: 2, countries: 2, ttffaSamples: 2,
    });
    expect((await sim.indexer.Corridor.getOrThrow("IN-GB")).volume).toBe(USD(80));
    const day = Math.floor(sim.ts / 86_400);
    expect((await sim.indexer.DailyStats.getOrThrow(String(day))).potsCreated).toBe(2);

    // Ben (demo member) joins P2 ⇒ P2 becomes demo and everything it contributed is removed
    sim.join(P2, BEN, "GB", 2n);
    await sim.run();
    const pot = await sim.indexer.Pot.getOrThrow(P2);
    expect([pot.isDemo, pot.hasDemoMember, pot.countedInStats]).toEqual([true, true, false]);
    const g = await global(sim);
    expect(traction(g)).toEqual({
      users: 1, potsCreated: 1, fundedPots: 1, contributionVolume: USD(5), spends: 0, approvals: 0, settlements: 0,
      settledVolume: 0n, crossBorderVolume: 0n, members: 1, countries: 1, ttffaSamples: 1,
    });
    expect([g.medianMembersPerPot, g.medianCountriesPerPot, g.demoPots]).toEqual([1, 1, 1]);
    const corridor = await sim.indexer.Corridor.getOrThrow("IN-GB");
    expect([corridor.volume, corridor.count, corridor.volumeAll]).toEqual([0n, 0, USD(80)]);
    const daily = await sim.indexer.DailyStats.getOrThrow(String(day));
    expect([daily.potsCreated, daily.fundedPots, daily.newUsers, daily.spends, daily.settlements, daily.crossBorderVolume]).toEqual([1, 1, 1, 0, 0, 0n]);
    expect((await sim.indexer.Account.getOrThrow(ALICE)).isUser).toBe(false);
    expect((await sim.indexer.Account.getOrThrow(ALICE)).ttffaCounted).toBe(false);
    // activity after the flip stays out of traction
    sim.contribute(P2, ALICE, USD(7));
    await sim.run();
    expect((await global(sim)).contributionVolume).toBe(USD(5));
  });

  it("team members in a real plan are not users; internal sends and keys are excluded", async () => {
    const sim = new Sim();
    sim.createPot(P1, ALICE, "GB").join(P1, TEAM, "GB");
    sim.tx().ev("KeyRegistry", "KeyRegistered", KEYS, { account: ALICE, pubKey: "0x" + "11".repeat(32) });
    sim.tx().ev("KeyRegistry", "KeyRegistered", KEYS, { account: TEAM, pubKey: "0x" + "22".repeat(32) });
    sim.tx().ev("KeyRegistry", "KeyRegistered", KEYS, { account: ALICE, pubKey: "0x" + "33".repeat(32) });
    const send = (from: string, to: string) =>
      sim.tx().ev("PlansSend", "Sent", SEND, {
        from, to, amount: USD(1), fromCountry: cc("US"), toCountry: cc("MX"), fromCurrency: cc("USD"), toCurrency: cc("MXN"),
        fxRateE8: 1_700_000_000n, fxTimestamp: 0n, memoHash: "0x" + "00".repeat(32),
      });
    send(EVE, ASHA); // to a demo account: internal
    send(EVE, DIA); // real
    await sim.run();
    const pot = await sim.indexer.Pot.getOrThrow(P1);
    expect([pot.isDemo, pot.countedInStats, pot.activeMemberCount]).toEqual([false, true, 2]);
    const g = await global(sim);
    expect([g.users, g.accounts, g.sends, g.sendVolume, g.crossBorderVolume]).toEqual([2, 1, 1, USD(1), USD(1)]);
    expect((await sim.indexer.Account.getOrThrow(TEAM)).isUser).toBe(false);
    expect((await sim.indexer.Account.getOrThrow(EVE)).isUser).toBe(true);
    expect((await sim.indexer.Account.getOrThrow(DIA)).isUser).toBe(false); // received, did not send/claim
    expect((await sim.indexer.Send.getAll()).filter((s) => s.isInternal).length).toBe(1);
  });
});

describe("medians and time to first funded action", () => {
  it("computes members/countries medians and the TTFFA histogram", async () => {
    const sim = new Sim();
    // P1: 3 members, 3 countries. Alice funds 120 s after joining, Bob 30 s after.
    sim.createPot(P1, ALICE, "GB").join(P1, BOB, "IN").join(P1, CARL, "US");
    sim.contribute(P1, ALICE, USD(10), 60); // Alice joined 120 s earlier (2 joins × 60 s)
    sim.contribute(P1, BOB, USD(10), 0);
    // P2: 1 member. P3: 2 members, 1 country.
    sim.createPot(P2, DIA, "FR");
    sim.createPot(P3, EVE, "DE").join(P3, CARL, "DE");
    // Dia's first funded action is a send-by-link claim 4,060 s after joining (P3 create + join add 120 s)
    sim.tx(4_000 - 60).ev("ClaimEscrow", "ClaimCreated", ESCROW, {
      id: 9n, source: ALICE, claimSigner: "0xc1a1000000000000000000000000000000000009", amount: USD(3), expiry: 0n, sourceSpendId: 0n, fromCountry: cc("GB"),
    });
    sim.ev("ClaimEscrow", "Claimed", ESCROW, { id: 9n, recipient: DIA, toCountry: cc("FR") });
    await sim.run();

    const g = await global(sim);
    // members per pot: [1, 2, 3] ⇒ 2; countries per pot (Carl's US counts in P1, DE once in P3): [1, 1, 3] ⇒ 1
    expect([g.medianMembersPerPot, g.medianCountriesPerPot]).toEqual([2, 1]);
    const alice = await sim.indexer.Account.getOrThrow(ALICE);
    const bob = await sim.indexer.Account.getOrThrow(BOB);
    const dia = await sim.indexer.Account.getOrThrow(DIA);
    expect([alice.timeToFirstFundedAction, bob.timeToFirstFundedAction, dia.timeToFirstFundedAction]).toEqual([180, 120, 4_060]);
    expect(g.ttffaSamples).toBe(3);
    // samples 120, 180, 4060 ⇒ median 180 ⇒ bucket [120, 300)
    expect([g.medianTtffaLowerSeconds, g.medianTtffaUpperSeconds]).toEqual([120, 300]);
    // Carl exits P1 ⇒ P1 has 2 active members ⇒ members per pot [1, 2, 2] ⇒ 2
    sim.tx().pot(P1, "MemberExited", { member: CARL, netAtExit: 0n, paidOut: 0n, pulledIn: 0n });
    await sim.run();
    const g2 = await global(sim);
    expect(g2.membersPerPotHistogram.slice(0, 4)).toEqual([0, 1, 2, 0]);
    expect(g2.medianMembersPerPot).toBe(2);
    expect(g2.users).toBe(5); // Alice, Bob, Carl, Dia, Eve
  });
});
