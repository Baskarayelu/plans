import { HighTier } from "../lib/chain/eip712";
import { UINT64_MAX } from "../lib/domain/rules";
import {
  amountUnits,
  budgetInfo,
  canFinalize,
  DISPUTE_CHOICES,
  DISPUTE_PERIOD,
  disputeTally,
  durationText,
  eachAmount,
  eligibleVoters,
  joinNames,
  likelyOutcome,
  orderedSplit,
  paidBefore,
  plainFixed,
  ruleLine,
  sanitizeAmountText,
  shareChanges,
  sharesFor,
  tierSentence,
  toBase64,
} from "../lib/spend/logic";

const $ = (n: number) => BigInt(Math.round(n * 100)) * 10_000n;
const balanced = { instantMax: $(25), oneApprovalMax: $(200), highTier: HighTier.MAJORITY };

describe("amount entry", () => {
  it("keeps a clean decimal", () => {
    expect(sanitizeAmountText("12.345", 2)).toBe("12.34");
    expect(sanitizeAmountText("0012", 2)).toBe("12");
    expect(sanitizeAmountText("1.2.3", 2)).toBe("1.23");
    expect(sanitizeAmountText(".5", 2)).toBe("0.5");
    expect(sanitizeAmountText("12,5", 2)).toBe("12.5");
    expect(sanitizeAmountText("1500.5", 0)).toBe("1500");
    expect(sanitizeAmountText("$ 18", 2)).toBe("18");
  });
  it("converts dollars and local money to dollar units", () => {
    expect(amountUnits("18", false, "GBP", undefined)).toBe(18_000_000n);
    // 1 USD = 0.74228 GBP → £13.36 ≈ $17.998
    expect(amountUnits("13.36", true, "GBP", 74_228_000n)).toBe(17_998_598n);
    expect(amountUnits("13.36", true, "GBP", undefined)).toBeNull();
    expect(amountUnits("", false, "USD", undefined)).toBeNull();
  });
  it("prints plain editable text", () => {
    expect(plainFixed(18_500_000n, 6, 2)).toBe("18.5");
    expect(plainFixed(18_000_000n, 6, 2)).toBe("18");
    expect(plainFixed(1_336_000_000n, 8, 2)).toBe("13.36");
    expect(plainFixed(150_049_000_000n, 8, 0)).toBe("1500");
    expect(plainFixed(0n, 6, 2)).toBe("");
  });
});

describe("splits", () => {
  it("matches the contract: first person takes the remainder", () => {
    expect(sharesFor(10_000_000n, [1, 1, 1])).toEqual([3_333_334n, 3_333_333n, 3_333_333n]);
    expect(sharesFor(18_000_000n, [2, 1])).toEqual([12_000_000n, 6_000_000n]);
    expect(sharesFor(0n, [1, 1])).toEqual([0n, 0n]);
    expect(eachAmount(18_000_000n, [1, 1, 1])).toBe(6_000_000n);
    expect(eachAmount(18_000_000n, [2, 1])).toBeNull();
  });
  it("orders members as the plan lists them and clamps weights", () => {
    const order = ["0xa", "0xb", "0xc", "0xd"];
    expect(orderedSplit(order, ["0xC", "0xa"])).toEqual({ members: ["0xa", "0xc"], weights: [1, 1] });
    expect(orderedSplit(order, ["0xb", "0xd"], { "0xb": 2, "0xd": 12 }, true)).toEqual({ members: ["0xb", "0xd"], weights: [2, 9] });
    expect(orderedSplit(order, ["0xb"], { "0xb": 3 }, false).weights).toEqual([1]);
  });
  it("joins names", () => {
    expect(joinNames(["Sam"])).toBe("Sam");
    expect(joinNames(["Sam", "Asha"])).toBe("Sam and Asha");
    expect(joinNames(["Sam", "Asha", "Ben"])).toBe("Sam, Asha and Ben");
  });
});

