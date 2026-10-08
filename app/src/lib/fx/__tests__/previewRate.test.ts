/**
 * fx/receiptRate, before confirming: the out-of-date block (6 h limit less the half-hour margin
 * sends already keep) and the rate a preview shows, which must be exactly what the finished receipt
 * will show for the same money (same choice of round or quote, same lines).
 */
import {
  CONFIRM_MARGIN_SEC,
  diffBpsOf,
  groupedRateLines,
  MAX_ROUND_AGE_SEC,
  pickReceiptRate,
  previewRate,
  rateFreshAt,
  rateGate,
  rateLines,
  roundQuotable,
  roundRateE8,
  sendPreview,
  shareRateLine,
  type RoundLike,
} from "../receiptRate";

const T = 1_791_270_000; // Tue 6 Oct 2026 07:00:00 UTC
const ROUND: RoundLike = { roundId: "42", scheduledTime: T, usdPerUnitE8: { GBP: 134_720_000n, INR: 1_196_172n, EUR: 108_700_000n } };
const ECB = "ECB reference rates via frankfurter.app";
const H = 3600;
const LIMIT = MAX_ROUND_AGE_SEC - CONFIRM_MARGIN_SEC; // 5.5 h
const quoteAt = (rateE8: bigint, timestamp: number) => ({ rateE8, timestamp, source: ECB });

describe("how old a rate may be when confirming", () => {
  it("is the contract's 6 hours less the half-hour margin sends already keep", () => {
    expect(MAX_ROUND_AGE_SEC).toBe(6 * H);
    expect(LIMIT).toBe(5.5 * H);
    expect(rateFreshAt(T, T)).toBe(true);
    expect(rateFreshAt(T, T + LIMIT)).toBe(true);
    expect(rateFreshAt(T, T + LIMIT + 1)).toBe(false);
    expect(rateFreshAt(T, T + 7 * H)).toBe(false);
  });

  it("allows the 5-minute early skew, and never an unknown time", () => {
    expect(rateFreshAt(T, T - 5 * 60)).toBe(true);
    expect(rateFreshAt(T, T - 5 * 60 - 1)).toBe(false);
    expect(rateFreshAt(0, T)).toBe(false);
    expect(rateFreshAt(undefined, T)).toBe(false);
  });

  it("is the same line a send uses to name a round", () => {
    expect(roundQuotable(ROUND, "GBP", "USD", T + LIMIT)).toBe(true);
    expect(roundQuotable(ROUND, "GBP", "USD", T + LIMIT + 1)).toBe(false);
  });
});

describe("the gate on the confirm button", () => {
  it("lets it go only when every rate is fresh", () => {
    expect(rateGate([], false)).toBe("ok");
    expect(rateGate(["ok", "ok"], false)).toBe("ok");
    expect(rateGate(["ok", "stale"], false)).toBe("stale");
    expect(rateGate(["missing"], false)).toBe("missing");
    expect(rateGate(["missing", "stale"], false)).toBe("stale");
  });

  it("waits (no block message) while rates are still loading", () => {
    expect(rateGate(["missing"], true)).toBe("loading");
    expect(rateGate(["ok"], true)).toBe("ok");
  });
});

