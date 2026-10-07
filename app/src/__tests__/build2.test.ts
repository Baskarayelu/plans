/** Build 2 pure logic: share card data (134–137), Agora backing (140–141), passkey sheet timing (B5), rule words (149). */
import { attestationLine, ATTESTATION, formatAsOf, formatDay, formatSupply, parseMetrics, fetchMonadSupply } from "../lib/agora/backing";
import { needsWaitingState, SHEET_GIVE_UP_MS, SHEET_SLOW_MS, sheetPhase, timingLine } from "../lib/identity/sheetTiming";
import { CATEGORIES, PRESETS, rulesInWords } from "../lib/domain/rules";
import { HighTier } from "../lib/chain/eip712";
import { countLine, displayProofUrl, flagCounts, proofUrl, settleCard, settleSeconds, shareMessage } from "../lib/share/settleCard";

const POT = "0x7Kq2000000000000000000000000000000003e92b5".replace("K", "a");
const D = 1_000_000n;
// Sat 17 Oct 2026 10:42 UTC
const SETTLED_AT = Date.UTC(2026, 9, 17, 10, 42) / 1000;

describe("share card", () => {
  const members = [{ country: "GB" }, { country: "gb" }, { country: "US" }, { country: "IN" }];
  const base = { pot: POT, members, totalIn: 800n * D, paidOut: 112_400_000n, settleMs: 600, settledAt: SETTLED_AT, planName: "Lisbon, 12–16 Oct", showName: false };

  it("counts friends and countries, flags with counts, most first", () => {
    const c = settleCard(base);
    expect(c.friends).toBe(4);
    expect(c.countries).toBe(3);
    expect(c.headline).toBe("4 friends · 3 countries · settled in one tap");
    expect(c.subline).toBeUndefined();
    expect(c.flags.map((f) => [f.code, f.count])).toEqual([
      ["GB", 2],
      ["IN", 1],
      ["US", 1],
    ]);
    expect(c.flags[0].flag).toBe("🇬🇧");
  });

  it("totals, paid out and time to settle as tiles", () => {
    expect(settleCard(base).stats).toEqual([
      { value: "$800", label: "put in together" },
      { value: "$112.40", label: "paid back out" },
      { value: "0.6 s", label: "to settle up" },
    ]);
    // without a measured time (settled on another phone) the third tile is the spend count
    expect(settleCard({ ...base, settleMs: undefined, spendCount: 18 }).stats[2]).toEqual({ value: "18", label: "spends" });
    expect(settleCard({ ...base, settleMs: undefined, spendCount: 1 }).stats[2]).toEqual({ value: "1", label: "spend" });
  });

  it("dates in UTC for the tag and band; country names for the places band", () => {
    const c = settleCard(base);
    expect(c.dateTag).toBe("SETTLED · 17 OCT");
    expect(c.dateBand).toBe("SETTLED · SAT 17 OCT 2026");
    expect(c.placesBand).toBe("UNITED KINGDOM · INDIA · UNITED STATES");
  });

  it("never puts the name on the card or link unless the sharer opts in", () => {
    const off = settleCard(base);
    expect(JSON.stringify(off)).not.toContain("Lisbon");
    expect(off.url).toBe(`https://plans.0xo.in/s/${POT.toLowerCase()}`);
    const on = settleCard({ ...base, showName: true });
    expect(on.headline).toBe("Lisbon, 12–16 Oct");
    expect(on.subline).toBe("4 friends · 3 countries · settled in one tap");
    // the name goes only in the fragment, which browsers never send to the server
    expect(on.url).toBe(`https://plans.0xo.in/s/${POT.toLowerCase()}#n=Lisbon%2C%2012%E2%80%9316%20Oct`);
    expect(on.url.split("#")[0]).not.toContain("Lisbon");
    expect(shareMessage(on)).toContain("#n=");
    expect(shareMessage(off)).toBe(`4 friends · 3 countries · settled in one tap\nhttps://plans.0xo.in/s/${POT.toLowerCase()}`);
  });

  it("an empty or blank name falls back to counts", () => {
    expect(settleCard({ ...base, showName: true, planName: "  " }).headline).toBe("4 friends · 3 countries · settled in one tap");
    expect(proofUrl(POT, { name: " " })).toBe(`https://plans.0xo.in/s/${POT.toLowerCase()}`);
  });

  it("singulars and unknown countries", () => {
    expect(countLine(1, 1)).toBe("1 friend · 1 country · settled in one tap");
    expect(countLine(3, 0)).toBe("3 friends · settled in one tap");
    expect(flagCounts([{ country: null }, { country: "ZZ" }, {}])).toEqual([]);
    const c = settleCard({ ...base, members: [{ country: "XX" }, {}] });
    expect(c.countries).toBe(0);
    expect(c.headline).toBe("2 friends · settled in one tap");
  });

  it("short display link, other host", () => {
    expect(displayProofUrl(POT)).toBe(`plans.0xo.in/s/${POT.toLowerCase().slice(0, 6)}…${POT.slice(-4)}`);
    expect(proofUrl(POT, { host: "example.test" })).toBe(`https://example.test/s/${POT.toLowerCase()}`);
  });

  it("settle seconds", () => {
    expect(settleSeconds(600)).toBe("0.6 s");
    expect(settleSeconds(10)).toBe("0.1 s");
    expect(settleSeconds(12_400)).toBe("12 s");
  });
});

