#!/usr/bin/env node
// Monad gas limit for the FX workflow's writeReport, from Monad's own estimator. Read-only: it sends
// no transaction (only eth_chainId, web3_clientVersion, eth_getCode, eth_call, eth_getBlockByNumber,
// eth_getBalance, eth_gasPrice, eth_estimateGas and eth_simulateV1).
//
//   node scripts/gas-limit.mjs --receiver <FxReference> --transmitter <simTransmitter> [--write]
//
// What it measures: the transaction `cre workflow simulate --broadcast` sends, i.e.
// MockKeystoneForwarder.report(receiver, rawReport, reportContext, signatures) from the transmitter,
// where rawReport = 0x01 | executionId(32) | timestamp(4) | donId(4) | donConfigVersion(4) |
// workflowCid(32) | workflowName(10) | workflowOwner(20) | reportId(2) | payload, and the payload is
// a real FxReference report (live rates, or --rates fixture) with scheduledTime = latest block time.
//
// Why two steps: the mock forwarder calls onReport with all remaining gas and SWALLOWS a revert, so the
// outer transaction succeeds even when FxReference ran out of gas. eth_estimateGas (the lowest gas at
// which the outer call does not revert) can therefore land below what onReport needs. The script takes
// Monad's eth_estimateGas as the starting point and then searches with eth_simulateV1 (on the same
// Monad RPC) for the smallest gas limit whose logs contain FxReference's RoundWritten event.
// gasLimit = ceil1000(ceil(minSuccessGas * 1.10)).
//
// Options:
//   --receiver <addr>      deployed FxReference (required unless --preview)
//   --transmitter <addr>   the wallet of CRE_ETH_PRIVATE_KEY; must equal FxReference.simTransmitter()
//   --config <path>        workflow config to read/update (default fx-rates/config.staging.json)
//   --rpc <url>            Monad RPC (default: testnet-rpc.monad.xyz / rpc.monad.xyz by config chain)
//   --rates live|fixture   payload rates: fetched now (default) or test/fixtures HTTP bodies
//   --calldata simulator|bare  reportContext + 4 signatures as the CRE simulator sends them (default,
//                          observed on Monad testnet), or the empty context/signature list
//   --write                store gasLimit (and receiverAddress, if empty) in the config file
//   --preview              FxReference not deployed yet: overlay its code and constructor storage on a
//                          placeholder address (eth_estimateGas / eth_simulateV1 state overrides). For a
//                          look at the number only; --write is refused.
//
// Refuses any chain that is not Monad (chain id 10143 or 143).

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const log = (...a) => console.error('[gas-limit]', ...a)
const die = (msg) => {
  console.error(`[gas-limit] ERROR: ${msg}`)
  process.exit(1)
}

// The workflow's own modules (TypeScript): needs Node's built-in type stripping (>= 22.18 / 23.6).
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 18) || (major === 23 && minor < 6)) {
  die(`Node ${process.versions.node} cannot import the workflow's TypeScript modules; use Node >= 22.18`)
}
const src = (f) => import(pathToFileURL(path.join(ROOT, 'fx-rates', 'src', f)).href)
const { computeRound } = await src('collect.ts')
const { parseSourceUrls } = await src('config.ts')
const { CURRENCIES, CRE_MAX_TX_GAS, DEFAULT_SOURCE_URLS, MAX_RESPONSE_BYTES } = await src('constants.ts')
const { formatE8 } = await src('decimal.ts')
const { applyOnchainGuards } = await src('guards.ts')
const { encodeReport } = await src('report.ts')
let V
try {
  V = await import('viem')
} catch {
  die('viem is not installed: run `npm install` in cre/fx-workflow first')
}
const { concat, decodeErrorResult, decodeFunctionResult, encodeFunctionData, getAddress, isAddress, keccak256, numberToHex, pad, parseAbi, stringToHex, toBytes, toHex } = V

// ───────────────────────────── constants ─────────────────────────────

