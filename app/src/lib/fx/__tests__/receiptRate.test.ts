/** fx/receiptRate: which rate a receipt shows (round → round in effect → Plans quote → none) and how it reads. */
import {
  diffBpsOf,
  diffText,
  formatLocalAt,
  groupedRateLines,
  pairText,
  pickReceiptRate,
  rateLines,
  rateText,
  roundCoversTime,
  roundFromMap,
  roundFromRow,
  roundQuotable,
  roundRateE8,
  shareRateLine,
  sourceText,
  usdToLocalAt,
  utcClockSec,
  utcStamp,
  type RoundLike,
} from "../receiptRate";

const T = 1_791_270_000; // Tue 6 Oct 2026 07:00:00 UTC
const ROUND: RoundLike = { roundId: "42", scheduledTime: T, usdPerUnitE8: { GBP: 134_720_000n, INR: 1_196_172n, EUR: 108_700_000n }, txHash: "0xround" };
const QUOTE = { rateE8: 74_300_000n, timestamp: T + 600, source: "ECB reference rates via frankfurter.app" };

describe("round maths", () => {
  it("cross rates like PlansSend (floored, USD = 1e8) and gives up on a missing side", () => {
    expect(roundRateE8(ROUND, "GBP", "USD")).toBe(134_720_000n);
    expect(roundRateE8(ROUND, "USD", "GBP")).toBe(74_228_028n);
    expect(roundRateE8(ROUND, "GBP", "INR")).toBe((134_720_000n * 100_000_000n) / 1_196_172n);
    expect(roundRateE8(ROUND, "AUSD", "GBP")).toBe(74_228_028n);
    expect(roundRateE8(ROUND, "USD", "JPY")).toBeNull();
  });

  it("a round covers the 6 hours after its scheduled time (5 min early skew allowed)", () => {
    expect(roundCoversTime(ROUND, T)).toBe(true);
    expect(roundCoversTime(ROUND, T + 6 * 3600)).toBe(true);
    expect(roundCoversTime(ROUND, T + 6 * 3600 + 1)).toBe(false);
    expect(roundCoversTime(ROUND, T - 300)).toBe(true);
    expect(roundCoversTime(ROUND, T - 301)).toBe(false);
    expect(roundCoversTime({ scheduledTime: 0 }, T)).toBe(false);
  });

  it("difference in bps truncates toward zero like Solidity", () => {
    expect(diffBpsOf(134_800_000n, 134_720_000n)).toBe(5n);
    expect(diffBpsOf(134_600_000n, 134_720_000n)).toBe(-8n);
    expect(diffBpsOf(134_720_000n, 134_720_000n)).toBe(0n);
    expect(diffBpsOf(1n, 0n)).toBe(0n);
  });
});

describe("roundQuotable (may a send made now name this round?)", () => {
  it("needs both currencies, a different pair, and 30 min to spare inside 6 h", () => {
    expect(roundQuotable(ROUND, "GBP", "USD", T + 60)).toBe(true);
    expect(roundQuotable(ROUND, "GBP", "USD", T + 5.5 * 3600)).toBe(true);
    expect(roundQuotable(ROUND, "GBP", "USD", T + 5.5 * 3600 + 1)).toBe(false);
    expect(roundQuotable(ROUND, "GBP", "JPY", T)).toBe(false);
    expect(roundQuotable(ROUND, "GBP", "GBP", T)).toBe(false);
    expect(roundQuotable({ ...ROUND, roundId: "0" }, "GBP", "USD", T)).toBe(false);
    expect(roundQuotable(null, "GBP", "USD", T)).toBe(false);
    expect(roundQuotable(ROUND, "GBP", "USD", T - 600)).toBe(false);
  });
});

