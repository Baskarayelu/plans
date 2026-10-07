import { describe, expect, it } from 'vitest'
import { aggregateCurrency, aggregateRound, medianBigint, popCount } from '../fx-rates/src/aggregate.ts'
import { DEFAULT_MAX_SPREAD_BPS } from '../fx-rates/src/constants.ts'
import type { SourceQuote } from '../fx-rates/src/sources.ts'

const BPS = DEFAULT_MAX_SPREAD_BPS

describe('medianBigint', () => {
  it('odd count: the middle value', () => {
    expect(medianBigint([5n, 1n, 3n])).toBe(3n)
  })
  it('even count: mean of the middle two, half up', () => {
    expect(medianBigint([100n, 101n])).toBe(101n) // 100.5 -> 101
    expect(medianBigint([100n, 102n])).toBe(101n)
    expect(medianBigint([4n, 1n, 3n, 2n])).toBe(3n) // 2.5 -> 3
  })
  it('refuses an empty list', () => {
    expect(() => medianBigint([])).toThrow()
  })
})

describe('aggregateCurrency', () => {
  it('two agreeing sources: their median, both bits', () => {
    expect(aggregateCurrency([{ bit: 1, e8: 132763336n }, { bit: 2, e8: 132139558n }], BPS)).toEqual({ rate: 132451447n, mask: 3 })
  })
  it('two disagreeing sources: absent (each is half the gap from their median)', () => {
    // 75150 vs 71429: median 73290, each ~2.5 % away > 2 %
    expect(aggregateCurrency([{ bit: 4, e8: 75150n }, { bit: 2, e8: 71429n }], BPS)).toEqual({ rate: 0n, mask: 0 })
  })
  it('two sources 4 % apart are kept (each exactly 2 % from the median); just over is absent', () => {
    expect(aggregateCurrency([{ bit: 1, e8: 98n }, { bit: 2, e8: 102n }], BPS)).toEqual({ rate: 100n, mask: 3 })
    expect(aggregateCurrency([{ bit: 1, e8: 97_999n }, { bit: 2, e8: 102_001n }], BPS)).toEqual({ rate: 0n, mask: 0 })
  })
  it('three sources with one outlier: the outlier is dropped, median of the other two', () => {
    const r = aggregateCurrency(
      [
        { bit: 1, e8: 100_000_000n },
        { bit: 2, e8: 100_100_000n },
        { bit: 4, e8: 120_000_000n },
      ],
      BPS,
    )
    expect(r).toEqual({ rate: 100_050_000n, mask: 3 })
  })
  it('three agreeing sources: median of all three, all bits', () => {
    expect(
      aggregateCurrency(
        [
          { bit: 1, e8: 100n * 10n ** 6n },
          { bit: 2, e8: 101n * 10n ** 6n },
          { bit: 4, e8: 99n * 10n ** 6n },
        ],
        BPS,
      ),
    ).toEqual({ rate: 100n * 10n ** 6n, mask: 7 })
  })
  it('three sources all far apart: fewer than 2 remain, absent', () => {
    expect(
      aggregateCurrency(
        [
          { bit: 1, e8: 80n },
          { bit: 2, e8: 100n },
          { bit: 4, e8: 120n },
        ],
        BPS,
      ),
    ).toEqual({ rate: 0n, mask: 0 })
  })
  it('a single source is never enough', () => {
    expect(aggregateCurrency([{ bit: 1, e8: 100n }], BPS)).toEqual({ rate: 0n, mask: 0 })
    expect(aggregateCurrency([], BPS)).toEqual({ rate: 0n, mask: 0 })
  })
  it('two quotes with the same bit do not count as two sources', () => {
    expect(aggregateCurrency([{ bit: 2, e8: 100n }, { bit: 2, e8: 100n }], BPS)).toEqual({ rate: 0n, mask: 0 })
  })
  it('honours a custom spread', () => {
    const q = [
      { bit: 1, e8: 1000n },
      { bit: 2, e8: 1010n },
    ]
    expect(aggregateCurrency(q, 100).rate).toBe(1005n)
    expect(aggregateCurrency(q, 40).rate).toBe(0n)
  })
})

describe('aggregateRound', () => {
  const src = (bit: number, date: number, e8: SourceQuote['e8']): SourceQuote => ({ bit, name: String(bit), date, e8 })

  it('builds the round in the fixed currency order with per-currency masks', () => {
    const r = aggregateRound(
      [
        src(1, 20261006, { GBP: 132763336n, EUR: 112690024n }),
        src(2, 20261006, { GBP: 132139558n, EUR: 112148667n, AED: 27229408n, NGN: 71429n }),
        src(4, 20261007, { AED: 27229408n, NGN: 75150n }),
      ],
      BPS,
    )
    expect(r.usdPerUnitE8).toEqual([132451447n, 112419346n, 0n, 0n, 0n, 0n, 27229408n, 0n])
    expect(r.sourceMasks).toEqual([3, 3, 0, 0, 0, 0, 6, 0])
    expect(r.rateDate).toBe(20261007)
  })
  it('rateDate only counts sources that contributed to a present rate', () => {
    const r = aggregateRound(
      [
        src(1, 20261006, { GBP: 100n }),
        src(2, 20261006, { GBP: 100n, NGN: 1000n }),
        src(4, 20261009, { NGN: 2000n }), // disagrees: NGN absent, so bit 2 contributes nothing
      ],
      BPS,
    )
    expect(r.sourceMasks).toEqual([3, 0, 0, 0, 0, 0, 0, 0])
    expect(r.rateDate).toBe(20261006)
  })
  it('nothing agreeing: all absent, rateDate 0', () => {
    const r = aggregateRound([src(1, 20261006, { GBP: 100n })], BPS)
    expect(r.usdPerUnitE8.every((x) => x === 0n)).toBe(true)
    expect(r.rateDate).toBe(0)
  })
})

describe('popCount', () => {
  it('counts bits', () => {
    expect([0, 1, 3, 6, 7, 0xff].map(popCount)).toEqual([0, 1, 2, 2, 3, 8])
  })
})
