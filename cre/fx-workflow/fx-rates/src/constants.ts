// Fixed parameters shared by the workflow (main.ts), the tests and scripts/gas-limit.mjs.
// Must match contracts/src/FxReference.sol.

/** The fixed currency list, in report order (FxReference._currency). */
export const CURRENCIES = ['GBP', 'EUR', 'INR', 'NGN', 'JPY', 'CHF', 'AED', 'SGD'] as const
export type Currency = (typeof CURRENCIES)[number]

/** sourceMasks bit 0: Frankfurter v2, ECB provider only. */
export const SOURCE_FRANKFURTER_ECB = 1
/** sourceMasks bit 1: fawazahmed0 currency-api (CC0). */
export const SOURCE_CURRENCY_API = 2
/** sourceMasks bit 2: Frankfurter v2 central-bank blend (only for currencies the ECB does not publish). */
export const SOURCE_FRANKFURTER_BLEND = 4
/** Bits FxReference accepts (KNOWN_SOURCES). */
export const KNOWN_SOURCES = 0x07
/** A present rate needs at least this many agreeing sources (FxReference.MIN_SOURCES). */
export const MIN_SOURCES = 2

/** Currencies the ECB publishes: fetched from Frankfurter with providers=ecb. */
export const ECB_CURRENCIES: readonly Currency[] = ['GBP', 'EUR', 'INR', 'JPY', 'CHF', 'SGD']
/** Currencies the ECB does not publish: fetched from Frankfurter's central-bank blend. */
export const BLEND_CURRENCIES: readonly Currency[] = ['AED', 'NGN']

/**
 * Final URLs (CRE's HTTP capability does not follow redirects). api.frankfurter.app answers 301, so it
 * is never used. open.er-api.com is deliberately absent: its terms forbid redistribution, and writing
 * its rates onchain would be redistribution.
 */
export const DEFAULT_SOURCE_URLS = {
  frankfurterEcb: `https://api.frankfurter.dev/v2/rates?base=USD&quotes=${ECB_CURRENCIES.join(',')}&providers=ecb`,
  frankfurterBlend: `https://api.frankfurter.dev/v2/rates?base=USD&quotes=${BLEND_CURRENCIES.join(',')}`,
  currencyApi: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
  currencyApiFallback: 'https://latest.currency-api.pages.dev/v1/currencies/usd.json',
} as const

/** CCIP chain selectors of the chains FxReference is meant for (chain-selectors selectors.yml). */
export const CHAIN_SELECTORS: Readonly<Record<string, bigint>> = {
  'monad-testnet': 2183018362218727504n,
  'monad-mainnet': 8481857512324358265n,
}

/** CRE quota: PerWorkflow.HTTPAction.ResponseSizeLimit is 250 KB. */
export const MAX_RESPONSE_BYTES = 250_000
/** CRE quota: PerWorkflow.ChainWrite.EVM.TransactionGasLimit. */
export const CRE_MAX_TX_GAS = 10_000_000n
/** Default outlier threshold: a source more than 2 % from the median is dropped. */
export const DEFAULT_MAX_SPREAD_BPS = 200

export const UINT64_MAX = (1n << 64n) - 1n
