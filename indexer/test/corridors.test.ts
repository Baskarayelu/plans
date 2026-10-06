// Corridor attribution: sends, send-by-link claims, pot LINK claims, settlement pulls, debt payments.
import { describe, expect, it } from "vitest";
import { ALICE, BOB, CARL, DIA, ESCROW, EVE, SEND, Sim, TEAM, USD, ZERO2, cc, checkPotInvariants, global } from "./helpers.js";

const POT = "0x9000000000000000000000000000000000000002";

function sent(sim: Sim, from: string, to: string, amount: bigint, fc: string, tc: string) {
  return sim.tx().ev("PlansSend", "Sent", SEND, {
    from, to, amount, fromCountry: cc(fc), toCountry: cc(tc),
    fromCurrency: cc("GBP"), toCurrency: cc("INR"), fxRateE8: 11_000_000_000n, fxTimestamp: BigInt(sim.ts), memoHash: "0x" + "00".repeat(32),
  });
}

describe("corridors", () => {
  it("attributes every flow type to the right country pair", async () => {
    const sim = new Sim();
    // 1. direct send GB → IN
    sent(sim, ALICE, BOB, USD(100), "GB", "IN");
    // 2. internal send (team account) GB → US: only in *All
    sent(sim, TEAM, CARL, USD(50), "GB", "US");
    // 3. domestic send GB → GB: corridor exists, not cross-border
    sent(sim, ALICE, DIA, USD(10), "GB", "GB");
    // 4. send-by-link US → MX (country of the sender from ClaimCreated, of the receiver from Claimed)
    sim.tx().ev("ClaimEscrow", "ClaimCreated", ESCROW, {
      id: 1n, source: CARL, claimSigner: "0xc1a1000000000000000000000000000000000001", amount: USD(20), expiry: BigInt(sim.ts + 86_400), sourceSpendId: 0n, fromCountry: cc("US"),
    });
    sim.tx().ev("ClaimEscrow", "Claimed", ESCROW, { id: 1n, recipient: DIA, toCountry: cc("MX") });

    // 5. pot: Alice GB, Bob IN, Carl US. LINK claim by Bob's spend → Eve in FR.
    sim.createPot(POT, ALICE, "GB").join(POT, BOB, "IN").join(POT, CARL, "US");
    sim.contribute(POT, ALICE, USD(100));
    sim.spend(POT, 1n, BOB, 1, USD(30), 7, [BOB], [USD(30)], { claimId: 2n });
    sim.ev("ClaimEscrow", "ClaimCreated", ESCROW, {
      id: 2n, source: POT, claimSigner: "0xc1a1000000000000000000000000000000000002", amount: USD(30), expiry: BigInt(sim.ts + 86_400), sourceSpendId: 1n, fromCountry: ZERO2,
    });
    sim.tx().ev("ClaimEscrow", "Claimed", ESCROW, { id: 2n, recipient: EVE, toCountry: cc("FR") });
    // Carl gets a 60 PAY spend assigned: nets A +100, B −30, C −60, pot 10
    sim.spend(POT, 2n, ALICE, 0, USD(60), 1, [CARL], [USD(60)]);
    await sim.run();
    await checkPotInvariants(sim, POT);

    // 6. settlement pull from Carl (US) → owed to Alice (GB); Bob's 30 becomes debt
    sim.tx(8 * 86_400);
    sim.pot(POT, "Pulled", { member: CARL, amount: USD(60) });
    sim.pot(POT, "Payout", { member: ALICE, amount: USD(70) });
    sim.pot(POT, "DebtRecorded", { member: BOB, amount: USD(30) });
    sim.pot(POT, "Settled", { by: ALICE, paidOut: USD(70), pulledIn: USD(60), unpaidClaims: USD(30) });
    // 7. Bob pays his debt (IN → GB)
    sim.tx();
    sim.pot(POT, "DebtPaid", { member: BOB, amount: USD(30) });
    sim.pot(POT, "Payout", { member: ALICE, amount: USD(30) });
    await sim.run();
    await checkPotInvariants(sim, POT);

    const c = async (id: string) => sim.indexer.Corridor.getOrThrow(id);
    expect((await c("GB-IN")).volume).toBe(USD(100));
    expect((await c("GB-IN")).sendVolume).toBe(USD(100));
    const gbus = await c("GB-US");
    expect([gbus.volume, gbus.count, gbus.volumeAll, gbus.countAll]).toEqual([0n, 0, USD(50), 1]);
    const gbgb = await c("GB-GB");
    expect([gbgb.isCrossBorder, gbgb.volume]).toEqual([false, USD(10)]);
    expect((await c("US-MX")).claimVolume).toBe(USD(20));
    expect((await c("IN-FR")).potVolume).toBe(USD(30)); // pot LINK claim: proposer's country → claimer's
    expect((await c("US-GB")).potVolume).toBe(USD(60)); // settlement pull
    expect((await c("IN-GB")).potVolume).toBe(USD(30)); // debt payment

    const flows = await sim.indexer.CorridorFlow.getAll();
    expect(flows.map((f) => f.source).sort()).toEqual(
      ["DebtPayment", "PotLinkClaim", "Send", "Send", "Send", "SendLinkClaim", "SettlementPull"].sort(),
    );

    const g = await global(sim);
    expect(g.crossBorderVolume).toBe(USD(100 + 20 + 30 + 60 + 30));
    expect([g.sends, g.sendVolume, g.claims, g.claimVolume]).toEqual([2, USD(110), 1, USD(20)]);
    expect([g.settlements, g.settledVolume]).toEqual([1, USD(70)]);
    const pot = await sim.indexer.Pot.getOrThrow(POT);
    expect([pot.crossBorderVolume, pot.crossBorderCount]).toEqual([USD(120), 3]);
  });
});
