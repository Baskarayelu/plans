import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectSources, computeRound } from '../fx-rates/src/collect.ts'
import { GAS_LIMIT_HINT, parseConfig } from '../fx-rates/src/config.ts'
import { DEFAULT_MAX_SPREAD_BPS, DEFAULT_SOURCE_URLS } from '../fx-rates/src/constants.ts'
import type { RoundRates } from '../fx-rates/src/aggregate.ts'
import { applyOnchainGuards, type OnchainState } from '../fx-rates/src/guards.ts'
import { observationToRound, roundToObservation, scheduledTimeSeconds } from '../fx-rates/src/observation.ts'
import { fakeGet, FIXTURES, fixture } from './helpers.ts'

const ALL = {
  frankfurterEcb: fixture('http-frankfurter-ecb.json'),
  frankfurterBlend: fixture('http-frankfurter-blend.json'),
  currencyApi: fixture('http-currency-api.json'),
}

describe('collectSources (node mode, fixture HTTP)', () => {
  it('uses 3 GETs when every source answers; all 8 currencies present', () => {
    const get = fakeGet(ALL)
    const round = computeRound(get, DEFAULT_SOURCE_URLS, DEFAULT_MAX_SPREAD_BPS)
    expect(get.calls).toEqual([DEFAULT_SOURCE_URLS.frankfurterEcb, DEFAULT_SOURCE_URLS.frankfurterBlend, DEFAULT_SOURCE_URLS.currencyApi])
    expect(round.usdPerUnitE8.every((x) => x > 0n)).toBe(true)
    expect(round.sourceMasks).toEqual([3, 3, 3, 6, 3, 3, 6, 3])
    expect(round.rateDate).toBe(20261007)
  })
  it('falls back to pages.dev when jsDelivr fails (4 GETs, the most it ever makes)', () => {
    const get = fakeGet({ ...ALL, currencyApi: null, currencyApiFallback: fixture('http-currency-api.json') })
    const sources = collectSources(get, DEFAULT_SOURCE_URLS)
    expect(get.calls).toHaveLength(4)
    expect(sources.map((s) => s.bit)).toEqual([1, 4, 2])
  })
  it('without currency-api no currency has 2 sources: every rate absent', () => {
    const logs: string[] = []
    const get = fakeGet({ ...ALL, currencyApi: null, currencyApiFallback: null })
    const round = computeRound(get, DEFAULT_SOURCE_URLS, DEFAULT_MAX_SPREAD_BPS, (m) => logs.push(m))
    expect(round.usdPerUnitE8.every((x) => x === 0n)).toBe(true)
    expect(logs.some((l) => l.includes('currency-api (fallback) unavailable'))).toBe(true)
  })
  it('a failed ECB source leaves only the blend currencies', () => {
    const round = computeRound(fakeGet({ ...ALL, frankfurterEcb: '{"message":"rate limited"}' }), DEFAULT_SOURCE_URLS, DEFAULT_MAX_SPREAD_BPS)
    expect(round.sourceMasks).toEqual([0, 0, 0, 6, 0, 0, 6, 0])
  })
  it('throws when no source is reachable (the node reports an error to consensus)', () => {
    expect(() => computeRound(fakeGet({}), DEFAULT_SOURCE_URLS, DEFAULT_MAX_SPREAD_BPS)).toThrow(/no FX source/)
  })
  it('never requests open.er-api.com', () => {
    expect(Object.values(DEFAULT_SOURCE_URLS).some((u) => u.includes('er-api'))).toBe(false)
  })
})

describe('observation <-> round (consensus fields)', () => {
  it('round-trips', () => {
    const round = computeRound(fakeGet(ALL), DEFAULT_SOURCE_URLS, DEFAULT_MAX_SPREAD_BPS)
    expect(observationToRound(roundToObservation(round))).toEqual(round)
  })
  it('accepts numbers / Int64-like values from the consensus unwrap', () => {
    const o: Record<string, unknown> = { rateDate: 20261007 }
    for (let i = 0; i < 8; i++) {
      o[`r${i}`] = { value: 100n + BigInt(i) }
      o[`m${i}`] = 3
    }
    const r = observationToRound(o)
    expect(r.usdPerUnitE8[7]).toBe(107n)
    expect(r.sourceMasks[0]).toBe(3)
  })
  it('reconciles a median rate with a quorum mask that cannot back it', () => {
    const round = computeRound(fakeGet(ALL), DEFAULT_SOURCE_URLS, DEFAULT_MAX_SPREAD_BPS)
    const o = roundToObservation(round)
    o.m0 = 1n // one source only
    o.r1 = 0n // median 0 with a 2-bit mask
    o.m2 = 8n | 3n // unknown bit
    const r = observationToRound(o as unknown as Record<string, unknown>)
    expect(r.usdPerUnitE8.slice(0, 3)).toEqual([0n, 0n, 0n])
    expect(r.sourceMasks.slice(0, 3)).toEqual([0, 0, 0])
  })
})

describe('scheduledTime', () => {
  it('comes from the cron payload when the trigger fired at or after its slot (deployed DON)', () => {
    expect(scheduledTimeSeconds(1791363600n, () => new Date(1791363600_000))).toEqual({ seconds: 1791363600n, source: 'trigger' })
    expect(scheduledTimeSeconds(1791363600n, () => new Date(1791363603_500))).toEqual({ seconds: 1791363600n, source: 'trigger' })
  })
  it('is capped at DON time when the payload is in the future (cre workflow simulate sends the NEXT run)', () => {
    expect(scheduledTimeSeconds(1791365400n, () => new Date(1791364000_250))).toEqual({ seconds: 1791364000n, source: 'don-time' })
  })
  it('falls back to DON time when the payload has none', () => {
    expect(scheduledTimeSeconds(undefined, () => new Date(1791363600_999))).toEqual({ seconds: 1791363600n, source: 'don-time' })
    expect(scheduledTimeSeconds(0n, () => new Date(1791363600_000))).toEqual({ seconds: 1791363600n, source: 'don-time' })
  })
})

