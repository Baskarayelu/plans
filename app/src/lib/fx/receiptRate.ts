/**
 * Which exchange rate a receipt shows, and how it reads. Pure (no React, no network), so it is unit
 * tested on its own.
 *
 * A receipt's rate comes from the first of these that exists, and is never made up:
 *   1. the reference round recorded with the money (a send's `fxRoundId`, a settle-up's `Settled`
 *      round): "Chainlink-fed reference rate, round N, <time>";
 *   2. otherwise, the reference round that was in effect when the money moved (scheduled at most
 *      6 hours earlier, like the contracts' own limit), for receipts that don't record one (spends);
 *   3. otherwise, the rate Plans quoted (the relayer's signed ECB quote): the applied rate a send
 *      carries, or the quote used to show the other currency;
 *   4. otherwise "No reference rate recorded", and amounts stay in dollars.
 *
 * Rates are 1e8 fixed point, `to` per 1 `from` (a round's own rates are USD per 1 unit). AUSD is USD.
 */
import { formatFixed, formatRate, invertRateE8, usdToLocalE8 } from "../domain/currency";

export const E8 = 100_000_000n;
/** PlansSend.MAX_FX_AGE / Pot's fresh-round window: a round speaks for 6 h after its scheduled time. */
export const MAX_ROUND_AGE_SEC = 6 * 3600;
/** FxReference.MAX_FUTURE_SKEW: a round may be scheduled up to 5 min after the block that wrote it. */
const FUTURE_SKEW_SEC = 5 * 60;

/** One reference round: USD per 1 unit by ISO code (8 decimals; USD itself is implied). */
export type RoundLike = {
  roundId: string | bigint;
  /** unix seconds; 0 when unknown */
  scheduledTime: number;
  usdPerUnitE8: Record<string, bigint>;
  /** the round's own public record, when known */
  txHash?: string;
};

/** A rate quoted by Plans: `to` per 1 `from`, when it was fetched, and where it came from. */
export type QuoteLike = { rateE8: bigint; timestamp: number; source?: string };

export type ReceiptRate =
  | { kind: "same"; from: string; to: string }
  | {
      kind: "round";
      from: string;
      to: string;
      roundId: string;
      /** the round's rate for this pair; undefined while the round's numbers aren't known */
      rateE8?: bigint;
      /** the round's scheduled time (unix seconds) */
      at?: number;
      /** the rate the money was shown at, when it differs in kind from the reference (sends) */
      appliedE8?: bigint;
      /** (applied − reference) · 10000 / reference, truncated toward zero */
      diffBps?: bigint;
      txHash?: string;
      /** recorded with the money (vs. looked up for the time it moved) */
      recorded: boolean;
    }
  | { kind: "quote"; from: string; to: string; rateE8: bigint; at: number; source?: string }
  | { kind: "none"; from: string; to: string };

type Num = string | bigint | number | null | undefined;
const big = (v: Num): bigint => {
  if (v === null || v === undefined || v === "") return 0n;
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
};
export const normCurrency = (c: string | null | undefined) => {
  const u = (c ?? "").toUpperCase();
  return !u || u === "AUSD" ? "USD" : u;
};

/** USD per 1 unit of `cur` in a round (USD = 1e8); undefined when the round doesn't carry it. */
export function usdPer(round: Pick<RoundLike, "usdPerUnitE8">, cur: string): bigint | undefined {
  const c = normCurrency(cur);
  if (c === "USD") return E8;
  const v = round.usdPerUnitE8[c];
  return v && v > 0n ? v : undefined;
}

/** `to` per 1 `from` from a round, floored, exactly as PlansSend records it. null when a side is missing. */
export function roundRateE8(round: Pick<RoundLike, "usdPerUnitE8">, from: string, to: string): bigint | null {
  const f = usdPer(round, from);
  const t = usdPer(round, to);
  if (!f || !t) return null;
  const v = (f * E8) / t;
  return v > 0n ? v : null;
}