describe("pickReceiptRate", () => {
  it("same currency: no exchange, whatever else is known", () => {
    expect(pickReceiptRate({ from: "GBP", to: "GBP", recorded: { roundId: "42", appliedE8: 100_000_000n }, round: ROUND, quote: QUOTE }).kind).toBe("same");
    expect(pickReceiptRate({ from: "AUSD", to: "USD" }).kind).toBe("same");
  });

  it("a recorded round wins, with the recorded reference and difference", () => {
    const r = pickReceiptRate({ from: "GBP", to: "USD", recorded: { roundId: "42", refRateE8: "134720000", diffBps: "0", appliedE8: "134720000" }, round: ROUND, quote: QUOTE });
    expect(r).toEqual({ kind: "round", from: "GBP", to: "USD", roundId: "42", rateE8: 134_720_000n, at: T, appliedE8: 134_720_000n, diffBps: 0n, txHash: "0xround", recorded: true });
  });

  it("a recorded round is used even when it is too old to be quoted now, and when its numbers aren't loaded", () => {
    const old = pickReceiptRate({ from: "USD", to: "GBP", recorded: { roundId: 42n }, round: ROUND, atSec: T + 30 * 86400 });
    expect(old).toMatchObject({ kind: "round", roundId: "42", rateE8: 74_228_028n, at: T, recorded: true });
    const bare = pickReceiptRate({ from: "USD", to: "GBP", recorded: { roundId: "41" }, round: ROUND, quote: QUOTE });
    expect(bare).toMatchObject({ kind: "round", roundId: "41", rateE8: undefined, at: undefined });
  });

  it("computes the difference itself when only the applied rate and the round are known", () => {
    const r = pickReceiptRate({ from: "GBP", to: "USD", recorded: { roundId: "42", appliedE8: 134_600_000n }, round: ROUND });
    expect(r).toMatchObject({ kind: "round", diffBps: -8n });
  });

  it("a send with no round shows the rate Plans quoted to the sender (not today's quote)", () => {
    const r = pickReceiptRate({ from: "GBP", to: "USD", recorded: { roundId: "0", appliedE8: "134500000", appliedAt: T - 60 }, round: ROUND, atSec: T, quote: QUOTE });
    expect(r).toEqual({ kind: "quote", from: "GBP", to: "USD", rateE8: 134_500_000n, at: T - 60, source: QUOTE.source });
  });

  it("without a recorded round, the round in effect when the money moved", () => {
    expect(pickReceiptRate({ from: "USD", to: "INR", round: ROUND, atSec: T + 3600, quote: QUOTE })).toMatchObject({ kind: "round", roundId: "42", rateE8: (100_000_000n * 100_000_000n) / 1_196_172n, recorded: false });
  });

  it("falls back to Plans' quote when the round is stale for that time or lacks the currency", () => {
    expect(pickReceiptRate({ from: "USD", to: "GBP", round: ROUND, atSec: T + 7 * 3600, quote: QUOTE })).toMatchObject({ kind: "quote", rateE8: 74_300_000n, at: T + 600 });
    expect(pickReceiptRate({ from: "USD", to: "JPY", round: ROUND, atSec: T, quote: { ...QUOTE, rateE8: 14_850_000_000n } })).toMatchObject({ kind: "quote" });
  });

  it("says so when there is nothing: never a made-up rate", () => {
    expect(pickReceiptRate({ from: "USD", to: "GBP" })).toEqual({ kind: "none", from: "USD", to: "GBP" });
    expect(pickReceiptRate({ from: "USD", to: "GBP", round: ROUND, atSec: T + 86400, quote: null })).toEqual({ kind: "none", from: "USD", to: "GBP" });
    expect(pickReceiptRate({ from: "USD", to: "GBP", quote: { rateE8: 0n, timestamp: T } }).kind).toBe("none");
    expect(pickReceiptRate({ from: "GBP", to: "USD", recorded: { roundId: "0", appliedE8: "0" } }).kind).toBe("none");
  });
});