const MONAD = {
  10143: {
    name: 'monad-testnet',
    selector: 2183018362218727504n,
    mockForwarder: '0xB9F79d863261869B234c481D1f9A7af84AeAd192',
    rpc: 'https://testnet-rpc.monad.xyz',
  },
  143: {
    name: 'monad-mainnet',
    selector: 8481857512324358265n,
    mockForwarder: '0x9eF6468C5f37b976E57d52054c693269479A784d',
    rpc: 'https://rpc.monad.xyz',
  },
}
const ROUND_WRITTEN = keccak256(toBytes('RoundWritten(uint64,uint64,uint32,uint8,uint64[],uint8[])'))
if (ROUND_WRITTEN !== '0x8476deb7dae7ccbca73276a9dc7a676dd3d71d7dd028588e95c88c4c111a233e') die('RoundWritten topic mismatch')
const MARGIN_BPS = 1_000n // +10 %
const PREVIEW_RECEIVER = '0x00000000000000000000000000000000000F7Fe1'

const MOCK_ABI = parseAbi(['function report(address receiver, bytes rawReport, bytes reportContext, bytes[] signatures)'])
const FX_ABI = parseAbi([
  'function forwarder() view returns (address)',
  'function simTransmitter() view returns (address)',
  'function CHAIN_SELECTOR() view returns (uint64)',
  'function SIM_FORWARDER() view returns (address)',
  'function lastScheduledTime() view returns (uint64)',
  'function maxMoveBps() view returns (uint16)',
  'function lastRates() view returns (uint64[8])',
  'function latestRoundId() view returns (uint64)',
  'function onReport(bytes metadata, bytes report)',
  'error InvalidSender(address sender)',
  'error InvalidTransmitter(address origin)',
  'error InvalidMetadata()',
  'error InvalidConfig()',
  'error WrongChain(uint64 chainSelector)',
  'error StaleReport(uint64 scheduledTime, uint64 lastScheduledTime)',
  'error FutureReport(uint64 scheduledTime)',
  'error InvalidRateDate(uint32 rateDate)',
  'error InvalidLength()',
  'error CurrencyMismatch(uint256 index)',
  'error MissingSources(bytes3 currency, uint8 sourceMask)',
  'error RateMoveTooLarge(bytes3 currency, uint64 previousE8, uint64 newE8)',
  'error EmptyReport()',
])

// ───────────────────────────── args ─────────────────────────────

const { values: args } = parseArgs({
  options: {
    receiver: { type: 'string' },
    transmitter: { type: 'string' },
    config: { type: 'string', default: path.join('fx-rates', 'config.staging.json') },
    rpc: { type: 'string' },
    rates: { type: 'string', default: 'live' },
    calldata: { type: 'string', default: 'simulator' },
    write: { type: 'boolean', default: false },
    preview: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})
if (args.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 40).join('\n'))
  process.exit(0)
}
if (args.preview && args.write) die('--preview measures a placeholder deployment; --write is refused. Deploy FxReference and run without --preview.')
if (!['live', 'fixture'].includes(args.rates)) die('--rates must be live or fixture')
if (!['simulator', 'bare'].includes(args.calldata)) die('--calldata must be simulator or bare')
if (!args.transmitter || !isAddress(args.transmitter)) die('--transmitter <address> is required (the CRE_ETH_PRIVATE_KEY wallet)')
const transmitter = getAddress(args.transmitter)
if (!args.preview && (!args.receiver || !isAddress(args.receiver))) die('--receiver <deployed FxReference address> is required')
const receiver = getAddress(args.preview ? (args.receiver ?? PREVIEW_RECEIVER) : args.receiver)

const configPath = path.resolve(ROOT, args.config)
if (!existsSync(configPath)) die(`config not found: ${configPath}`)
const configText = readFileSync(configPath, 'utf8')
const config = JSON.parse(configText)

// ───────────────────────────── rpc ─────────────────────────────