/** True when `round` was the reference in effect at `atSec` (scheduled no more than 6 h before it). */
export function roundCoversTime(round: Pick<RoundLike, "scheduledTime">, atSec: number): boolean {
  const t = round.scheduledTime;
  return t > 0 && atSec >= t - FUTURE_SKEW_SEC && atSec - t <= MAX_ROUND_AGE_SEC;
}

/** (applied − reference) · 10000 / reference, truncated toward zero (Solidity int division). */
export function diffBpsOf(appliedE8: bigint, refE8: bigint): bigint {
  if (refE8 <= 0n) return 0n;
  return ((appliedE8 - refE8) * 10_000n) / refE8;
}

export type PickInput = {
  from: string;
  to: string;
  /** what the money itself recorded */
  recorded?: {
    roundId?: Num;
    refRateE8?: Num;
    diffBps?: Num;
    /** the applied rate a send signed (`to` per 1 `from`) and when it was quoted */
    appliedE8?: Num;
    appliedAt?: number;
    appliedSource?: string;
  };
  /** the recorded round's numbers, or the latest round known at `atSec` */
  round?: RoundLike | null;
  /** when the money moved (unix seconds): an unrecorded round only counts if it covers this time */
  atSec?: number;
  /** Plans' quote for the pair (`to` per 1 `from`), used when nothing better exists */
  quote?: QuoteLike | null;
};

/** The rate a receipt shows (see the order at the top of this file). */
export function pickReceiptRate(i: PickInput): ReceiptRate {
  const from = normCurrency(i.from);
  const to = normCurrency(i.to);
  if (from === to) return { kind: "same", from, to };
  const rec = i.recorded ?? {};
  const applied = big(rec.appliedE8);
  const recId = big(rec.roundId);
  if (recId > 0n) {
    const r = i.round && big(i.round.roundId) === recId ? i.round : null;
    const recRef = big(rec.refRateE8);
    const ref = recRef > 0n ? recRef : r ? roundRateE8(r, from, to) : null;
    const diff = applied > 0n && ref ? (recRef > 0n && rec.diffBps !== undefined && rec.diffBps !== null ? big(rec.diffBps) : diffBpsOf(applied, ref)) : undefined;
    return {
      kind: "round",
      from,
      to,
      roundId: recId.toString(),
      rateE8: ref ?? undefined,
      at: r && r.scheduledTime > 0 ? r.scheduledTime : undefined,
      appliedE8: applied > 0n ? applied : undefined,
      diffBps: diff,
      txHash: r?.txHash,
      recorded: true,
    };
  }
  // A send that recorded no round carries the rate Plans quoted to the sender: that is its rate.
  if (applied > 0n) return { kind: "quote", from, to, rateE8: applied, at: rec.appliedAt ?? 0, source: rec.appliedSource ?? i.quote?.source };
  if (i.round && (i.atSec === undefined || roundCoversTime(i.round, i.atSec))) {
    const ref = roundRateE8(i.round, from, to);
    if (ref) return { kind: "round", from, to, roundId: big(i.round.roundId).toString(), rateE8: ref, at: i.round.scheduledTime || undefined, txHash: i.round.txHash, recorded: false };
  }
  if (i.quote && i.quote.rateE8 > 0n) return { kind: "quote", from, to, rateE8: i.quote.rateE8, at: i.quote.timestamp, source: i.quote.source };
  return { kind: "none", from, to };
}

// ─────────────── amounts ───────────────

/** Dollars (AUSD units) in `r.to` at the receipt's rate, when `r` is a USD → local rate. null when unknown. */
export function usdToLocalAt(units: bigint, r: ReceiptRate): bigint | null {
  if (r.kind === "same") return r.from === "USD" ? units * 100n : null;
  if (r.from !== "USD" || r.kind === "none" || !r.rateE8) return null;
  return usdToLocalE8(units, r.rateE8);
}

/** "£38.86" for dollars at the receipt's rate; undefined when there is no rate (show dollars instead). */
export function formatLocalAt(units: bigint, r: ReceiptRate, opts: { sign?: boolean } = {}): string | undefined {
  const e8 = usdToLocalAt(units, r);
  return e8 === null ? undefined : formatFixed(e8, 8, r.to, opts);
}