describe("words", () => {
  it("times are UTC with the date", () => {
    expect(utcStamp(T)).toBe("6 Oct 07:00 UTC");
    expect(utcClockSec(T + 62)).toBe("07:01:02 UTC");
  });

  it("pairs read with the stronger currency first, either direction", () => {
    expect(pairText("GBP", "USD", 134_720_000n)).toBe("1 GBP = 1.3472 USD");
    expect(pairText("USD", "GBP", 74_228_028n)).toBe("1 GBP = 1.3472 USD");
    expect(pairText("USD", "INR", 8_359_934_860n)).toBe("1 USD = 83.5993 INR");
  });

  it("difference as a signed percentage", () => {
    expect(diffText(0n)).toBe("0.00%");
    expect(diffText(5n)).toBe("+0.05%");
    expect(diffText(-108n)).toBe("−1.08%");
  });

  it("source lines", () => {
    expect(sourceText(pickReceiptRate({ from: "USD", to: "GBP", round: ROUND, atSec: T }))).toBe("Chainlink-fed reference rate, round 42, 6 Oct 07:00 UTC");
    expect(sourceText(pickReceiptRate({ from: "USD", to: "GBP", recorded: { roundId: 7 } }))).toBe("Chainlink-fed reference rate, round 7");
    expect(sourceText(pickReceiptRate({ from: "USD", to: "GBP", quote: QUOTE }))).toBe("ECB reference rate quoted by Plans, 6 Oct 07:10 UTC");
    expect(sourceText(pickReceiptRate({ from: "USD", to: "GBP", quote: { rateE8: 1n, timestamp: T } }))).toBe("Reference rate quoted by Plans, 6 Oct 07:00 UTC");
    expect(sourceText(pickReceiptRate({ from: "USD", to: "GBP" }))).toBe("No reference rate recorded");
    expect(sourceText(pickReceiptRate({ from: "USD", to: "USD" }))).toBe("Same currency, no exchange");
  });

  it("rate lines: a send with a round has applied, reference, source and difference", () => {
    const r = pickReceiptRate({ from: "GBP", to: "USD", recorded: { roundId: "42", refRateE8: 134_720_000n, diffBps: 0n, appliedE8: 134_720_000n }, round: ROUND });
    expect(rateLines(r)).toEqual([
      ["Applied", "1 GBP = 1.3472 USD"],
      ["Reference", "1 GBP = 1.3472 USD"],
      ["Source", "Chainlink-fed reference rate, round 42, 6 Oct 07:00 UTC"],
      ["Difference", "0.00%"],
    ]);
    // applied and reference turn the same way, so they compare
    const usdGbp = pickReceiptRate({ from: "USD", to: "GBP", recorded: { roundId: "42", appliedE8: 74_300_000n }, round: ROUND });
    expect(rateLines(usdGbp).slice(0, 2)).toEqual([
      ["Applied", "1 GBP = 1.3459 USD"],
      ["Reference", "1 GBP = 1.3472 USD"],
    ]);
  });

  it("rate lines for a quote, a bare round, none and same", () => {
    expect(rateLines(pickReceiptRate({ from: "USD", to: "GBP", quote: QUOTE }))).toEqual([
      ["Rate", "1 GBP = 1.3459 USD"],
      ["Source", "ECB reference rate quoted by Plans, 6 Oct 07:10 UTC"],
    ]);
    expect(rateLines(pickReceiptRate({ from: "USD", to: "GBP", recorded: { roundId: "9" } }))).toEqual([["Source", "Chainlink-fed reference rate, round 9"]]);
    expect(rateLines(pickReceiptRate({ from: "USD", to: "GBP" }))).toEqual([["Rate", "No reference rate recorded"]]);
    expect(rateLines(pickReceiptRate({ from: "GBP", to: "GBP" }))).toEqual([["Rate", "Same currency, no exchange"]]);
    expect(rateText(pickReceiptRate({ from: "USD", to: "GBP", recorded: { roundId: "9" } }))).toBe("Reference rate loading");
  });

  it("grouped lines for a settle-up: one line per currency, the shared source once", () => {
    const g = pickReceiptRate({ from: "USD", to: "GBP", recorded: { roundId: "42" }, round: ROUND });
    const i = pickReceiptRate({ from: "USD", to: "INR", recorded: { roundId: "42" }, round: ROUND });
    expect(groupedRateLines([g, i, pickReceiptRate({ from: "USD", to: "USD" })])).toEqual([
      ["GBP", "1 GBP = 1.3472 USD"],
      ["INR", "1 USD = 83.6000 INR"],
      ["Source", "Chainlink-fed reference rate, round 42, 6 Oct 07:00 UTC"],
    ]);
    const q = pickReceiptRate({ from: "USD", to: "EUR", quote: QUOTE });
    expect(groupedRateLines([g, q])).toEqual([
      ["GBP", "1 GBP = 1.3472 USD"],
      ["EUR", "1 EUR = 1.3459 USD"],
      ["Source · GBP", "Chainlink-fed reference rate, round 42, 6 Oct 07:00 UTC"],
      ["Source · EUR", "ECB reference rate quoted by Plans, 6 Oct 07:10 UTC"],
    ]);
    expect(groupedRateLines([pickReceiptRate({ from: "USD", to: "USD" })])).toEqual([["Rate", "All in dollars, no exchange"]]);
    expect(groupedRateLines([g])).toEqual(rateLines(g));
    expect(groupedRateLines([])).toEqual([]);
  });

  it("share line", () => {
    expect(shareRateLine(pickReceiptRate({ from: "USD", to: "GBP", round: ROUND, atSec: T }))).toBe("1 GBP = 1.3472 USD · Chainlink-fed reference rate, round 42, 6 Oct 07:00 UTC");
    expect(shareRateLine(pickReceiptRate({ from: "USD", to: "GBP" }))).toBe("No reference rate recorded");
  });
});

describe("amounts at the receipt's rate", () => {
  it("converts dollars with the shown rate only", () => {
    const g = pickReceiptRate({ from: "USD", to: "GBP", round: ROUND, atSec: T });
    expect(usdToLocalAt(52_350_000n, g)).toBe((52_350_000n * 74_228_028n) / 1_000_000n);
    expect(formatLocalAt(52_350_000n, g)).toBe("£38.86");
    expect(formatLocalAt(1_000_000n, pickReceiptRate({ from: "USD", to: "USD" }))).toBe("$1.00");
    expect(formatLocalAt(1_000_000n, pickReceiptRate({ from: "USD", to: "GBP" }))).toBeUndefined();
    expect(formatLocalAt(1_000_000n, pickReceiptRate({ from: "USD", to: "GBP", recorded: { roundId: "9" } }))).toBeUndefined();
  });
});

describe("rounds from the indexer, the relayer and the contract", () => {
  it("indexer row: drops absent currencies", () => {
    const r = roundFromRow({ roundId: "42", scheduledTime: String(T), txHash: "0xabc", rateGBP: "134720000", rateEUR: "0", rateINR: "1196172" });
    expect(r).toEqual({ roundId: "42", scheduledTime: T, usdPerUnitE8: { GBP: 134_720_000n, INR: 1_196_172n }, txHash: "0xabc" });
  });
  it("relayer / contract map", () => {
    expect(roundFromMap({ roundId: 3n, scheduledTime: T, usdPerUnitE8: { gbp: "134720000", INR: 0n } })).toEqual({ roundId: "3", scheduledTime: T, usdPerUnitE8: { GBP: 134_720_000n } });
  });
});
