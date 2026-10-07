// Checks against FxReference's current state, applied before a report is written, so that one
// currency's large move does not make the whole round revert (and burn the gas limit).

import { parseAbi } from 'viem'
import { CURRENCIES } from './constants.ts'
import type { RoundRates } from './aggregate.ts'

/** The FxReference views the workflow reads before writing. */
export const FX_REFERENCE_VIEWS = parseAbi([
  'function lastScheduledTime() view returns (uint64)',
  'function maxMoveBps() view returns (uint16)',
  'function lastRates() view returns (uint64[8])',
])

export type OnchainState = {
  lastScheduledTime: bigint
  maxMoveBps: number
  lastRates: readonly bigint[]
}

export type GuardedRound = { round: RoundRates; dropped: string[] }

/**
 * - Refuses a scheduledTime that FxReference would reject as a replay (<= lastScheduledTime).
 * - Marks absent every currency whose new rate is more than maxMoveBps from the last accepted rate
 *   (FxReference would revert the whole report with RateMoveTooLarge). The owner can raise
 *   maxMoveBps if such a move is real; until then that currency is simply missing from the round.
 * - Refuses a round with no currency left (FxReference would revert EmptyReport).
 */
export function applyOnchainGuards(round: RoundRates, scheduledTime: bigint, state: OnchainState): GuardedRound {
  if (scheduledTime <= state.lastScheduledTime) {
    throw new Error(`scheduledTime ${scheduledTime} is not after the last accepted round (${state.lastScheduledTime}); nothing to write`)
  }
  if (state.lastRates.length !== CURRENCIES.length) throw new Error('lastRates must have 8 entries')
  const usdPerUnitE8 = [...round.usdPerUnitE8]
  const sourceMasks = [...round.sourceMasks]
  const dropped: string[] = []
  const maxMove = BigInt(state.maxMoveBps)
  for (let i = 0; i < CURRENCIES.length; i++) {
    const rate = usdPerUnitE8[i]
    const prev = state.lastRates[i]
    if (rate === 0n || prev === 0n) continue
    const diff = rate > prev ? rate - prev : prev - rate
    if (diff * 10_000n > prev * maxMove) {
      dropped.push(`${CURRENCIES[i]} (${prev} -> ${rate}, limit ${state.maxMoveBps} bps)`)
      usdPerUnitE8[i] = 0n
      sourceMasks[i] = 0
    }
  }
  if (usdPerUnitE8.every((r) => r === 0n)) throw new Error('no currency left to report this round')
  return { round: { ...round, usdPerUnitE8, sourceMasks }, dropped }
}
