// Workflow config (config.<target>.json) validation. The workflow refuses to run on a bad config.

import { type Hex, isAddress, zeroAddress } from 'viem'
import { CHAIN_SELECTORS, CRE_MAX_TX_GAS, DEFAULT_MAX_SPREAD_BPS, DEFAULT_SOURCE_URLS } from './constants.ts'

export type SourceUrls = {
  frankfurterEcb: string
  frankfurterBlend: string
  currencyApi: string
  currencyApiFallback: string
}

/** Shape of config.<target>.json. */
export type Config = {
  schedule: string
  /** CRE chain name, e.g. "monad-testnet". */
  chainName: string
  /** The CCIP chain selector FxReference was deployed with, as a decimal string. */
  chainSelector: string
  /** The deployed FxReference. */
  receiverAddress: string
  /** writeReport gas limit. Set ONLY by scripts/gas-limit.mjs (Monad's estimator); empty by default. */
  gasLimit?: string
  maxSpreadBps?: number
  sources?: Partial<SourceUrls>
}

export type ParsedConfig = {
  schedule: string
  chainName: string
  chainSelector: bigint
  receiverAddress: Hex
  gasLimit: string
  maxSpreadBps: number
  urls: SourceUrls
}

export const GAS_LIMIT_HINT =
  'gasLimit is not set. It must come from Monad\'s estimator: after deploying FxReference, run ' +
  '`node scripts/gas-limit.mjs --receiver <FxReference> --transmitter <simTransmitter> --write` ' +
  'from cre/fx-workflow (see README). No default gas limit exists on purpose.'

export function parseConfig(raw: unknown): ParsedConfig {
  if (typeof raw !== 'object' || raw === null) throw new Error('config must be a JSON object')
  const c = raw as Record<string, unknown>

  if (typeof c.schedule !== 'string' || c.schedule.trim() === '') throw new Error('config.schedule must be a cron string')

  if (typeof c.chainName !== 'string' || !(c.chainName in CHAIN_SELECTORS)) {
    throw new Error(`config.chainName must be one of ${Object.keys(CHAIN_SELECTORS).sort().join(', ')}`)
  }
  if (typeof c.chainSelector !== 'string' || !/^\d+$/.test(c.chainSelector)) {
    throw new Error('config.chainSelector must be a decimal string')
  }
  const chainSelector = BigInt(c.chainSelector)
  if (chainSelector !== CHAIN_SELECTORS[c.chainName]) {
    throw new Error(`config.chainSelector ${chainSelector} is not the selector of ${c.chainName} (${CHAIN_SELECTORS[c.chainName]})`)
  }

  if (typeof c.receiverAddress !== 'string' || !isAddress(c.receiverAddress, { strict: false }) || c.receiverAddress.toLowerCase() === zeroAddress) {
    throw new Error('config.receiverAddress must be the deployed FxReference address (0x + 40 hex)')
  }

  if (c.gasLimit === undefined || c.gasLimit === null || c.gasLimit === '') throw new Error(GAS_LIMIT_HINT)
  if (typeof c.gasLimit !== 'string' || !/^[1-9]\d*$/.test(c.gasLimit)) {
    throw new Error('config.gasLimit must be a decimal integer string written by scripts/gas-limit.mjs')
  }
  if (BigInt(c.gasLimit) <= 21_000n || BigInt(c.gasLimit) > CRE_MAX_TX_GAS) {
    throw new Error(`config.gasLimit must be above 21000 and at most the CRE quota ${CRE_MAX_TX_GAS}`)
  }

  let maxSpreadBps = DEFAULT_MAX_SPREAD_BPS
  if (c.maxSpreadBps !== undefined) {
    if (typeof c.maxSpreadBps !== 'number' || !Number.isInteger(c.maxSpreadBps) || c.maxSpreadBps < 1 || c.maxSpreadBps > 10_000) {
      throw new Error('config.maxSpreadBps must be an integer in 1..10000')
    }
    maxSpreadBps = c.maxSpreadBps
  }

  const urls = parseSourceUrls(c)

  return {
    schedule: c.schedule,
    chainName: c.chainName,
    chainSelector,
    receiverAddress: c.receiverAddress as Hex,
    gasLimit: c.gasLimit,
    maxSpreadBps,
    urls,
  }
}

/** The source URLs of a config (defaults overridden by `config.sources`), validated. */
export function parseSourceUrls(c: Record<string, unknown>): SourceUrls {
  const urls: SourceUrls = { ...DEFAULT_SOURCE_URLS }
  if (c.sources !== undefined) {
    if (typeof c.sources !== 'object' || c.sources === null) throw new Error('config.sources must be an object')
    for (const [k, v] of Object.entries(c.sources as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (!(k in urls)) throw new Error(`config.sources.${k} is not a known source`)
      if (typeof v !== 'string' || !v.startsWith('https://')) throw new Error(`config.sources.${k} must be an https URL`)
      if (/open\.er-api\.com|exchangerate-api\.com/i.test(v)) {
        throw new Error('ExchangeRate-API (open.er-api.com) forbids redistribution; it must not feed an onchain round')
      }
      urls[k as keyof SourceUrls] = v
    }
  }
  return urls
}
