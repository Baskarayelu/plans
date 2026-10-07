// The per-node work: fetch every source through an injected GET function (CRE's HTTPClient in the
// workflow, fetch in scripts/gas-limit.mjs, fixtures in tests), parse, and aggregate.
// At most 4 HTTP calls per execution (CRE quota: 15).

import { BLEND_CURRENCIES, ECB_CURRENCIES, SOURCE_FRANKFURTER_BLEND, SOURCE_FRANKFURTER_ECB } from './constants.ts'
import { aggregateRound, type RoundRates } from './aggregate.ts'
import type { SourceUrls } from './config.ts'
import { parseCurrencyApi, parseFrankfurterV2, quotedCount, type SourceQuote } from './sources.ts'

/** Returns the body text of a 200 response; throws otherwise. */
export type HttpGet = (url: string) => string

export function collectSources(get: HttpGet, urls: SourceUrls, log: (msg: string) => void = () => {}): SourceQuote[] {
  const sources: SourceQuote[] = []
  const attempt = (label: string, fn: () => SourceQuote): boolean => {
    try {
      const q = fn()
      sources.push(q)
      log(`source ${label}: ${quotedCount(q.e8)} rates, date ${q.date}`)
      return true
    } catch (e) {
      log(`source ${label} unavailable: ${e instanceof Error ? e.message : String(e)}`)
      return false
    }
  }
  attempt('frankfurter-ecb', () => parseFrankfurterV2(get(urls.frankfurterEcb), SOURCE_FRANKFURTER_ECB, 'frankfurter-ecb', ECB_CURRENCIES))
  attempt('frankfurter-blend', () =>
    parseFrankfurterV2(get(urls.frankfurterBlend), SOURCE_FRANKFURTER_BLEND, 'frankfurter-blend', BLEND_CURRENCIES),
  )
  if (!attempt('currency-api', () => parseCurrencyApi(get(urls.currencyApi)))) {
    attempt('currency-api (fallback)', () => parseCurrencyApi(get(urls.currencyApiFallback)))
  }
  return sources
}

export function computeRound(get: HttpGet, urls: SourceUrls, maxSpreadBps: number, log?: (msg: string) => void): RoundRates {
  const sources = collectSources(get, urls, log)
  if (sources.length === 0) throw new Error('no FX source reachable')
  return aggregateRound(sources, maxSpreadBps)
}