const chainByName = Object.entries(MONAD).find(([, m]) => m.name === config.chainName)
if (!chainByName) die(`config.chainName must be monad-testnet or monad-mainnet, got ${config.chainName}`)
const RPC = args.rpc ?? chainByName[1].rpc
let rpcId = 0
let last = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function rpc(method, params = []) {
  for (let attempt = 0; ; attempt++) {
    const wait = last + 120 - Date.now()
    if (wait > 0) await sleep(wait)
    last = Date.now()
    let res, text
    try {
      res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) })
      text = await res.text()
    } catch (e) {
      if (attempt < 5) {
        await sleep(500 * (attempt + 1))
        continue
      }
      throw e
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      await sleep(700 * (attempt + 1))
      continue
    }
    const j = JSON.parse(text)
    if (j.error) {
      if (/rate|limit|too many/i.test(j.error.message ?? '') && attempt < 6) {
        await sleep(900 * (attempt + 1))
        continue
      }
      const err = new Error(`${method}: ${j.error.message}`)
      err.data = j.error.data
      throw err
    }
    return j.result
  }
}
const hex = (n) => numberToHex(BigInt(n))

const chainId = Number(await rpc('eth_chainId'))
const chain = MONAD[chainId]
if (!chain) die(`chain id ${chainId} is not Monad (10143 testnet / 143 mainnet); refusing`)
const client = String(await rpc('web3_clientVersion').catch(() => ''))
if (/anvil|hardhat|ganache|tenderly/i.test(client)) die(`${RPC} is ${client}, not a Monad node; refusing`)
if (chain.name !== config.chainName) die(`config is for ${config.chainName} but the RPC is ${chain.name}`)
if (BigInt(config.chainSelector) !== chain.selector) die(`config.chainSelector ${config.chainSelector} is not ${chain.name}'s ${chain.selector}`)
const forwarder = getAddress(chain.mockForwarder)
log(`chain ${chainId} (${chain.name}) via ${RPC} [${client || 'unknown client'}]`)

// ───────────────────────────── FxReference state ─────────────────────────────

let stateOverride // only in --preview
async function view(fn, to = receiver) {
  const data = encodeFunctionData({ abi: FX_ABI, functionName: fn })
  const params = [{ to, data }, 'latest']
  if (stateOverride) params.push(stateOverride)
  return decodeFunctionResult({ abi: FX_ABI, functionName: fn, data: await rpc('eth_call', params) })
}

if (args.preview) {
  const artifactPath = path.resolve(ROOT, '..', '..', 'contracts', 'out', 'FxReference.sol', 'FxReference.json')
  if (!existsSync(artifactPath)) die(`--preview needs ${artifactPath} (run forge build in contracts/)`)
  const art = JSON.parse(readFileSync(artifactPath, 'utf8'))
  const ctor = V.encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint64' }],
    [transmitter, forwarder, transmitter, chain.selector],
  )
  // A contract creation through eth_call returns the runtime code with the immutables filled in.
  const code = await rpc('eth_call', [{ from: transmitter, data: concat([art.bytecode.object, ctor]) }, 'latest'])
  const slot = (n) => pad(toHex(n), { size: 32 })
  const word = (v) => pad(toHex(BigInt(v)), { size: 32 })
  // Constructor storage (forge inspect FxReference storageLayout): owner 0, forwarder 2,
  // simTransmitter 3, slot 5 = expectedWorkflowOwner (0) | maxMoveBps << 160. Verified below.
  stateOverride = {
    [receiver]: {
      code,
      stateDiff: {
        [slot(0)]: word(BigInt(transmitter)),
        [slot(2)]: word(BigInt(forwarder)),
        [slot(3)]: word(BigInt(transmitter)),
        [slot(5)]: word(1000n << 160n),
      },
    },
  }
  log(`PREVIEW: FxReference is not deployed; overlaying its code (${(code.length - 2) / 2} bytes) and constructor storage at ${receiver}`)
} else {
  const code = await rpc('eth_getCode', [receiver, 'latest'])
  if (!code || code === '0x') die(`no contract at ${receiver} on ${chain.name}`)
}

