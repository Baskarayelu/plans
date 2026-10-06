import { minCashFlow, previewExit, previewSettle, splitParts } from "../lib/domain/settlement";
import { approvalsRequired, PRESETS, rulesInWords, presetBlurb } from "../lib/domain/rules";
import { claimUrl, codeUrl, inviteUrl, parseLink, displayLink } from "../lib/domain/links";

const $ = (d: number) => BigInt(Math.round(d * 1e6));

describe("settle-up graph", () => {
  it("matches the design example (Ben→Maya £12, Asha→Maya, rest from the pot)", () => {
    const edges = minCashFlow([
      { address: "maya", net: $(52.35) },
      { address: "sam", net: $(28.1) },
      { address: "asha", net: $(-8.08) },
      { address: "ben", net: $(-16.17) },
    ]);
    const debtsOut = edges.filter((e) => e.from).reduce((a, e) => a + e.amount, 0n);
    expect(debtsOut).toBe($(24.25));
    const credIn = edges.filter((e) => e.to).reduce((a, e) => a + e.amount, 0n);
    expect(credIn).toBe($(80.45));
    expect(edges[0]).toEqual({ kind: "MemberToMember", from: "ben", to: "maya", amount: $(16.17) });
  });
  it("is order independent and keeps each member on one side", () => {
    const pos = Array.from({ length: 12 }, (_, i) => ({ address: `m${i}`, net: BigInt((i * 7919) % 200) * 1_000_000n - 90_000_000n }));
    const a = minCashFlow(pos);
    const b = minCashFlow([...pos].reverse());
    expect(a).toEqual(b);
    const payers = new Set(a.filter((e) => e.from).map((e) => e.from));
    const payees = new Set(a.filter((e) => e.to).map((e) => e.to));
    for (const p of payers) expect(payees.has(p)).toBe(false);
  });
});

describe("settle preview (Pot.settle)", () => {
  it("pays everyone in full when the pot covers credits", () => {
    const r = previewSettle({
      potBalance: $(105),
      members: [
        { address: "a", net: $(80), allowance: 0n, walletBalance: 0n },
        { address: "b", net: $(30), allowance: 0n, walletBalance: 0n },
        { address: "c", net: $(-10), allowance: $(100), walletBalance: $(5) },
      ],
    });
    expect(r.pulls.c).toBe($(5));
    expect(r.debts.c).toBe($(5));
    expect(r.payouts.a).toBe($(80));
    expect(r.payouts.b).toBe($(30)); // balance 105 + pulled 5 = 110 = credits
  });
  it("pro-rates when the pot is short", () => {
    const r = previewSettle({
      potBalance: $(50),
      members: [
        { address: "a", net: $(60), allowance: 0n, walletBalance: 0n },
        { address: "b", net: $(40), allowance: 0n, walletBalance: 0n },
        { address: "c", net: $(-50), allowance: 0n, walletBalance: 0n },
      ],
    });
    expect(r.payouts.a).toBe($(30));
    expect(r.payouts.b).toBe($(20));
    expect(r.debts.c).toBe($(50));
    expect(r.unpaidClaims.a).toBe($(30));
  });
  it("exit preview", () => {
    expect(previewExit($(10), $(5), 0n, 0n)).toEqual({ paid: $(5), pulled: 0n, debt: 0n });
    expect(previewExit($(-10), $(5), $(4), $(100))).toEqual({ paid: 0n, pulled: $(4), debt: $(6) });
  });
});

describe("split parts", () => {
  it("gives the remainder to the first member", () => {
    expect(splitParts(100n, [1, 1, 1])).toEqual([34n, 33n, 33n]);
    expect(splitParts($(18), [1, 1, 1])).toEqual([$(6), $(6), $(6)]);
    expect(splitParts(10n, [1, 2])).toEqual([4n, 6n]);
    expect(splitParts(7n, [])).toEqual([]);
  });
});

describe("rules", () => {
  it("approvals required follows protocol.md tiers and caps at active", () => {
    const r = PRESETS.balanced.rules;
    expect(approvalsRequired(r, $(25), 4)).toBe(1);
    expect(approvalsRequired(r, $(26), 4)).toBe(2);
    expect(approvalsRequired(r, $(250), 4)).toBe(3);
    expect(approvalsRequired(r, $(250), 1)).toBe(1);
    expect(approvalsRequired(PRESETS.strict.rules, $(500), 4)).toBe(4);
    expect(approvalsRequired(PRESETS.pilot.rules, $(0.25), 3)).toBe(1);
    expect(approvalsRequired(PRESETS.pilot.rules, $(0.4), 3)).toBe(2);
  });
  it("describes presets in plain words without banned vocabulary", () => {
    const banned = /\b(wallet|address|gas|token|chain|transaction|blockchain|crypto|sign)s?\b/i;
    for (const p of Object.values(PRESETS)) {
      for (const line of [...rulesInWords(p.rules, { reviewWindowSec: p.reviewWindowSec }), presetBlurb(p.rules)]) expect(line).not.toMatch(banned);
    }
    expect(presetBlurb(PRESETS.balanced.rules)).toBe("Up to $25 goes through now. $25–$200 needs 1 OK. Over $200 needs a majority. Up to $150 a day each.");
  });
});

describe("links", () => {
  const secret = new Uint8Array(32).fill(7);
  const pot = "0x1234567890123456789012345678901234567890";
  it("invite round-trip keeps the secret in the fragment", () => {
    const u = inviteUrl("plans.0xo.in", pot, secret, "Maya");
    expect(u.split("#")[0]).toBe(`https://plans.0xo.in/j/${pot}`);
    const p = parseLink(u);
    expect(p?.kind).toBe("invite");
    if (p?.kind === "invite") {
      expect(p.pot).toBe(pot);
      expect(Array.from(p.secret)).toEqual(Array.from(secret));
      expect(p.inviter).toBe("Maya");
    }
    expect(displayLink(u)).toBe("plans.0xo.in/j/1234-7890");
  });
  it("claim and code links", () => {
    const c = parseLink(claimUrl("plans.0xo.in", secret, { sender: "Leah", note: "Train 🚆", amount: "25000000" }));
    expect(c).toMatchObject({ kind: "claim", sender: "Leah", note: "Train 🚆", amount: "25000000" });
    const k = parseLink(codeUrl("plans.0xo.in", pot, { name: "Sam", city: "New York", country: "US", currency: "USD" }));
    expect(k).toMatchObject({ kind: "code", address: pot, name: "Sam", city: "New York", country: "US", currency: "USD" });
    expect(parseLink("plans-test://j/" + pot + "#s=" + "B".repeat(43))?.kind).toBe("invite");
    expect(parseLink("https://example.com/x")).toBeNull();
    expect(parseLink(`https://plans.0xo.in/j/${pot}`)).toBeNull();
  });
});