describe("a send (Check and send)", () => {
  const pair = quoteAt(134_500_000n, T + 600); // 1 GBP = 1.3450 USD, fetched 10 min after the round
  const usdGbp = quoteAt(74_349_442n, T + 600);
  const usd = quoteAt(100_000_000n, T + 600);

  it("names the fresh round and shows applied, reference and difference", () => {
    const { rate, gate } = sendPreview({ from: "GBP", to: "USD", nowSec: T + H, round: ROUND, pair, usdFrom: usdGbp, usdTo: usd });
    expect(gate).toBe("ok");
    expect(rate).toMatchObject({ kind: "round", roundId: "42", rateE8: 134_720_000n, appliedE8: 134_500_000n, diffBps: diffBpsOf(134_500_000n, 134_720_000n), recorded: true });
    expect(rateLines(rate).map(([k]) => k)).toEqual(["Applied", "Reference", "Source", "Difference"]);
  });

  it("shows exactly the lines the Sent receipt will show once PlansSend records the round", () => {
    const { rate } = sendPreview({ from: "GBP", to: "USD", nowSec: T + H, round: ROUND, pair, usdFrom: usdGbp, usdTo: usd });
    const ref = roundRateE8(ROUND, "GBP", "USD")!;
    // The Sent receipt (send/sent.tsx): the Sent event's refRateE8 and fxDiffBps, and the round's time.
    const receipt = pickReceiptRate({
      from: "GBP",
      to: "USD",
      recorded: { roundId: "42", refRateE8: ref.toString(), diffBps: diffBpsOf(pair.rateE8, ref).toString(), appliedE8: pair.rateE8.toString(), appliedAt: pair.timestamp, appliedSource: ECB },
      round: ROUND,
    });
    expect(rateLines(rate)).toEqual(rateLines(receipt));
    expect(shareRateLine(rate)).toEqual(shareRateLine(receipt));
  });

  it("doesn't name a round in its last half hour: Plans' quote, as the receipt will say", () => {
    const now = T + LIMIT + 60;
    const fresh = quoteAt(134_500_000n, now - 60);
    const { rate, gate } = sendPreview({ from: "GBP", to: "USD", nowSec: now, round: ROUND, pair: fresh, usdFrom: quoteAt(74_349_442n, now - 60), usdTo: quoteAt(100_000_000n, now - 60) });
    expect(gate).toBe("ok");
    expect(rate).toMatchObject({ kind: "quote", rateE8: 134_500_000n, at: now - 60 });
    const receipt = pickReceiptRate({ from: "GBP", to: "USD", recorded: { roundId: "0", appliedE8: fresh.rateE8.toString(), appliedAt: fresh.timestamp, appliedSource: ECB } });
    expect(rateLines(rate)).toEqual(rateLines(receipt));
  });

  it("blocks when the quote it would apply is out of date, even with a fresh round", () => {
    const old = quoteAt(134_500_000n, T - 7 * H);
    const r = sendPreview({ from: "GBP", to: "USD", nowSec: T + H, round: ROUND, pair: old, usdFrom: usdGbp, usdTo: usd });
    expect(r.gate).toBe("stale");
    expect(r.rate.kind).toBe("none");
  });

  it("blocks when a dollar quote that sets the amounts is out of date", () => {
    const r = sendPreview({ from: "GBP", to: "USD", nowSec: T + H, round: ROUND, pair, usdFrom: quoteAt(74_349_442n, T - 6 * H), usdTo: usd });
    expect(r.gate).toBe("stale");
  });

  it("blocks with 'missing' when there is no quote at all, and waits while loading", () => {
    expect(sendPreview({ from: "GBP", to: "INR", nowSec: T + H, pair: null, usdFrom: usdGbp, usdTo: quoteAt(8_360_000_000n, T + 600) }).gate).toBe("missing");
    expect(sendPreview({ from: "GBP", to: "INR", nowSec: T + H, pair: null, usdFrom: usdGbp, usdTo: null, loading: true }).gate).toBe("loading");
  });

  it("same currency: no exchange, but the dollar quote for the amount still has to be fresh", () => {
    const ok = sendPreview({ from: "GBP", to: "GBP", nowSec: T + H, usdFrom: usdGbp, usdTo: usdGbp });
    expect(ok.gate).toBe("ok");
    expect(rateLines(ok.rate)).toEqual([["Rate", "Same currency, no exchange"]]);
    expect(sendPreview({ from: "GBP", to: "GBP", nowSec: T + 7 * H, usdFrom: usdGbp, usdTo: usdGbp }).gate).toBe("stale");
    expect(sendPreview({ from: "USD", to: "USD", nowSec: T + H, usdFrom: usd, usdTo: usd }).gate).toBe("ok");
  });
});