const fxForwarder = getAddress(await view('forwarder').catch(() => die(`${receiver} does not answer forwarder(): not an FxReference`)))
const fxTransmitter = getAddress(await view('simTransmitter'))
const fxSelector = await view('CHAIN_SELECTOR')
if (fxSelector !== chain.selector) die(`FxReference.CHAIN_SELECTOR() is ${fxSelector}, not ${chain.name}'s ${chain.selector}`)
if (fxForwarder !== forwarder) {
  die(`FxReference.forwarder() is ${fxForwarder}, not the MockKeystoneForwarder ${forwarder}: it is not in simulation mode, so a simulation-mode gas limit does not apply`)
}
if (fxTransmitter !== transmitter) die(`FxReference.simTransmitter() is ${fxTransmitter}, not --transmitter ${transmitter}; onReport would revert InvalidTransmitter`)
const onchain = {
  lastScheduledTime: await view('lastScheduledTime'),
  maxMoveBps: Number(await view('maxMoveBps')),
  lastRates: [...(await view('lastRates'))],
}
if (args.preview && onchain.maxMoveBps !== 1000) die('preview storage overlay did not read back (maxMoveBps); storage layout changed?')
log(`FxReference ${receiver}: simulation mode, transmitter ${transmitter}, latest round ${await view('latestRoundId')}, maxMoveBps ${onchain.maxMoveBps}`)

// ───────────────────────────── payload ─────────────────────────────

const parsedUrls = (() => {
  try {
    return parseSourceUrls(config)
  } catch {
    return { ...DEFAULT_SOURCE_URLS }
  }
})()
const fixtureBodies = {
  [DEFAULT_SOURCE_URLS.frankfurterEcb]: 'http-frankfurter-ecb.json',
  [DEFAULT_SOURCE_URLS.frankfurterBlend]: 'http-frankfurter-blend.json',
  [DEFAULT_SOURCE_URLS.currencyApi]: 'http-currency-api.json',
}
const bodies = new Map()
if (args.rates === 'live') {
  // Same sources and parsers as the workflow; redirects are errors, as in CRE.
  for (const url of Object.values(parsedUrls)) {
    try {
      const res = await fetch(url, { redirect: 'error' })
      const text = await res.text()
      if (res.status === 200 && text.length <= MAX_RESPONSE_BYTES) bodies.set(url, text)
      else log(`source ${url}: HTTP ${res.status}, ${text.length} bytes`)
    } catch (e) {
      log(`source ${url}: ${e.message}`)
    }
  }
} else {
  for (const [url, f] of Object.entries(fixtureBodies)) bodies.set(url, readFileSync(path.join(ROOT, 'test', 'fixtures', f), 'utf8'))
}
const get = (url) => {
  const b = bodies.get(url)
  if (b === undefined) throw new Error(`no body for ${url}`)
  return b
}
const aggregated = computeRound(get, parsedUrls, config.maxSpreadBps ?? 200, (m) => log(m))

const block = await rpc('eth_getBlockByNumber', ['latest', false])
const blockTime = BigInt(block.timestamp)
const scheduledTime = blockTime > onchain.lastScheduledTime ? blockTime : onchain.lastScheduledTime + 1n
const { round, dropped } = applyOnchainGuards(aggregated, scheduledTime, onchain)
for (const d of dropped) log(`left out (move above maxMoveBps): ${d}`)
const payload = encodeReport({
  chainSelector: chain.selector,
  scheduledTime,
  rateDate: round.rateDate,
  currencies: CURRENCIES,
  usdPerUnitE8: round.usdPerUnitE8,
  sourceMasks: round.sourceMasks,
})
const present = round.usdPerUnitE8.filter((r) => r > 0n).length
log(`payload (${args.rates} rates): ${present}/8 currencies, rateDate ${round.rateDate}, scheduledTime ${scheduledTime}, ${(payload.length - 2) / 2} bytes`)
CURRENCIES.forEach((c, i) => log(`  ${c} ${round.usdPerUnitE8[i] === 0n ? 'absent' : formatE8(round.usdPerUnitE8[i])} mask ${round.sourceMasks[i]}`))
if (present < 8) log('note: fewer than 8 currencies present; a fuller round costs a little more gas (the 10% margin covers it)')

// ───────────────────────────── calldata ─────────────────────────────

