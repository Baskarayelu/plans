import { describe, expect, it } from 'vitest'
import {
  BLEND_CURRENCIES,
  ECB_CURRENCIES,
  SOURCE_CURRENCY_API,
  SOURCE_FRANKFURTER_BLEND,
  SOURCE_FRANKFURTER_ECB,
} from '../fx-rates/src/constants.ts'
import { isoDateToYyyymmdd, parseCurrencyApi, parseFrankfurterV2 } from '../fx-rates/src/sources.ts'
import { fixture } from './helpers.ts'

describe('Frankfurter v2', () => {
  it('parses the ECB-provider body (array of {date, base, quote, rate})', () => {
    const q = parseFrankfurterV2(fixture('http-frankfurter-ecb.json'), SOURCE_FRANKFURTER_ECB, 'ecb', ECB_CURRENCIES)
    expect(q.bit).toBe(1)
    expect(q.date).toBe(20261006)
    expect(q.e8).toEqual({
      CHF: 120407942n,
      EUR: 112690024n,
      GBP: 132763336n,
      INR: 1037022n,
      JPY: 632551n,
      SGD: 78302404n,
    })
  })
  it('parses the blend body and takes only the wanted currencies', () => {
    const q = parseFrankfurterV2(fixture('http-frankfurter-blend.json'), SOURCE_FRANKFURTER_BLEND, 'blend', BLEND_CURRENCIES)
    expect(q.date).toBe(20261007)
    expect(q.e8).toEqual({ AED: 27229408n, NGN: 75150n })
    const onlyAed = parseFrankfurterV2(fixture('http-frankfurter-blend.json'), SOURCE_FRANKFURTER_BLEND, 'blend', ['AED'])
    expect(onlyAed.e8).toEqual({ AED: 27229408n })
  })
  it('drops a currency quoted twice and skips malformed entries', () => {
    const body = JSON.stringify([
      { date: '2026-10-06', base: 'USD', quote: 'EUR', rate: 0.9 },
      { date: '2026-10-06', base: 'USD', quote: 'EUR', rate: 0.8 },
      { date: '2026-10-06', base: 'USD', quote: 'GBP', rate: 'abc' },
      { date: 'yesterday', base: 'USD', quote: 'CHF', rate: 0.83 },
      { date: '2026-10-05', base: 'USD', quote: 'JPY', rate: 150 },
      null,
    ])
    const q = parseFrankfurterV2(body, 1, 'ecb', ECB_CURRENCIES)
    expect(q.e8).toEqual({ JPY: 666667n })
    expect(q.date).toBe(20261005)
  })
  it('rejects a non-USD base, an error object, and a body with no usable rate', () => {
    expect(() => parseFrankfurterV2('[{"date":"2026-10-06","base":"EUR","quote":"GBP","rate":0.85}]', 1, 'ecb', ECB_CURRENCIES)).toThrow(/base/)
    expect(() => parseFrankfurterV2('{"message":"not found"}', 1, 'ecb', ECB_CURRENCIES)).toThrow(/array/)
    expect(() => parseFrankfurterV2('[]', 1, 'ecb', ECB_CURRENCIES)).toThrow(/no usable/)
    expect(() => parseFrankfurterV2('<html>', 1, 'ecb', ECB_CURRENCIES)).toThrow()
  })
})

describe('fawazahmed0 currency-api', () => {
  it('parses lowercase keys under usd plus the date', () => {
    const q = parseCurrencyApi(fixture('http-currency-api.json'))
    expect(q.bit).toBe(SOURCE_CURRENCY_API)
    expect(q.date).toBe(20261006)
    expect(Object.keys(q.e8).sort()).toEqual(['AED', 'CHF', 'EUR', 'GBP', 'INR', 'JPY', 'NGN', 'SGD'])
    expect(q.e8.GBP).toBe(132139558n)
    expect(q.e8.NGN).toBe(75640n) // 1e8 / 1322.04471943 = 75640.13...
  })
  it('rejects bodies without a date or a usd table', () => {
    expect(() => parseCurrencyApi('{"usd":{"eur":0.9}}')).toThrow(/date/)
    expect(() => parseCurrencyApi('{"date":"2026-10-06"}')).toThrow(/usd/)
    expect(() => parseCurrencyApi('{"date":"2026-10-06","usd":{"btc":0.00001}}')).toThrow(/no usable/)
  })
})

describe('isoDateToYyyymmdd', () => {
  it('converts and validates', () => {
    expect(isoDateToYyyymmdd('2026-10-07')).toBe(20261007)
    for (const bad of ['2026-13-01', '2026-00-10', '1969-12-31', '20261007', 20261007, '2026-10-7']) {
      expect(() => isoDateToYyyymmdd(bad)).toThrow()
    }
  })
})
