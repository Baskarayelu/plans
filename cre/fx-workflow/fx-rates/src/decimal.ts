// Exact decimal arithmetic for FX rates: no floating-point multiplication anywhere.

/** value = coefficient / 10^scale, coefficient >= 0, scale >= 0. */
export type Decimal = { coefficient: bigint; scale: number }

const DECIMAL_RE = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/
const MAX_EXPONENT = 64

/**
 * Parses a non-negative decimal string such as "96.43", "0.75322", "1330.67" or "1.2e-7".
 * Throws on anything else (signs, NaN, Infinity, empty, hex).
 */
export function parseDecimal(text: string): Decimal {
  const m = DECIMAL_RE.exec(text)
  if (!m) throw new Error(`not a decimal number: ${JSON.stringify(text)}`)
  const intPart = m[1]
  const frac = m[2] ?? ''
  const exp = m[3] === undefined ? 0 : Number(m[3])
  if (!Number.isSafeInteger(exp) || Math.abs(exp) > MAX_EXPONENT) throw new Error(`exponent out of range: ${text}`)
  let coefficient = BigInt(intPart + frac)
  let scale = frac.length - exp
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale)
    scale = 0
  }
  return { coefficient, scale }
}

/**
 * The decimal text of a JSON number. JSON.parse has already turned the body into an IEEE double;
 * String(n) is the shortest decimal that round-trips to the same double, which is the number the
 * source published whenever it has at most 15 significant digits (all FX sources used here do).
 */
export function jsonNumberToDecimalString(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`rate must be a positive finite number: ${value}`)
    return String(value)
  }
  if (typeof value === 'string') {
    parseDecimal(value)
    return value
  }
  throw new Error(`rate must be a number, got ${typeof value}`)
}

/** round(n / d), halves rounded up. n >= 0, d > 0. */
export function divRoundHalfUp(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error('division by a non-positive number')
  if (n < 0n) throw new Error('negative dividend')
  const q = n / d
  const r = n % d
  return 2n * r >= d ? q + 1n : q
}

/**
 * Converts a rate quoted as "units of currency per 1 USD" into "USD per 1 unit", 8 decimals:
 * round(10^8 / rate), half up, computed exactly as 10^(8+scale) / coefficient.
 */
export function usdPerUnitE8(unitsPerUsd: string): bigint {
  const { coefficient, scale } = parseDecimal(unitsPerUsd)
  if (coefficient === 0n) throw new Error('rate is zero')
  return divRoundHalfUp(10n ** BigInt(8 + scale), coefficient)
}

/** Formats an 8-decimal fixed-point integer, e.g. 132764n -> "0.00132764". For logs only. */
export function formatE8(e8: bigint): string {
  const neg = e8 < 0n
  const abs = neg ? -e8 : e8
  const s = abs.toString().padStart(9, '0')
  return `${neg ? '-' : ''}${s.slice(0, -8)}.${s.slice(-8)}`
}
