// Pure settle-up math: greedy min-cash-flow properties, pro-rata refunds, debtor allocation.
import { describe, expect, it } from "vitest";
import { allocateAcrossEdges, minCashFlow, proRataReduction } from "../src/lib/settlement.js";

function rng(seed: number) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x1_0000_0000;
  };
}
const addr = (i: number) => "0x" + i.toString(16).padStart(40, "0");

describe("minCashFlow", () => {
  it("matches largest debtor with largest creditor, ties by address", () => {
    const edges = minCashFlow([
      { address: addr(1), net: 60n },
      { address: addr(2), net: -30n },
      { address: addr(3), net: -30n },
      { address: addr(4), net: 0n },
    ]);
    expect(edges).toEqual([
      { kind: "MemberToMember", from: addr(2), to: addr(1), amount: 30n },
      { kind: "MemberToMember", from: addr(3), to: addr(1), amount: 30n },
    ]);
  });

  it("routes the pot's leftover balance to creditors as PotToMember edges", () => {
    // Σ net = 10 = pot balance
    const edges = minCashFlow([
      { address: addr(1), net: 70n },
      { address: addr(2), net: -30n },
      { address: addr(3), net: -30n },
    ]);
    expect(edges).toEqual([
      { kind: "MemberToMember", from: addr(2), to: addr(1), amount: 30n },
      { kind: "MemberToMember", from: addr(3), to: addr(1), amount: 30n },
      { kind: "PotToMember", from: undefined, to: addr(1), amount: 10n },
    ]);
  });

  it("is deterministic regardless of input order", () => {
    const pos = [
      { address: addr(5), net: -10n },
      { address: addr(1), net: 25n },
      { address: addr(3), net: -10n },
      { address: addr(2), net: -5n },
    ];
    const a = minCashFlow(pos);
    const b = minCashFlow([...pos].reverse());
    expect(a).toEqual(b);
  });

  it("conserves money and is minimal on 2,000 random pots", () => {
    const r = rng(42);
    for (let t = 0; t < 2_000; t++) {
      const n = 1 + Math.floor(r() * 50);
      const pos = Array.from({ length: n }, (_, i) => ({
        address: addr(i + 1),
        net: BigInt(Math.floor((r() - 0.5) * 2_000_000_000)),
      }));
      const edges = minCashFlow(pos);
      const debts = pos.filter((p) => p.net < 0n).reduce((a, p) => a - p.net, 0n);
      const credits = pos.filter((p) => p.net > 0n).reduce((a, p) => a + p.net, 0n);
      const fromDebtors = edges.filter((e) => e.from).reduce((a, e) => a + e.amount, 0n);
      const toCreditors = edges.filter((e) => e.to).reduce((a, e) => a + e.amount, 0n);
      expect(fromDebtors).toBe(debts);
      expect(toCreditors).toBe(credits);
      const nD = pos.filter((p) => p.net < 0n).length;
      const nC = pos.filter((p) => p.net > 0n).length;
      const memberEdges = edges.filter((e) => e.kind === "MemberToMember").length;
      if (nD && nC) expect(memberEdges).toBeLessThanOrEqual(nD + nC - 1);
      // every party appears on exactly one side; every edge positive
      for (const p of pos) {
        const out = edges.filter((e) => e.from === p.address).reduce((a, e) => a + e.amount, 0n);
        const inn = edges.filter((e) => e.to === p.address).reduce((a, e) => a + e.amount, 0n);
        if (p.net < 0n) expect([out, inn]).toEqual([-p.net, 0n]);
        else if (p.net > 0n) expect([out, inn]).toEqual([0n, p.net]);
        else expect([out, inn]).toEqual([0n, 0n]);
      }
      expect(edges.every((e) => e.amount > 0n)).toBe(true);
      // only one side can have a pot remainder
      const potIn = edges.some((e) => e.kind === "PotToMember");
      const potOut = edges.some((e) => e.kind === "MemberToPot");
      expect(potIn && potOut).toBe(false);
    }
  });
});

describe("proRataReduction", () => {
  it("full refund reverses shares exactly", () => {
    expect(proRataReduction([33_333_334n, 33_333_333n, 33_333_333n], 100_000_000n)).toEqual([
      33_333_334n,
      33_333_333n,
      33_333_333n,
    ]);
  });
  it("matches the contract's _parts(): weights [1, 3], refund 3 ⇒ [1, 2]", () => {
    expect(proRataReduction([1n, 3n], 3n)).toEqual([1n, 2n]);
  });
  it("partial refund floors positions ≥ 1 and gives the remainder to position 0", () => {
    const r = proRataReduction([33_333_334n, 33_333_333n, 33_333_333n], 50_000_000n);
    expect(r).toEqual([16_666_668n, 16_666_666n, 16_666_666n]);
    expect(r.reduce((a, b) => a + b, 0n)).toBe(50_000_000n);
  });
});

describe("allocateAcrossEdges", () => {
  it("fills the largest edge first and caps at the payment", () => {
    expect(
      allocateAcrossEdges(50n, [
        { to: addr(2), amount: 20n },
        { to: addr(1), amount: 40n },
      ]),
    ).toEqual([
      { to: addr(1), amount: 40n },
      { to: addr(2), amount: 10n },
    ]);
  });
});
