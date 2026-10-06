import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { Backoff, demoMembersToAck, pickDemoVoter, planSettleUp, randomDelay, SETTLE_UP_STEPS } from "../../src/demo/policy.js";
import type { MemberRow, PotRow, ProposalRow } from "../../src/store.js";

const BEN = "0xBe00000000000000000000000000000000000001" as Address;
const ASHA = "0xa500000000000000000000000000000000000002" as Address;
const MAYA = "0x3a00000000000000000000000000000000000003" as Address;
const JUDGE = "0x1d00000000000000000000000000000000000004" as Address;
const POT = "0x9000000000000000000000000000000000000009" as Address;
const demo = new Set([BEN, ASHA, MAYA].map((a) => a.toLowerCase()));
const now = 1_760_000_000;

const proposal = (over: Partial<ProposalRow> = {}): ProposalRow => ({
  pot: POT, id: 1n, proposer: JUDGE, kind: 0, payee: ASHA, amount: 400_000n, category: 3, splitMembers: [JUDGE, BEN],
  approvalsRequired: 2, expiresAt: now + 3600, status: "pending", createdAt: now, ...over,
});

const vote = (over: Partial<Parameters<typeof pickDemoVoter>[0]> = {}) =>
  pickDemoVoter({ proposal: proposal(), voters: [], activeMembers: [JUDGE, BEN, ASHA, MAYA], demo, approveCap: 1_000_000n, nowSec: now, alreadyScheduled: false, ...over });

describe("demo approvals", () => {
  it("picks the first eligible demo member for a pending proposal under the cap", () => {
    expect(vote()).toBe(BEN);
  });
  it("skips the proposer and members who already voted", () => {
    expect(vote({ proposal: proposal({ proposer: BEN }) })).toBe(ASHA);
    expect(vote({ voters: [BEN] })).toBe(ASHA);
    expect(vote({ voters: [BEN, ASHA, MAYA] })).toBeNull();
  });
  it("does nothing above the cap, for instant spends, non-pending or expiring proposals, or when already scheduled", () => {
    expect(vote({ proposal: proposal({ amount: 1_000_001n }) })).toBeNull();
    expect(vote({ proposal: proposal({ amount: 1_000_000n }) })).toBe(BEN);
    expect(vote({ proposal: proposal({ approvalsRequired: 1 }) })).toBeNull();
    expect(vote({ proposal: proposal({ status: "approved" }) })).toBeNull();
    expect(vote({ proposal: proposal({ status: "executed" }) })).toBeNull();
    expect(vote({ proposal: proposal({ expiresAt: now + 3 }) })).toBeNull();
    expect(vote({ alreadyScheduled: true })).toBeNull();
  });
  it("only demo members who are active vote", () => {
    expect(vote({ activeMembers: [JUDGE, MAYA] })).toBe(MAYA);
    expect(vote({ activeMembers: [JUDGE] })).toBeNull();
  });
  it("delays are uniformly within 3–8 s", () => {
    expect(randomDelay(3000, 8000, () => 0)).toBe(3000);
    expect(randomDelay(3000, 8000, () => 0.999999)).toBe(8000);
    for (let i = 0; i < 200; i++) {
      const d = randomDelay(3000, 8000);
      expect(d).toBeGreaterThanOrEqual(3000);
      expect(d).toBeLessThanOrEqual(8000);
    }
  });
});

describe("demo acks", () => {
  const pot = (over: Partial<PotRow> = {}): PotRow => ({
    address: POT, creator: MAYA, startTime: now - 100, endTime: now + 600, reviewWindow: 0, settled: false, ackEpoch: 2, frozenUntil: 0, createdBlock: 1, ...over,
  });
  const m = (member: Address, ackEpoch: number | null): MemberRow => ({ pot: POT, member, country: "", idx: 0, active: true, ackEpoch });

  it("waits while the plan is running and no human has acked", () => {
    expect(demoMembersToAck({ pot: pot(), members: [m(JUDGE, null), m(BEN, null)], demo, nowSec: now })).toEqual([]);
    expect(demoMembersToAck({ pot: pot(), members: [m(JUDGE, 1), m(BEN, null)], demo, nowSec: now })).toEqual([]); // stale epoch
  });
  it("acks once a human member has acked in the current epoch", () => {
    expect(demoMembersToAck({ pot: pot(), members: [m(JUDGE, 2), m(BEN, null), m(ASHA, 2)], demo, nowSec: now })).toEqual([BEN]);
  });
  it("acks once the end time has passed", () => {
    expect(demoMembersToAck({ pot: pot({ endTime: now - 1 }), members: [m(JUDGE, null), m(BEN, 1), m(MAYA, null)], demo, nowSec: now })).toEqual([BEN, MAYA]);
  });
  it("never acks a settled plan", () => {
    expect(demoMembersToAck({ pot: pot({ settled: true, endTime: now - 1 }), members: [m(BEN, null)], demo, nowSec: now })).toEqual([]);
  });
});

describe("try a settle-up plan", () => {
  it("keeps total demo outlay within the cap and spends instant and affordable", () => {
    const p = planSettleUp({ deposit: 100_000n, maxOutlay: 300_000n, instantMax: 250_000n });
    expect(p.outlay).toBeLessThanOrEqual(300_000n);
    const paid = p.spends.filter((s) => s.kind === 0).reduce((a, s) => a + s.amount, 0n);
    expect(paid).toBeLessThanOrEqual(p.deposit * 3n); // pot can afford the PAY spends
    for (const s of p.spends) expect(s.amount).toBeLessThanOrEqual(250_000n);
    expect(p.spends.map((s) => s.category)).toEqual([3, 2, 3]); // Food & drink, Getting around
  });
  it("shrinks deposits to fit a smaller cap", () => {
    const p = planSettleUp({ deposit: 1_000_000n, maxOutlay: 300_000n, instantMax: 250_000n });
    expect(p.deposit).toBe(100_000n);
    expect(() => planSettleUp({ deposit: 1n, maxOutlay: 2n, instantMax: 1n })).toThrow();
  });
  it("ends with every demo member acking", () => {
    expect(SETTLE_UP_STEPS.slice(-3)).toEqual(["maya.ack", "ben.ack", "asha.ack"]);
  });
});

describe("backoff", () => {
  it("doubles up to a maximum and resets on success", () => {
    let t = 0;
    const b = new Backoff(1000, 4000, () => t);
    b.fail("k");
    expect(b.blocked("k")).toBe(true);
    t = 1001;
    expect(b.blocked("k")).toBe(false);
    b.fail("k");
    t += 1999;
    expect(b.blocked("k")).toBe(true);
    b.fail("k");
    b.fail("k");
    expect(b.failures("k")).toBe(4);
    b.ok("k");
    expect(b.blocked("k")).toBe(false);
  });
});