describe("settle-up and leave previews", () => {
  const gbp = quoteAt(74_300_000n, T + 600);
  const inr = quoteAt(8_360_000_000n, T + 600);

  it("settle-up: the fresh round the pot will record, with the Settled receipt's own lines", () => {
    const now = T + 2 * H;
    const preview = ["GBP", "INR", "USD"].map((to) => previewRate({ from: "USD", to, nowSec: now, round: ROUND, quote: to === "GBP" ? gbp : to === "INR" ? inr : null, records: true }));
    expect(preview.map((p) => p.status)).toEqual(["ok", "ok", "ok"]);
    // The Settled receipt (useReceiptRates with the round Settled recorded).
    const receipt = ["GBP", "INR", "USD"].map((to) => pickReceiptRate({ from: "USD", to, recorded: { roundId: "42" }, round: ROUND, atSec: now, quote: to === "GBP" ? gbp : to === "INR" ? inr : null }));
    expect(groupedRateLines(preview.map((p) => p.rate))).toEqual(groupedRateLines(receipt));
    const lines = groupedRateLines(preview.map((p) => p.rate));
    expect(lines[lines.length - 1]).toEqual(["Source", "Chainlink-fed reference rate, round 42, 6 Oct 07:00 UTC"]);
  });

  it("settle-up with the round too old: Plans' quote, as the receipt falls back to when Settled records none", () => {
    const now = T + 6 * H;
    const p = previewRate({ from: "USD", to: "GBP", nowSec: now, round: ROUND, quote: quoteAt(74_300_000n, now - 300), records: true });
    expect(p.status).toBe("ok");
    const receipt = pickReceiptRate({ from: "USD", to: "GBP", recorded: { roundId: "0" }, round: null, quote: quoteAt(74_300_000n, now - 300) });
    expect(rateLines(p.rate)).toEqual(rateLines(receipt));
  });

  it("settle-up blocked: an old round and an old quote are 'stale', nothing at all is 'missing'", () => {
    const now = T + 8 * H;
    expect(previewRate({ from: "USD", to: "GBP", nowSec: now, round: ROUND, quote: gbp, records: true })).toEqual({ rate: { kind: "none", from: "USD", to: "GBP" }, status: "stale" });
    expect(previewRate({ from: "USD", to: "GBP", nowSec: now, round: ROUND, quote: null }).status).toBe("stale");
    expect(previewRate({ from: "USD", to: "JPY", nowSec: now, round: ROUND, quote: null }).status).toBe("missing");
    expect(previewRate({ from: "USD", to: "USD", nowSec: now }).status).toBe("ok");
  });

  it("leave: the round in effect now (not recorded with the money), as any receipt looks it up", () => {
    const now = T + H;
    const p = previewRate({ from: "USD", to: "GBP", nowSec: now, round: ROUND, quote: gbp });
    expect(p.rate).toMatchObject({ kind: "round", roundId: "42", recorded: false });
    expect(rateLines(p.rate)).toEqual(rateLines(pickReceiptRate({ from: "USD", to: "GBP", round: ROUND, atSec: now, quote: gbp })));
  });
});

describe("a spend or top-up typed in your own money", () => {
  it("needs a fresh quote (the round can't turn pounds into dollars for it)", () => {
    expect(previewRate({ from: "USD", to: "GBP", nowSec: T + H, round: ROUND, quote: quoteAt(74_300_000n, T + 600), applied: true }).status).toBe("ok");
    expect(previewRate({ from: "USD", to: "GBP", nowSec: T + H, round: ROUND, quote: quoteAt(74_300_000n, T - 6 * H), applied: true }).status).toBe("stale");
    expect(previewRate({ from: "USD", to: "GBP", nowSec: T + H, round: ROUND, quote: null, applied: true }).status).toBe("stale");
    expect(previewRate({ from: "USD", to: "JPY", nowSec: T + H, round: ROUND, quote: null, applied: true }).status).toBe("missing");
  });
});