// ─────────────── words ───────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n: number) => String(n).padStart(2, "0");

/** "8 Oct 14:05 UTC" (UTC, so it reads the same for everyone on the receipt). */
export function utcStamp(sec: number): string {
  const d = new Date(sec * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} UTC`;
}

/** "14:05:02 UTC". */
export function utcClockSec(sec: number): string {
  const d = new Date(sec * 1000);
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} UTC`;
}

/** "ECB" from "ECB reference rates via frankfurter.app"; "" when unknown. */
export function quoteSourceName(source?: string): string {
  if (!source) return "";
  if (/\bECB\b/i.test(source)) return "ECB";
  return "";
}

/**
 * Pair text with the stronger currency first, so it reads like a bank's board: "1 GBP = 1.3472 USD"
 * whichever way the money went. `rates` are `to` per 1 `from`; the first decides the direction and
 * every rate is turned the same way, so applied and reference can be compared side by side.
 */
export function pairTexts(from: string, to: string, rates: bigint[]): string[] {
  const lead = rates.find((r) => r > 0n);
  const flip = lead !== undefined && lead < E8;
  return rates.map((r) => (r <= 0n ? "—" : flip ? formatRate(to, from, invertRateE8(r)) : formatRate(from, to, r)));
}
export const pairText = (from: string, to: string, rateE8: bigint) => pairTexts(from, to, [rateE8])[0];

/** "0.00%", "+0.12%", "−1.05%" from basis points. */
export function diffText(bps: bigint): string {
  const neg = bps < 0n;
  const a = neg ? -bps : bps;
  const s = `${a / 100n}.${p2(Number(a % 100n))}%`;
  return a === 0n ? s : `${neg ? "−" : "+"}${s}`;
}

/** Where the rate came from, in one line. */
export function sourceText(r: ReceiptRate): string {
  switch (r.kind) {
    case "round":
      return `Chainlink-fed reference rate, round ${r.roundId}${r.at ? `, ${utcStamp(r.at)}` : ""}`;
    case "quote": {
      const name = quoteSourceName(r.source);
      return `${name ? `${name} reference rate` : "Reference rate"} quoted by Plans${r.at ? `, ${utcStamp(r.at)}` : ""}`;
    }
    case "none":
      return "No reference rate recorded";
    case "same":
      return "Same currency, no exchange";
  }
}

/** The rate in one line: "1 GBP = 1.3472 USD", or the honest words when there isn't one. */
export function rateText(r: ReceiptRate): string {
  if (r.kind === "same" || r.kind === "none") return sourceText(r);
  if (!r.rateE8) return r.kind === "round" && r.appliedE8 ? pairText(r.from, r.to, r.appliedE8) : "Reference rate loading";
  return pairText(r.from, r.to, r.rateE8);
}

/** "1 GBP = 1.3472 USD · Chainlink-fed reference rate, round 42, 8 Oct 13:15 UTC" for share text and cards. */
export function shareRateLine(r: ReceiptRate): string {
  if (r.kind === "same" || r.kind === "none") return sourceText(r);
  return r.rateE8 ? `${pairText(r.from, r.to, r.rateE8)} · ${sourceText(r)}` : sourceText(r);
}

/**
 * The receipt lines for one pair (label, value), in the stub's mono style:
 *   send with a round:  Applied · Reference · Source · Difference
 *   anything else:      Rate · Source            (or one Rate line saying there is none)
 */
export function rateLines(r: ReceiptRate): [string, string][] {
  if (r.kind === "same" || r.kind === "none") return [["Rate", sourceText(r)]];
  if (r.kind === "round" && r.appliedE8) {
    const [applied, ref] = pairTexts(r.from, r.to, [r.appliedE8, r.rateE8 ?? 0n]);
    const out: [string, string][] = [["Applied", applied], ["Reference", r.rateE8 ? ref : "Loading"], ["Source", sourceText(r)]];
    if (r.diffBps !== undefined) out.push(["Difference", diffText(r.diffBps)]);
    return out;
  }
  if (r.kind === "round" && !r.rateE8) return [["Source", sourceText(r)]];
  return [
    ["Rate", rateText(r)],
    ["Source", sourceText(r)],
  ];
}