describe("rules in words", () => {
  it("describes tiers", () => {
    expect(ruleLine(balanced, $(18), 1)).toBe("Under $25");
    expect(ruleLine(balanced, $(120), 2)).toBe("$25–$200 needs 1 OK");
    expect(ruleLine(balanced, $(250), 3)).toBe("Over $200 needs 2 OKs");
    expect(ruleLine({ ...balanced, oneApprovalMax: UINT64_MAX, instantMax: $(100) }, $(150), 2)).toBe("Over $100 needs 1 OK");
    expect(tierSentence(balanced, $(120), 2)).toBe("$25–$200 needs one friend's OK.");
    expect(tierSentence(balanced, $(250), 3)).toContain("a majority's OK");
  });
  it("works out what's left in a budget", () => {
    expect(budgetInfo(0n)).toBeNull();
    expect(budgetInfo($(120), { budget: "0", spent: String($(96)), refunded: "0" })).toEqual({ budget: $(120), spent: $(96), remaining: $(24) });
    expect(budgetInfo(0n, { budget: String($(100)), spent: String($(130)), refunded: String($(10)) })).toEqual({ budget: $(100), spent: $(120), remaining: 0n });
  });
});

describe("paid before", () => {
  it("lists distinct business payees, newest first", () => {
    const rows = [
      { kind: "PAY", payee: "0xB1", status: "Executed", category: 3, amount: "36000000", executedAt: 100 },
      { kind: "PAY", payee: "0xb1", status: "Executed", category: 3, amount: "12000000", executedAt: 200 },
      { kind: "PAY", payee: "0xm1", status: "Executed", category: 7, amount: "1000000", executedAt: 300 },
      { kind: "PAY", payee: "0xb2", status: "Pending", category: 4, amount: "1000000", proposedAt: 400 },
      { kind: "LINK", payee: "0xb3", status: "Executed", category: 4, amount: "1000000", executedAt: 500 },
    ];
    expect(paidBefore(rows, ["0xM1"])).toEqual([{ payee: "0xb1", category: 3, amount: 12_000_000n, at: 200 }]);
  });
});

describe("disputes", () => {
  const active = ["0xa", "0xb", "0xc", "0xd"];
  it("excludes the spender and the opener from voting", () => {
    expect(eligibleVoters(active, "0xB", "0xc")).toEqual(["0xa", "0xd"]);
  });
  it("tallies and decides by strict majority of votes cast", () => {
    const t = disputeTally(["0xa", "0xd"], [{ account_id: "0xA", spenderCovers: true }]);
    expect(t).toMatchObject({ cover: 1, keep: 0, waiting: ["0xd"], allVoted: false });
    expect(likelyOutcome(1, 1)).toBe("Keep");
    expect(likelyOutcome(2, 1)).toBe("SpenderCovers");
    expect(likelyOutcome(0, 0)).toBe("Keep");
  });
  it("can be closed after 48 h or once everyone eligible voted", () => {
    expect(canFinalize(1000, 1000 + DISPUTE_PERIOD, 2, false)).toBe(true);
    expect(canFinalize(1000, 1001, 2, true)).toBe(true);
    expect(canFinalize(1000, 1001, 0, true)).toBe(false);
    expect(canFinalize(1000, 1001, 2, false)).toBe(false);
  });
  it("maps the reasons onto the protocol's three codes", () => {
    expect(DISPUTE_CHOICES.map((c) => c.code)).toEqual([2, 0, 1, 0, 1]);
  });
  it("shows only the shares that moved", () => {
    const ch = shareChanges(["0xb", "0xa", "0xc", "0xd"], ["7000000", "7000000", "7000000", "7000000"], ["0xb"], ["28000000"]);
    expect(ch[0]).toEqual({ address: "0xb", before: 7_000_000n, after: 28_000_000n, diff: 21_000_000n });
    expect(ch).toHaveLength(4);
    expect(ch.slice(1).every((x) => x.diff === -7_000_000n)).toBe(true);
  });
});

describe("misc", () => {
  it("formats durations", () => {
    expect(durationText(18 * 3600 + 20 * 60)).toBe("18 h 20 m");
    expect(durationText(45 * 60)).toBe("45 m");
    expect(durationText(2 * 86400 + 3 * 3600)).toBe("2 d 3 h");
    expect(durationText(-5)).toBe("0 m");
  });
  it("encodes standard base64 with padding", () => {
    const enc = (s: string) => toBase64(new TextEncoder().encode(s));
    expect(enc("")).toBe("");
    expect(enc("f")).toBe("Zg==");
    expect(enc("fo")).toBe("Zm8=");
    expect(enc("foo")).toBe("Zm9v");
    expect(toBase64(new Uint8Array([0xfb, 0xff]))).toBe("+/8=");
  });
});
