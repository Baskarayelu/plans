import { describe, expect, it } from 'vitest'
import { computeRound } from '../fx-rates/src/collect.ts'
import { CURRENCIES, DEFAULT_MAX_SPREAD_BPS, DEFAULT_SOURCE_URLS } from '../fx-rates/src/constants.ts'
import { currencyToBytes3, decodeReport, encodeReport, type FxReport, validateReport } from '../fx-rates/src/report.ts'
import { fakeGet, fixture, vector } from './helpers.ts'

const fromVector = (): FxReport => {
  const v = vector()
  return {
    chainSelector: BigInt(v.chainSelector),
    scheduledTime: BigInt(v.scheduledTime),
    rateDate: v.rateDate,
    currencies: v.currencies,
    usdPerUnitE8: v.usdPerUnitE8.map(BigInt),
    sourceMasks: v.sourceMasks,
  }
}

describe('golden vector (test/fixtures/report-vector.json)', () => {
  it('the workflow encoder produces exactly the vector bytes', () => {
    expect(encodeReport(fromVector())).toBe(vector().encoded)
  })

  it('the vector has an absent currency', () => {
    const v = vector()
    const i = v.usdPerUnitE8.indexOf('0')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(v.sourceMasks[i]).toBe(0)
  })

  it('the vector inputs are what the workflow computes from the fixture HTTP bodies', () => {
    const get = fakeGet({
      frankfurterEcb: fixture('http-frankfurter-ecb.json'),
      frankfurterBlend: fixture('http-frankfurter-blend.json'),
      currencyApi: fixture('http-currency-api-ngn-outlier.json'),
    })
    const round = computeRound(get, DEFAULT_SOURCE_URLS, DEFAULT_MAX_SPREAD_BPS)
    const v = vector()
    expect(round.usdPerUnitE8.map(String)).toEqual(v.usdPerUnitE8)
    expect(round.sourceMasks).toEqual(v.sourceMasks)
    expect(round.rateDate).toBe(v.rateDate)
    expect(get.calls).toHaveLength(3)
  })

  it('decodes back to the inputs', () => {
    const d = decodeReport(vector().encoded)
    expect(d).toEqual(fromVector())
  })

  it('bytes3 currency codes match the vector', () => {
    expect(CURRENCIES.map(currencyToBytes3)).toEqual(vector().currenciesBytes3)
  })
})

describe('validateReport mirrors FxReference payload rules', () => {
  const base = fromVector
  const withRates = (rates: readonly bigint[], masks: readonly number[]): FxReport => ({ ...base(), usdPerUnitE8: rates, sourceMasks: masks })

  it('accepts the vector', () => {
    expect(() => validateReport(base())).not.toThrow()
  })
  it('absent rate must have mask 0 (MissingSources)', () => {
    const r = base()
    expect(() => validateReport(withRates([...r.usdPerUnitE8], r.sourceMasks.map((m, i) => (i === 3 ? 2 : m))))).toThrow(/absent/)
  })
  it('present rate needs >= 2 known bits', () => {
    const r = base()
    expect(() => validateReport(withRates([...r.usdPerUnitE8], r.sourceMasks.map((m, i) => (i === 0 ? 1 : m))))).toThrow(/2 known/)
    expect(() => validateReport(withRates([...r.usdPerUnitE8], r.sourceMasks.map((m, i) => (i === 0 ? 9 : m))))).toThrow(/2 known/)
  })
  it('at least one present rate (EmptyReport)', () => {
    expect(() => validateReport(withRates(Array(8).fill(0n), Array(8).fill(0)))).toThrow(/empty/)
  })
  it('exact currency order and length (CurrencyMismatch / InvalidLength)', () => {
    expect(() => validateReport({ ...base(), currencies: [...CURRENCIES].reverse() })).toThrow(/must be GBP/)
    expect(() => validateReport({ ...base(), currencies: CURRENCIES.slice(0, 7) })).toThrow(/8 entries/)
  })
  it('rateDate and integer ranges', () => {
    expect(() => validateReport({ ...base(), rateDate: 19691231 })).toThrow(/rateDate/)
    expect(() => validateReport({ ...base(), chainSelector: 0n })).toThrow(/chainSelector/)
    expect(() => validateReport({ ...base(), scheduledTime: 1n << 64n })).toThrow(/scheduledTime/)
    const r = base()
    expect(() => validateReport(withRates(r.usdPerUnitE8.map((x, i) => (i === 0 ? 1n << 64n : x)), r.sourceMasks))).toThrow(/range/)
  })
  it('encodeReport refuses an invalid report', () => {
    expect(() => encodeReport(withRates(Array(8).fill(0n), Array(8).fill(0)))).toThrow()
  })
  it('currencyToBytes3 refuses non-codes', () => {
    expect(() => currencyToBytes3('usd')).toThrow()
    expect(() => currencyToBytes3('EURO')).toThrow()
  })
})