/** 32 bytes with no zero byte (so every probe's calldata costs the same). */
const nonZero32 = () => {
  const b = Buffer.from(keccak256(randomBytes(32)).slice(2), 'hex')
  for (let i = 0; i < b.length; i++) if (b[i] === 0) b[i] = 1
  return toHex(b)
}
const workflowName = stringToHex(createHash('sha256').update(String(config.workflowName ?? 'plans-fx-rates-staging')).digest('hex').slice(0, 10))
const reportContext = args.calldata === 'bare' ? '0x' : concat([toHex(Uint8Array.from({ length: 32 }, (_, i) => i)), pad('0x0100', { size: 32 }), pad('0x', { size: 32 })])
const signatures = args.calldata === 'bare' ? [] : Array.from({ length: 4 }, () => concat([nonZero32(), nonZero32(), '0x00']))
const rawReport = (executionId) =>
  concat([
    '0x01',
    executionId,
    pad(toHex(Number(scheduledTime & 0xffffffffn)), { size: 4 }),
    pad('0x01', { size: 4 }), // donId
    pad('0x01', { size: 4 }), // donConfigVersion
    `0x${'11'.repeat(32)}`, // workflowCid (the simulator's placeholder)
    workflowName, // bytes10
    `0x${'aa'.repeat(20)}`, // workflowOwner (the simulator's placeholder)
    '0x0001', // reportId
    payload,
  ])
const txData = () => encodeFunctionData({ abi: MOCK_ABI, functionName: 'report', args: [receiver, rawReport(nonZero32()), reportContext, signatures] })

// ───────────────────────────── estimate + search ─────────────────────────────

const estimateParams = [{ from: transmitter, to: forwarder, data: txData() }, 'latest']
if (stateOverride) estimateParams.push(stateOverride)
const estimate = BigInt(await rpc('eth_estimateGas', estimateParams))
log(`Monad eth_estimateGas: ${estimate}`)

const simOverrides = { ...(stateOverride ?? {}), [transmitter]: { ...(stateOverride?.[transmitter] ?? {}), balance: hex(10n ** 24n) } }
let probes = 0
async function probe(gases) {
  probes += gases.length
  const calls = gases.map((g) => ({ from: transmitter, to: forwarder, data: txData(), gas: hex(g), maxFeePerGas: hex(10n ** 12n), maxPriorityFeePerGas: '0x0' }))
  let r
  try {
    r = await rpc('eth_simulateV1', [{ blockStateCalls: [{ stateOverrides: simOverrides, calls }] }, 'latest'])
  } catch (e) {
    // A limit below the intrinsic gas fails the whole request: probe one by one, counting it as a failure.
    if (!/intrinsic gas/i.test(e.message)) throw e
    if (gases.length === 1) return [{ ok: false, status: '0x0', error: e.message }]
    const out = []
    for (const g of gases) out.push(...(await probe([g])))
    probes -= gases.length
    return out
  }
  return r[0].calls.map((c) => ({
    ok: c.status === '0x1' && (c.logs ?? []).some((l) => getAddress(l.address) === receiver && l.topics?.[0]?.toLowerCase() === ROUND_WRITTEN),
    status: c.status,
    error: c.error?.message,
  }))
}

async function diagnose() {
  // Re-run onReport directly with FxReference's forwarder slot pointed at the transmitter, so the
  // revert reason is not swallowed by the mock. Diagnostic only; no gas is taken from it.
  const ov = { ...simOverrides, [receiver]: { ...(simOverrides[receiver] ?? {}), stateDiff: { ...(simOverrides[receiver]?.stateDiff ?? {}), [pad('0x02', { size: 32 })]: pad(transmitter, { size: 32 }) } } }
  const metadata = concat([`0x${'11'.repeat(32)}`, workflowName, `0x${'aa'.repeat(20)}`, '0x0001'])
  const data = encodeFunctionData({ abi: FX_ABI, functionName: 'onReport', args: [metadata, payload] })
  const r = await rpc('eth_simulateV1', [{ blockStateCalls: [{ stateOverrides: ov, calls: [{ from: transmitter, to: receiver, data, gas: hex(CRE_MAX_TX_GAS) }] }] }, 'latest'])
  const c = r[0].calls[0]
  if (c.status === '0x1') return 'onReport succeeds when called directly'
  try {
    const e = decodeErrorResult({ abi: FX_ABI, data: c.returnData })
    return `onReport reverts ${e.errorName}(${(e.args ?? []).join(', ')})`
  } catch {
    return `onReport reverts: ${c.error?.message ?? c.returnData}`
  }
}