describe("agora backing", () => {
  const body = {
    chains: [
      { chainId: "eip155:1", circulatingSupply: "63390284.922780", network: "ethereum", totalSupply: "76667715.502124" },
      { chainId: "eip155:143", circulatingSupply: "140489319.969221", network: "monad", totalSupply: "144672835.358584" },
    ],
    circulatingSupply: "221768478.350340",
    totalSupply: "251857724.192200",
  };

  it("bundled attestation reads as a dated line", () => {
    expect(ATTESTATION.firm).toBe("Grant Thornton");
    expect(attestationLine()).toBe("Attested 31 Aug 2026 (Grant Thornton)");
    expect(attestationLine({ date: "2026-09-30", firm: "Grant Thornton", url: "" })).toBe("Attested 30 Sep 2026 (Grant Thornton)");
    expect(attestationLine({ date: "soon", firm: "X", url: "" })).toBe("Attested by X");
  });

  it("formats calendar dates without a time-zone shift", () => {
    expect(formatDay("2026-08-31")).toBe("31 Aug 2026");
    expect(formatDay("2026-01-01")).toBe("1 Jan 2026");
    expect(formatDay("2026-13-01")).toBe("");
    expect(formatDay("31/08/2026")).toBe("");
  });

  it("picks Monad from the metrics and keeps the Date header", () => {
    const m = parseMetrics(body, "Wed, 07 Oct 2026 09:15:01 GMT");
    expect(m?.circulating).toBeCloseTo(140489319.969221);
    expect(m?.total).toBeCloseTo(144672835.358584);
    expect(formatAsOf(m!.asOf!)).toBe("7 Oct 2026, 09:15 UTC");
    expect(parseMetrics(body, "not a date")?.asOf).toBeUndefined();
    expect(parseMetrics(body)?.asOf).toBeUndefined();
  });

  it("returns null on any unexpected shape", () => {
    expect(parseMetrics(null)).toBeNull();
    expect(parseMetrics({})).toBeNull();
    expect(parseMetrics({ chains: [{ chainId: "eip155:1", circulatingSupply: "1", totalSupply: "1" }] })).toBeNull();
    expect(parseMetrics({ chains: [{ network: "monad", circulatingSupply: "abc", totalSupply: "1" }] })).toBeNull();
    expect(parseMetrics({ chains: [{ network: "monad", circulatingSupply: "-1", totalSupply: "1" }] })).toBeNull();
    expect(parseMetrics({ chains: [{ network: "monad", circulatingSupply: 5, totalSupply: 6 }] })).toEqual({ circulating: 5, total: 6, asOf: undefined });
  });

  it("supply in plain money words", () => {
    expect(formatSupply(140489319.969221)).toBe("$140.5 million");
    expect(formatSupply(144672835.358584)).toBe("$144.7 million");
    expect(formatSupply(2_000_000_000)).toBe("$2 billion");
    expect(formatSupply(12_345.4)).toBe("$12,345");
  });

  it("fetch failures throw so the screen can hide the figure", async () => {
    const ok = (async () => ({ ok: true, status: 200, json: async () => body, headers: { get: () => "Wed, 07 Oct 2026 09:15:01 GMT" } })) as unknown as typeof fetch;
    await expect(fetchMonadSupply(ok)).resolves.toMatchObject({ total: expect.any(Number) });
    const bad = (async () => ({ ok: false, status: 503, json: async () => ({}), headers: { get: () => null } })) as unknown as typeof fetch;
    await expect(fetchMonadSupply(bad)).rejects.toThrow();
    const weird = (async () => ({ ok: true, status: 200, json: async () => ({ chains: [] }), headers: { get: () => null } })) as unknown as typeof fetch;
    await expect(fetchMonadSupply(weird)).rejects.toThrow();
    const down = (async () => {
      throw new TypeError("Network request failed");
    }) as unknown as typeof fetch;
    await expect(fetchMonadSupply(down)).rejects.toThrow();
  });
});

