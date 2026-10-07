// The report payload, encoded exactly as FxReference._processReport decodes it:
//   abi.encode(uint64 chainSelector, uint64 scheduledTime, uint32 rateDate,
//              bytes3[] currencies, uint64[] usdPerUnitE8, uint8[] sourceMasks)

import { decodeAbiParameters, encodeAbiParameters, type Hex, hexToString, stringToHex } from 'viem'
import { CURRENCIES, KNOWN_SOURCES, MIN_SOURCES, UINT64_MAX } from './constants.ts'
import { popCount } from './aggregate.ts'

export const REPORT_PARAMS = [
  { name: 'chainSelector', type: 'uint64' },
  { name: 'scheduledTime', type: 'uint64' },
  { name: 'rateDate', type: 'uint32' },
  { name: 'currencies', type: 'bytes3[]' },
  { name: 'usdPerUnitE8', type: 'uint64[]' },
  { name: 'sourceMasks', type: 'uint8[]' },
] as const

export type FxReport = {
  chainSelector: bigint
  scheduledTime: bigint
  rateDate: number
  /** ASCII codes, e.g. "GBP"; must be CURRENCIES in order. */
  currencies: readonly string[]
  usdPerUnitE8: readonly bigint[]
  sourceMasks: readonly number[]
}

/** "GBP" -> 0x474250 (bytes3). */
export function currencyToBytes3(code: string): Hex {
  if (!/^[A-Z]{3}$/.test(code)) throw new Error(`currency must be 3 ASCII capitals: ${JSON.stringify(code)}`)
  return stringToHex(code, { size: 3 })
}

/**
 * The checks FxReference applies to the payload itself (not the ones that depend on chain state:
 * replay, future skew, chain selector of the deployed contract, move limit). Throws on the first
 * violation so a bad round never costs a transaction.
 */
export function validateReport(r: FxReport): void {
  if (r.chainSelector <= 0n || r.chainSelector > UINT64_MAX) throw new Error('chainSelector out of range')
  if (r.scheduledTime <= 0n || r.scheduledTime > UINT64_MAX) throw new Error('scheduledTime out of range')
  if (!Number.isInteger(r.rateDate) || r.rateDate < 19700101 || r.rateDate > 99991231) {
    throw new Error(`rateDate out of range: ${r.rateDate}`)
  }
  const n = CURRENCIES.length
  if (r.currencies.length !== n || r.usdPerUnitE8.length !== n || r.sourceMasks.length !== n) {
    throw new Error('report arrays must have exactly 8 entries')
  }
  let any = false
  for (let i = 0; i < n; i++) {
    if (r.currencies[i] !== CURRENCIES[i]) throw new Error(`currency ${i} must be ${CURRENCIES[i]}`)
    const rate = r.usdPerUnitE8[i]
    const mask = r.sourceMasks[i]
    if (!Number.isInteger(mask) || mask < 0 || mask > 0xff) throw new Error(`${CURRENCIES[i]}: mask out of range`)
    if (rate < 0n || rate > UINT64_MAX) throw new Error(`${CURRENCIES[i]}: rate out of range`)
    if (rate === 0n) {
      if (mask !== 0) throw new Error(`${CURRENCIES[i]}: absent rate with mask ${mask}`)
      continue
    }
    if ((mask & ~KNOWN_SOURCES) !== 0 || popCount(mask) < MIN_SOURCES) {
      throw new Error(`${CURRENCIES[i]}: present rate needs >= ${MIN_SOURCES} known sources, mask ${mask}`)
    }
    any = true
  }
  if (!any) throw new Error('empty report: no currency has a rate')
}

export function encodeReport(r: FxReport): Hex {
  validateReport(r)
  return encodeAbiParameters(REPORT_PARAMS, [
    r.chainSelector,
    r.scheduledTime,
    r.rateDate,
    r.currencies.map(currencyToBytes3),
    [...r.usdPerUnitE8],
    [...r.sourceMasks],
  ])
}

export function decodeReport(encoded: Hex): FxReport {
  const [chainSelector, scheduledTime, rateDate, currencies, usdPerUnitE8, sourceMasks] = decodeAbiParameters(
    REPORT_PARAMS,
    encoded,
  )
  return {
    chainSelector,
    scheduledTime,
    rateDate,
    currencies: currencies.map((c) => hexToString(c, { size: 3 })),
    usdPerUnitE8: [...usdPerUnitE8],
    sourceMasks: [...sourceMasks],
  }
}