let lo = 21_000n
let hi
const first = await probe([estimate])
if (first[0].ok) hi = estimate
else {
  lo = estimate
  for (let g = (estimate * 5n) / 4n; ; g = (g * 5n) / 4n) {
    if (g > CRE_MAX_TX_GAS) g = CRE_MAX_TX_GAS
    const r = await probe([g])
    if (r[0].ok) {
      hi = g
      break
    }
    lo = g
    if (g === CRE_MAX_TX_GAS) die(`no RoundWritten even at the CRE cap ${CRE_MAX_TX_GAS}: ${await diagnose()}`)
  }
}
// k-ary search on (lo, hi]: each probe carries its own execution id (fresh forwarder storage), a
// failed probe leaves FxReference unchanged, and the first success ends the useful part of the block.
while (hi - lo > 1n) {
  const k = hi - lo - 1n < 8n ? hi - lo - 1n : 8n
  const pts = []
  for (let j = 1n; j <= k; j++) pts.push(lo + ((hi - lo) * j) / (k + 1n))
  const res = await probe(pts)
  const i = res.findIndex((x) => x.ok)
  if (i === -1) lo = pts[pts.length - 1]
  else {
    hi = pts[i]
    if (i > 0) lo = pts[i - 1]
  }
}
const minGas = hi
const [atMin, belowMin] = [(await probe([minGas]))[0], (await probe([minGas - 1n]))[0]]
if (!atMin.ok || belowMin.ok) die(`search did not converge (min ${minGas}: ${atMin.ok}, min-1: ${belowMin.ok}); rerun`)

const ceil1000 = (n) => ((n + 999n) / 1000n) * 1000n
const gasLimit = ceil1000((minGas * (10_000n + MARGIN_BPS) + 9_999n) / 10_000n)
if (gasLimit > CRE_MAX_TX_GAS) die(`gasLimit ${gasLimit} exceeds the CRE per-transaction quota ${CRE_MAX_TX_GAS}`)

const gasPrice = BigInt(await rpc('eth_gasPrice'))
const balance = BigInt(await rpc('eth_getBalance', [transmitter, 'latest']))
const fee = gasLimit * gasPrice
const mon = (wei) => `${(Number(wei) / 1e18).toFixed(6)} MON`

console.log(
  JSON.stringify(
    {
      chainId,
      receiver,
      transmitter,
      preview: args.preview,
      calldata: args.calldata,
      eth_estimateGas: estimate.toString(),
      minGasWithRoundWritten: minGas.toString(),
      estimateMinusMin: (estimate - minGas).toString(),
      gasLimit: gasLimit.toString(),
      formula: 'ceil1000(ceil(minGasWithRoundWritten * 1.10))',
      probes,
      feeAtCurrentGasPrice: mon(fee),
    },
    null,
    2,
  ),
)
if (estimate < minGas) log(`NOTE: Monad's eth_estimateGas (${estimate}) is below the gas FxReference needs (${minGas}); the mock forwarder swallows the out-of-gas, so the estimate alone would write no round.`)
if (balance < fee) log(`WARNING: transmitter balance ${mon(balance)} is below one write's fee (${mon(fee)}); fund it before --broadcast.`)

if (args.write) {
  const next = { ...config, gasLimit: gasLimit.toString() }
  if (!config.receiverAddress) next.receiverAddress = receiver
  else if (!isAddress(config.receiverAddress) || getAddress(config.receiverAddress) !== receiver) {
    die(`config.receiverAddress is ${config.receiverAddress}, not --receiver ${receiver}; fix one of them (nothing written)`)
  }
  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`)
  log(`wrote gasLimit ${gasLimit}${config.receiverAddress ? '' : ` and receiverAddress ${receiver}`} to ${path.relative(process.cwd(), configPath)}`)
}