/**
 * Lines for several currencies on one receipt (a settle-up): one rate line per currency, then the
 * source once when every currency shares it, else one source line per currency.
 */
export function groupedRateLines(rates: ReceiptRate[]): [string, string][] {
  const shown = rates.filter((r) => r.kind !== "same");
  if (shown.length === 0) return rates.length ? [["Rate", "All in dollars, no exchange"]] : [];
  if (shown.length === 1) return rateLines(shown[0]);
  const local = (r: ReceiptRate) => (r.from === "USD" ? r.to : r.from);
  const out: [string, string][] = shown.filter((r) => r.kind !== "none" && !(r.kind === "round" && !r.rateE8)).map((r) => [local(r), rateText(r)]);
  const sources = Array.from(new Set(shown.map(sourceText)));
  if (sources.length === 1) out.push(["Source", sources[0]]);
  else for (const r of shown) out.push([`Source · ${local(r)}`, sourceText(r)]);
  return out;
}

// ─────────────── rounds from each place they can be read ───────────────

const ROUND_CURRENCIES = ["GBP", "EUR", "INR", "NGN", "JPY", "CHF", "AED", "SGD"] as const;

/** An indexer FxRound row (rate<CUR> fields, USD per unit; "0" = absent). */
export function roundFromRow(row: { roundId: string; scheduledTime: string | number; txHash?: string } & Partial<Record<`rate${(typeof ROUND_CURRENCIES)[number]}`, string>>): RoundLike {
  const usdPerUnitE8: Record<string, bigint> = {};
  for (const c of ROUND_CURRENCIES) {
    const v = big(row[`rate${c}`]);
    if (v > 0n) usdPerUnitE8[c] = v;
  }
  return { roundId: String(row.roundId), scheduledTime: Number(row.scheduledTime) || 0, usdPerUnitE8, txHash: row.txHash };
}

/** The relayer's GET /v1/fx/round body, or a round read from FxReference (`usdPerUnitE8` by code). */
export function roundFromMap(r: { roundId: string | bigint; scheduledTime: number; usdPerUnitE8: Record<string, string | bigint> }): RoundLike {
  const usdPerUnitE8: Record<string, bigint> = {};
  for (const [c, v] of Object.entries(r.usdPerUnitE8)) {
    const b = big(v);
    if (b > 0n) usdPerUnitE8[c.toUpperCase()] = b;
  }
  return { roundId: String(r.roundId), scheduledTime: Number(r.scheduledTime) || 0, usdPerUnitE8 };
}

/**
 * Whether a send made now may name `round`: it must carry both currencies and still be inside
 * PlansSend's 6-hour window with `marginSec` to spare (so it can't go stale between signing and
 * landing, which would turn the send down).
 */
export function roundQuotable(round: RoundLike | null | undefined, from: string, to: string, nowSec: number, marginSec = CONFIRM_MARGIN_SEC): boolean {
  if (!round || big(round.roundId) <= 0n || normCurrency(from) === normCurrency(to)) return false;
  if (!rateFreshAt(round.scheduledTime, nowSec, marginSec)) return false;
  return roundRateE8(round, from, to) !== null;
}

// ─────────────── before confirming ───────────────

/**
 * Half an hour short of the 6-hour limit. A send names a round only with this much to spare, and a
 * confirm leans on any rate (round or quote) with the same margin, so nothing can go out of date
 * between pressing the button and the money landing.
 */
export const CONFIRM_MARGIN_SEC = 30 * 60;

/** True when a rate published (round) or fetched (quote) at `atSec` may still be confirmed against at `nowSec`. */
export function rateFreshAt(atSec: number | undefined | null, nowSec: number, marginSec = CONFIRM_MARGIN_SEC): boolean {
  if (!atSec || !(atSec > 0)) return false;
  return nowSec >= atSec - FUTURE_SKEW_SEC && nowSec - atSec <= MAX_ROUND_AGE_SEC - marginSec;
}

/** ok: a fresh rate; stale: only an out-of-date one; missing: none at all. */
export type PreviewStatus = "ok" | "stale" | "missing";

