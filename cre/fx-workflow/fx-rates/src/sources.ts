// Parsers for the keyless FX sources. Pure functions over the response body text, so they run the
// same inside the CRE WASM runtime, in node (scripts/gas-limit.mjs) and in the offline tests.

import { type Currency, CURRENCIES, SOURCE_CURRENCY_API, UINT64_MAX } from './constants.ts'
import { jsonNumberToDecimalString, usdPerUnitE8 } from './decimal.ts'

/** One source's view of the round: USD per 1 unit (8 decimals) for the currencies it quoted. */
export type SourceQuote = {
  /** The source's sourceMasks bit (1, 2 or 4). */
  bit: number
  name: string
  /** Newest reference date among the rates used, yyyymmdd. */
  date: number
  e8: Partial<Record<Currency, bigint>>
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** "2026-10-06" -> 20261006. Throws on anything that is not a plausible calendar date. */
export function isoDateToYyyymmdd(text: unknown): number {
  if (typeof text !== 'string') throw new Error('date must be a string')
  const m = ISO_DATE_RE.exec(text)
  if (!m) throw new Error(`not an ISO date: ${JSON.stringify(text)}`)
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (y < 1970 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > 31) throw new Error(`invalid date: ${text}`)
  return y * 10000 + mo * 100 + d
}

function toE8(rate: unknown): bigint {
  const e8 = usdPerUnitE8(jsonNumberToDecimalString(rate))
  if (e8 <= 0n || e8 > UINT64_MAX) throw new Error(`rate out of range: ${String(rate)}`)
  return e8
}

const isCurrency = (c: string): c is Currency => (CURRENCIES as readonly string[]).includes(c)

/** How many currencies a source quoted (iterates the fixed list: deterministic on every engine). */
export const quotedCount = (e8: Partial<Record<Currency, bigint>>): number => CURRENCIES.filter((c) => e8[c] !== undefined).length

/**
 * Frankfurter v2 `/v2/rates?base=USD&quotes=...` body: an array of
 * `{ "date": "2026-10-06", "base": "USD", "quote": "EUR", "rate": 0.88739 }`.
 * Only `wanted` currencies are taken; a currency quoted twice is dropped (ambiguous).
 */
export function parseFrankfurterV2(body: string, bit: number, name: string, wanted: readonly Currency[]): SourceQuote {
  const data: unknown = JSON.parse(body)
  if (!Array.isArray(data)) throw new Error(`${name}: expected a JSON array`)
  const e8: Partial<Record<Currency, bigint>> = {}
  const dates: Partial<Record<Currency, number>> = {}
  const seen = new Set<Currency>()
  const dup = new Set<Currency>()
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) continue
    const { base, quote, rate, date } = entry as Record<string, unknown>
    if (typeof quote !== 'string') continue
    const ccy = quote.toUpperCase()
    if (!isCurrency(ccy) || !wanted.includes(ccy)) continue
    if (base !== 'USD') throw new Error(`${name}: unexpected base ${String(base)}`)
    if (seen.has(ccy)) {
      dup.add(ccy)
      continue
    }
    seen.add(ccy)
    try {
      const value = toE8(rate)
      const day = isoDateToYyyymmdd(date)
      e8[ccy] = value
      dates[ccy] = day
    } catch {
      // one bad entry only removes that currency from this source
    }
  }
  for (const ccy of dup) {
    delete e8[ccy]
    delete dates[ccy]
  }
  const used = CURRENCIES.flatMap((c) => (dates[c] === undefined ? [] : [dates[c] as number]))
  if (used.length === 0) throw new Error(`${name}: no usable rates`)
  return { bit, name, date: Math.max(...used), e8 }
}

/**
 * fawazahmed0 currency-api `/v1/currencies/usd.json` body:
 * `{ "date": "2026-10-06", "usd": { "eur": 0.89167355, "gbp": 0.75677565, ... } }` (lowercase keys).
 */
export function parseCurrencyApi(body: string, wanted: readonly Currency[] = CURRENCIES, name = 'currency-api'): SourceQuote {
  const data: unknown = JSON.parse(body)
  if (typeof data !== 'object' || data === null) throw new Error(`${name}: expected a JSON object`)
  const { date, usd } = data as Record<string, unknown>
  const yyyymmdd = isoDateToYyyymmdd(date)
  if (typeof usd !== 'object' || usd === null) throw new Error(`${name}: missing "usd" object`)
  const table = usd as Record<string, unknown>
  const e8: Partial<Record<Currency, bigint>> = {}
  for (const ccy of wanted) {
    const raw = table[ccy.toLowerCase()]
    if (raw === undefined) continue
    try {
      e8[ccy] = toE8(raw)
    } catch {
      // skip this currency
    }
  }
  if (quotedCount(e8) === 0) throw new Error(`${name}: no usable rates`)
  return { bit: SOURCE_CURRENCY_API, name, date: yyyymmdd, e8 }
}
