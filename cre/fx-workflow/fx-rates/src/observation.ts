// What each node returns from runInNodeMode, and how the DON-level result becomes a round.
// Flat bigint fields so ConsensusAggregationByFields can aggregate each one:
//   r0..r7     median    (USD per unit, 8 decimals, CURRENCIES order)
//   m0..m7     identical (source masks; a Byzantine quorum of nodes must agree)
//   rateDate   identical (yyyymmdd)

import { CURRENCIES, KNOWN_SOURCES, MIN_SOURCES, UINT64_MAX } from './constants.ts'
import { popCount, type RoundRates } from './aggregate.ts'

export type NodeObservation = {
  r0: bigint
  r1: bigint
  r2: bigint
  r3: bigint
  r4: bigint
  r5: bigint
  r6: bigint
  r7: bigint
  m0: bigint
  m1: bigint
  m2: bigint
  m3: bigint
  m4: bigint
  m5: bigint
  m6: bigint
  m7: bigint
  rateDate: bigint
}

const RATE_KEYS = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'] as const
const MASK_KEYS = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'] as const

export function roundToObservation(round: RoundRates): NodeObservation {
  if (round.usdPerUnitE8.length !== CURRENCIES.length || round.sourceMasks.length !== CURRENCIES.length) {
    throw new Error('round must have 8 rates and 8 masks')
  }
  const o = { rateDate: BigInt(round.rateDate) } as NodeObservation
  RATE_KEYS.forEach((k, i) => {
    o[k] = round.usdPerUnitE8[i]
  })
  MASK_KEYS.forEach((k, i) => {
    o[k] = BigInt(round.sourceMasks[i])
  })
  return o
}

/** Accepts what the consensus unwrap may hand back: bigint, number, decimal string, or {value: bigint}. */
export function toBigInt(v: unknown): bigint {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v)
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v)
  if (typeof v === 'object' && v !== null && typeof (v as { value?: unknown }).value === 'bigint') {
    return (v as { value: bigint }).value
  }
  throw new Error(`not an integer: ${String(v)}`)
}

/**
 * The aggregated observation as a round. Median rates and quorum masks come from different
 * aggregations, so they are reconciled here (deterministically, in DON mode): a currency is present
 * only if its median rate is non-zero AND its agreed mask names at least 2 known sources.
 */
export function observationToRound(obs: Record<string, unknown>): RoundRates {
  const usdPerUnitE8: bigint[] = []
  const sourceMasks: number[] = []
  for (let i = 0; i < CURRENCIES.length; i++) {
    const rate = toBigInt(obs[RATE_KEYS[i]])
    const mask = Number(toBigInt(obs[MASK_KEYS[i]]))
    const ok = rate > 0n && rate <= UINT64_MAX && (mask & ~KNOWN_SOURCES) === 0 && popCount(mask) >= MIN_SOURCES
    usdPerUnitE8.push(ok ? rate : 0n)
    sourceMasks.push(ok ? mask : 0)
  }
  return { usdPerUnitE8, sourceMasks, rateDate: Number(toBigInt(obs.rateDate)) }
}

/**
 * The report's scheduledTime (unix seconds): the cron trigger's scheduled execution time, capped at
 * DON time (runtime.now(), never the host clock).
 *
 * On a deployed DON the trigger fires at (or just after) its scheduled time, so the cap never
 * applies. `cre workflow simulate` is different: its manual cron trigger puts the schedule's NEXT
 * run time in the payload (gocron job.NextRun()) and, with --non-interactive or Enter, fires at
 * once, so the payload time can be up to one schedule interval in the future. FxReference rejects
 * a scheduledTime more than 5 minutes ahead of the block (FutureReport), so such a run reports
 * the current DON time instead. A payload without a time also falls back to DON time.
 */
export function scheduledTimeSeconds(
  scheduledSeconds: bigint | undefined,
  donNow: () => Date,
): { seconds: bigint; source: 'trigger' | 'don-time' } {
  const now = BigInt(Math.floor(donNow().getTime() / 1000))
  if (scheduledSeconds !== undefined && scheduledSeconds > 0n && scheduledSeconds <= now) {
    return { seconds: scheduledSeconds, source: 'trigger' }
  }
  return { seconds: now, source: 'don-time' }
}