export type PreviewInput = {
  from: string;
  to: string;
  nowSec: number;
  /** the latest reference round (what a send or a settle-up would name) */
  round?: RoundLike | null;
  /** Plans' quote for the pair (`to` per 1 `from`) */
  quote?: QuoteLike | null;
  /**
   * A send: the quote is the rate applied to the money, so it must be fresh; the round, when it
   * can be named, is the reference it is checked against.
   */
  applied?: boolean;
  /** The money records the round it used (a settle-up's `Settled`), rather than it being looked up for the time (leave, spends). */
  records?: boolean;
};

const hasPair = (round: RoundLike | null | undefined, from: string, to: string) => !!round && roundRateE8(round, from, to) !== null;

/**
 * The rate a receipt will show for money about to move, chosen exactly as the finished receipt
 * chooses it (pickReceiptRate), and whether it is fresh enough to confirm against (6 h less the
 * half-hour margin). A preview never shows an out-of-date rate: stale or missing gives kind "none".
 */
export function previewRate(i: PreviewInput): { rate: ReceiptRate; status: PreviewStatus } {
  const from = normCurrency(i.from);
  const to = normCurrency(i.to);
  if (from === to) return { rate: { kind: "same", from, to }, status: "ok" };
  const round = i.round ?? null;
  const roundOk = roundQuotable(round, from, to, i.nowSec);
  const q = i.quote && i.quote.rateE8 > 0n ? i.quote : null;
  const quoteOk = !!q && rateFreshAt(q.timestamp, i.nowSec);
  const out = (status: PreviewStatus) => ({ rate: { kind: "none", from, to } as ReceiptRate, status });
  const notOk = () => out(q || hasPair(round, from, to) ? "stale" : "missing");
  if (i.applied) {
    if (!quoteOk || !q) return notOk();
    const rate = pickReceiptRate({
      from,
      to,
      recorded: { roundId: roundOk && round ? round.roundId : undefined, appliedE8: q.rateE8, appliedAt: q.timestamp, appliedSource: q.source },
      round: roundOk ? round : null,
    });
    return { rate, status: "ok" };
  }
  if (roundOk && round) {
    const rate = pickReceiptRate({ from, to, recorded: i.records ? { roundId: round.roundId } : undefined, round, atSec: i.nowSec, quote: q });
    return { rate, status: "ok" };
  }
  if (quoteOk && q) return { rate: pickReceiptRate({ from, to, quote: q }), status: "ok" };
  return notOk();
}

/** What a confirm button may do: go ahead, wait for rates still loading, or stay blocked. */
export type RateGate = "ok" | "loading" | "stale" | "missing";

export function rateGate(statuses: PreviewStatus[], loading: boolean): RateGate {
  if (statuses.every((s) => s === "ok")) return "ok";
  if (loading) return "loading";
  return statuses.includes("stale") ? "stale" : "missing";
}

/**
 * A send about to go: the rate its receipt will show (the applied quote, with the round it names
 * when one is fresh) and whether every rate the confirm screen uses is fresh: the pair quote that
 * is applied, and the dollar quotes that turn the typed amount into dollars and their money.
 */
export function sendPreview(i: {
  from: string;
  to: string;
  nowSec: number;
  round?: RoundLike | null;
  /** `to` per 1 `from`: the rate the send applies */
  pair?: QuoteLike | null;
  /** USD → `from` and USD → `to` (the amounts on screen) */
  usdFrom?: QuoteLike | null;
  usdTo?: QuoteLike | null;
  loading?: boolean;
}): { rate: ReceiptRate; gate: RateGate } {
  const main = previewRate({ from: i.from, to: i.to, nowSec: i.nowSec, round: i.round, quote: i.pair, applied: true });
  const legs = [
    previewRate({ from: "USD", to: i.from, nowSec: i.nowSec, quote: i.usdFrom, applied: true }).status,
    previewRate({ from: "USD", to: i.to, nowSec: i.nowSec, quote: i.usdTo, applied: true }).status,
  ];
  return { rate: main.rate, gate: rateGate([main.status, ...legs], !!i.loading) };
}
