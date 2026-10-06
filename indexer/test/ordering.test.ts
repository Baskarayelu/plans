// Pot events emitted before PotCreated in the same block (initialize + creator join inside createPot).
import { describe, expect, it } from "vitest";
import { ALICE, FACTORY, Sim, USD, cc, checkPotInvariants, global, rules } from "./helpers.js";

const POT = "0x9000000000000000000000000000000000000021";

describe("creation ordering", () => {
  it("handles RulesSet / MemberJoined / Contributed logged before PotCreated", async () => {
    const sim = new Sim();
    sim.tx();
    sim.pot(POT, "RulesSet", { version: 1n, rules: rules() });
    sim.pot(POT, "MemberJoined", { member: ALICE, country: cc("GB"), safetyNet: 0n, memberIndex: 0n });
    sim.pot(POT, "Contributed", { member: ALICE, amount: USD(25) });
    sim.ev("PlansFactory", "PotCreated", FACTORY, {
      pot: POT, creator: ALICE, startTime: BigInt(sim.ts), endTime: BigInt(sim.ts + 86_400), reviewWindow: 0n, meta: "0x01", inviteKeyWrap: "0x02",
    });
    await sim.run();
    const pot = await sim.indexer.Pot.getOrThrow(POT);
    expect([pot.registered, pot.countedInStats, pot.balance, pot.memberCount, pot.creator_id]).toEqual([true, true, USD(25), 1, ALICE]);
    const g = await global(sim);
    expect([g.potsCreated, g.fundedPots, g.users, g.contributionVolume, g.ttffaSamples]).toEqual([1, 1, 1, USD(25), 1]);
    expect(g.membersPerPotHistogram[1]).toBe(1);
    await checkPotInvariants(sim, POT);
  });
});