describe('applyOnchainGuards', () => {
  const round = (): RoundRates => ({
    usdPerUnitE8: [132451447n, 112419346n, 1037086n, 0n, 632508n, 120318027n, 27229408n, 78229548n],
    sourceMasks: [3, 3, 3, 0, 3, 3, 6, 3],
    rateDate: 20261007,
  })
  const state = (over: Partial<OnchainState> = {}): OnchainState => ({
    lastScheduledTime: 1791363600n,
    maxMoveBps: 1000,
    lastRates: [132451447n, 112419346n, 1037086n, 75000n, 632508n, 120318027n, 27229408n, 78229548n],
    ...over,
  })
  it('passes a round within the move limit unchanged', () => {
    const g = applyOnchainGuards(round(), 1791365400n, state())
    expect(g.round).toEqual(round())
    expect(g.dropped).toEqual([])
  })
  it('first round (no previous rates) is never limited', () => {
    expect(applyOnchainGuards(round(), 1n, state({ lastScheduledTime: 0n, lastRates: Array(8).fill(0n) })).dropped).toEqual([])
  })
  it('drops only the currency that moved more than maxMoveBps (FxReference would revert the whole round)', () => {
    const last = [...state().lastRates]
    last[0] = 120_000_000n // GBP now +10.4 %
    last[1] = 102_200_000n // EUR now +9.99 %: allowed
    const g = applyOnchainGuards(round(), 1791365400n, state({ lastRates: last }))
    expect(g.round.usdPerUnitE8[0]).toBe(0n)
    expect(g.round.sourceMasks[0]).toBe(0)
    expect(g.round.usdPerUnitE8[1]).toBe(112419346n)
    expect(g.dropped).toHaveLength(1)
    expect(g.dropped[0]).toMatch(/^GBP/)
  })
  it('refuses a replay and a round with nothing left', () => {
    expect(() => applyOnchainGuards(round(), 1791363600n, state())).toThrow(/not after/)
    const r = round()
    const only = { ...r, usdPerUnitE8: r.usdPerUnitE8.map((x, i) => (i === 0 ? x : 0n)), sourceMasks: r.sourceMasks.map((m, i) => (i === 0 ? m : 0)) }
    const last = [...state().lastRates]
    last[0] = 1n
    expect(() => applyOnchainGuards(only, 1791365400n, state({ lastRates: last }))).toThrow(/no currency/)
  })
})

describe('parseConfig', () => {
  const good = {
    schedule: '0 */30 * * * *',
    chainName: 'monad-testnet',
    chainSelector: '2183018362218727504',
    receiverAddress: '0x1111111111111111111111111111111111111111',
    gasLimit: '300000',
  }
  it('accepts a complete config and applies defaults', () => {
    const c = parseConfig(good)
    expect(c.chainSelector).toBe(2183018362218727504n)
    expect(c.maxSpreadBps).toBe(200)
    expect(c.urls).toEqual(DEFAULT_SOURCE_URLS)
  })
  it('refuses to run without a gasLimit from Monad\'s estimator', () => {
    expect(() => parseConfig({ ...good, gasLimit: '' })).toThrow(GAS_LIMIT_HINT)
    const { gasLimit: _, ...noGas } = good
    expect(() => parseConfig(noGas)).toThrow(/gas-limit\.mjs/)
  })
  it('refuses malformed gas limits and limits above the CRE quota', () => {
    for (const g of ['abc', '0', '-5', '1e6', 300000, '21000', '10000001']) {
      expect(() => parseConfig({ ...good, gasLimit: g }), String(g)).toThrow()
    }
  })
  it('refuses a missing receiver, a wrong selector, an unknown chain, er-api sources', () => {
    expect(() => parseConfig({ ...good, receiverAddress: '' })).toThrow(/receiverAddress/)
    expect(() => parseConfig({ ...good, receiverAddress: '0x0000000000000000000000000000000000000000' })).toThrow(/receiverAddress/)
    expect(() => parseConfig({ ...good, chainSelector: '8481857512324358265' })).toThrow(/selector/)
    expect(() => parseConfig({ ...good, chainName: 'ethereum-mainnet' })).toThrow(/chainName/)
    expect(() => parseConfig({ ...good, sources: { currencyApi: 'https://open.er-api.com/v6/latest/USD' } })).toThrow(/redistribution/)
    expect(() => parseConfig({ ...good, sources: { currencyApi: 'http://example.com' } })).toThrow(/https/)
  })
  it('shipped configs: 30-minute cron; gasLimit empty unless written by scripts/gas-limit.mjs', () => {
    for (const f of ['config.staging.json', 'config.production.json']) {
      const cfg = JSON.parse(readFileSync(path.join(FIXTURES, '..', '..', 'fx-rates', f), 'utf8'))
      expect(cfg.gasLimit === '' || cfg.gasLimit === undefined || /^[1-9]\d*$/.test(cfg.gasLimit)).toBe(true)
      expect(cfg.schedule).toBe('0 */30 * * * *')
    }
  })
})
