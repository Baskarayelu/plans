// Per-node cross-source aggregation: median, outlier drop, source mask.

import { type Currency, CURRENCIES, MIN_SOURCES } from './constants.ts'
import { divRoundHalfUp } from './decimal.ts'
import type { SourceQuote } from './sources.ts'

/** Median of positive integers; for an even count, the mean of the two middle values rounded half up. */
export function medianBigint(values: readonly bigint[]): bigint {
  if (values.length === 0) throw new Error('median of nothing')
  const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const mid = s.length >> 1
  return s.length % 2 === 1 ? s[mid] : divRoundHalfUp(s[mid - 1] + s[mid], 2n)
}

export const popCount = (mask: number): number => {
  let n = 0
  for (let m = mask; m !== 0; m &= m - 1) n++
  return n
}

export type CurrencyRate = { rate: bigint; mask: number }

/**
 * One currency: take the median of the available sources, drop every source more than
 * `maxSpreadBps` away from that median, and if at least MIN_SOURCES (2) remain return the median of
 * the remaining ones with the OR of their bits; otherwise the currency is absent (rate 0, mask 0).
 *
 * With exactly two sources the median is their mean, so each sits half the gap away: two sources
 * are rejected when they differ by more than about 2 x maxSpreadBps.
 */
export function aggregateCurrency(quotes: readonly { bit: number; e8: bigint }[], maxSpreadBps: number): CurrencyRate {
  const avail = quotes.filter((q) => q.e8 > 0n)
  if (avail.length < MIN_SOURCES) return { rate: 0n, mask: 0 }
  const m = medianBigint(avail.map((q) => q.e8))
  const bps = BigInt(maxSpreadBps)
  const kept = avail.filter((q) => {
    const diff = q.e8 > m ? q.e8 - m : m - q.e8
    return diff * 10_000n <= m * bps
  })
  if (kept.length < MIN_SOURCES) return { rate: 0n, mask: 0 }
  const mask = kept.reduce((acc, q) => acc | q.bit, 0)
  // Two quotes carrying the same bit would not prove two sources.
  if (popCount(mask) < MIN_SOURCES) return { rate: 0n, mask: 0 }
  return { rate: medianBigint(kept.map((q) => q.e8)), mask }
}

export type RoundRates = {
  /** USD per 1 unit, 8 decimals, in CURRENCIES order; 0 = absent. */
  usdPerUnitE8: bigint[]
  /** Agreeing sources per currency; 0 for an absent currency. */
  sourceMasks: number[]
  /** Newest reference date (yyyymmdd) among the sources that contributed to a present rate; 0 if none. */
  rateDate: number
}

export function aggregateRound(sources: readonly SourceQuote[], maxSpreadBps: number): RoundRates {
  const usdPerUnitE8: bigint[] = []
  const sourceMasks: number[] = []
  let used = 0
  for (const ccy of CURRENCIES as readonly Currency[]) {
    const quotes = sources.flatMap((s) => (s.e8[ccy] === undefined ? [] : [{ bit: s.bit, e8: s.e8[ccy] as bigint }]))
    const { rate, mask } = aggregateCurrency(quotes, maxSpreadBps)
    usdPerUnitE8.push(rate)
    sourceMasks.push(mask)
    used |= mask
  }
  const dates = sources.filter((s) => (s.bit & used) !== 0).map((s) => s.date)
  return { usdPerUnitE8, sourceMasks, rateDate: dates.length ? Math.max(...dates) : 0 }
}
