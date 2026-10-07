import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SOURCE_URLS } from '../fx-rates/src/constants.ts'
import type { HttpGet } from '../fx-rates/src/collect.ts'

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
export const fixture = (name: string): string => readFileSync(path.join(FIXTURES, name), 'utf8')

export type Vector = {
  chainSelector: string
  scheduledTime: string
  rateDate: number
  currencies: string[]
  currenciesBytes3: string[]
  usdPerUnitE8: string[]
  sourceMasks: number[]
  encoded: `0x${string}`
}
export const vector = (): Vector => JSON.parse(fixture('report-vector.json'))

/**
 * A fake CRE HTTP GET over fixture bodies (no network). Records every URL requested. A body of
 * `null` simulates a failed request (non-200 / timeout).
 */
export function fakeGet(bodies: Partial<Record<keyof typeof DEFAULT_SOURCE_URLS, string | null>>): HttpGet & { calls: string[] } {
  const byUrl = new Map<string, string | null>()
  for (const [k, v] of Object.entries(bodies)) byUrl.set(DEFAULT_SOURCE_URLS[k as keyof typeof DEFAULT_SOURCE_URLS], v ?? null)
  const calls: string[] = []
  const get = ((url: string) => {
    calls.push(url)
    const body = byUrl.get(url)
    if (body === undefined || body === null) throw new Error(`HTTP 503 from ${url}`)
    return body
  }) as HttpGet & { calls: string[] }
  get.calls = calls
  return get
}
