import { describe, expect, it } from 'vitest'
import { divRoundHalfUp, formatE8, jsonNumberToDecimalString, parseDecimal, usdPerUnitE8 } from '../fx-rates/src/decimal.ts'

describe('parseDecimal', () => {
  it('parses plain and fractional decimals exactly', () => {
    expect(parseDecimal('96.43')).toEqual({ coefficient: 9643n, scale: 2 })
    expect(parseDecimal('0.75322')).toEqual({ coefficient: 75322n, scale: 5 })
    expect(parseDecimal('1330')).toEqual({ coefficient: 1330n, scale: 0 })
  })
  it('parses exponents (String(number) emits them for small/large values)', () => {
    expect(parseDecimal('1.2e-5')).toEqual({ coefficient: 12n, scale: 6 })
    expect(parseDecimal('5e+3')).toEqual({ coefficient: 5000n, scale: 0 })
  })
  it('rejects anything that is not a non-negative decimal', () => {
    for (const bad of ['', '-1', '+1', '1.', '.5', 'NaN', 'Infinity', '0x10', '1,5', ' 1']) {
      expect(() => parseDecimal(bad), bad).toThrow()
    }
  })
})

describe('jsonNumberToDecimalString', () => {
  it('keeps the published digits of a JSON number', () => {
    expect(jsonNumberToDecimalString(JSON.parse('0.89167355'))).toBe('0.89167355')
    expect(jsonNumberToDecimalString(JSON.parse('1.1692761e-05'))).toBe('0.000011692761')
  })
  it('rejects zero, negatives, non-finite and non-numbers', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, null, true, {}]) {
      expect(() => jsonNumberToDecimalString(bad)).toThrow()
    }
  })
})

describe('usdPerUnitE8 (units per USD -> USD per unit, 8 dp, round half up)', () => {
  it('matches independently computed values', () => {
    expect(usdPerUnitE8('0.75322')).toBe(132763336n) // 132763336.07...
    expect(usdPerUnitE8('158.09')).toBe(632551n) // 632550.9...
    expect(usdPerUnitE8('1330.67')).toBe(75150n) // 75149.5...
    expect(usdPerUnitE8('3.6725')).toBe(27229408n)
    expect(usdPerUnitE8('1')).toBe(100000000n)
  })
  it('rounds an exact half up, not to even', () => {
    // 1e8 / 512 = 195312.5 exactly
    expect(usdPerUnitE8('512')).toBe(195313n)
    // 1e8 / 2560 = 39062.5 exactly (written with an exponent)
    expect(usdPerUnitE8('2.56e3')).toBe(39063n)
  })
  it('rounds below half down', () => {
    expect(usdPerUnitE8('3')).toBe(33333333n) // 33333333.33
    expect(usdPerUnitE8('6')).toBe(16666667n) // 16666666.67
  })
  it('handles very small rates without floating point', () => {
    expect(usdPerUnitE8('1.2e-5')).toBe(8333333333333n)
  })
  it('refuses a zero rate', () => {
    expect(() => usdPerUnitE8('0')).toThrow()
    expect(() => usdPerUnitE8('0.000')).toThrow()
  })
})

describe('helpers', () => {
  it('divRoundHalfUp', () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n)
    expect(divRoundHalfUp(4n, 3n)).toBe(1n)
    expect(divRoundHalfUp(0n, 7n)).toBe(0n)
    expect(() => divRoundHalfUp(1n, 0n)).toThrow()
  })
  it('formatE8', () => {
    expect(formatE8(132451447n)).toBe('1.32451447')
    expect(formatE8(75150n)).toBe('0.00075150')
    expect(formatE8(0n)).toBe('0.00000000')
  })
})