describe("passkey sheet timing (B5)", () => {
  it("nothing changes under a second", () => {
    expect(SHEET_SLOW_MS).toBe(1000);
    expect(sheetPhase(0, false)).toBe("quiet");
    expect(sheetPhase(999, false)).toBe("quiet");
    expect(needsWaitingState(999)).toBe(false);
  });
  it("waiting from one second, stuck from fifteen", () => {
    expect(sheetPhase(1000, false)).toBe("waiting");
    expect(needsWaitingState(1000)).toBe(true);
    expect(sheetPhase(SHEET_GIVE_UP_MS - 1, false)).toBe("waiting");
    expect(sheetPhase(SHEET_GIVE_UP_MS, false)).toBe("stuck");
  });
  it("back to normal once the sheet shows or the call ends", () => {
    expect(sheetPhase(5000, true)).toBe("idle");
    expect(sheetPhase(5000, false, true)).toBe("idle");
    expect(sheetPhase(-1, false)).toBe("idle");
  });
  it("logcat line for the lead", () => {
    expect(timingLine("create", 842.4, "shown")).toBe("passkey_sheet flow=create ms=842 result=shown slow=false");
    expect(timingLine("join", 1450, "shown")).toBe("passkey_sheet flow=join ms=1450 result=shown slow=true");
    expect(timingLine("restore", -5, "no-sheet:cancelled")).toBe("passkey_sheet flow=restore ms=0 result=no-sheet:cancelled slow=false");
  });
});

describe("rules as protocol.md says (01–60, 149)", () => {
  it("Balanced: $25 instant, one OK to $200, majority above, $150 a day", () => {
    const r = PRESETS.balanced.rules;
    expect([r.instantMax, r.oneApprovalMax, r.memberDailyCap, r.highTier]).toEqual([25n * D, 200n * D, 150n * D, HighTier.MAJORITY]);
    const w = rulesInWords(r, { active: 4 });
    expect(w[0]).toBe("Spends up to $25 go through straight away.");
    expect(w[1]).toBe("$25–$200 needs one friend's OK. Over $200 needs 3 of 4.");
    expect(w[2]).toBe("Each person can spend up to $150 a day from the pot.");
    expect(w).toContain("Anyone in a split can question a spend for 48 hours.");
    expect(rulesInWords(r)[1]).toBe("$25–$200 needs one friend's OK. Over $200 needs a majority's OK.");
    expect(rulesInWords(r, { active: 2 })[1]).toBe("$25–$200 needs one friend's OK. Over $200 needs a majority's OK.");
  });
  it("Easygoing, Strict, Pilot, Demo", () => {
    const e = PRESETS.easygoing.rules;
    expect([e.instantMax, e.memberDailyCap, e.highTier]).toEqual([100n * D, 0n, HighTier.MAJORITY]);
    const s = PRESETS.strict.rules;
    expect([s.instantMax, s.oneApprovalMax, s.memberDailyCap, s.highTier]).toEqual([0n, 100n * D, 100n * D, HighTier.ALL]);
    expect(rulesInWords(s, { active: 4 })[1]).toBe("Up to $100 needs one friend's OK. Over that needs everyone's OK.");
    const p = PRESETS.pilot;
    expect([p.rules.instantMax, p.rules.oneApprovalMax, p.durationSec, p.reviewWindowSec]).toEqual([250_000n, D, 48 * 3600, 0]);
    const d = PRESETS.demo;
    expect([d.rules.instantMax, d.rules.oneApprovalMax, d.rules.ruleTimelock, d.reviewWindowSec]).toEqual([250_000n, D, 300, 0]);
    for (const id of ["easygoing", "balanced", "strict", "pilot"] as const) expect(PRESETS[id].rules.proposalTtl).toBe(24 * 3600);
  });
  it("the 8 categories, in protocol order", () => {
    expect(CATEGORIES.map((c) => c.name)).toEqual(["Stay", "Travel", "Getting around", "Food & drink", "Tickets & activities", "Groceries", "Shopping", "Other"]);
  });
});
