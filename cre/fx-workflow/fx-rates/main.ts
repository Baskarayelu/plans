// Plans FX reference workflow (Chainlink CRE, TypeScript SDK).
//
// Cron -> each node fetches 3 keyless FX sources and takes a cross-source median per currency
// (runInNodeMode) -> the DON aggregates the node results (median per rate, quorum on masks/date)
// -> FxReference's state is read (replay time, move limit) -> the round is ABI-encoded exactly as
// FxReference decodes it -> runtime.report -> EVM writeReport to FxReference on Monad.
// All pure logic lives in ./src (unit-tested with vitest in ../test).

import {
  bytesToHex,
  ConsensusAggregationByFields,
  type CronPayload,
  CronCapability,
  EVMClient,
  encodeCallMsg,
  getNetwork,
  handler,
  hexToBase64,
  HTTPClient,
  identical,
  LATEST_BLOCK_NUMBER,
  median,
  type NodeRuntime,
  Runner,
  type Runtime,
  TxStatus,
} from '@chainlink/cre-sdk'
import { EVM_PB } from '@chainlink/cre-sdk/pb'
import { decodeFunctionResult, encodeFunctionData, zeroAddress } from 'viem'
import { computeRound } from './src/collect.ts'
import { type Config, parseConfig } from './src/config.ts'
import { CURRENCIES, MAX_RESPONSE_BYTES } from './src/constants.ts'
import { formatE8 } from './src/decimal.ts'
import { applyOnchainGuards, FX_REFERENCE_VIEWS, type OnchainState } from './src/guards.ts'
import { type NodeObservation, observationToRound, roundToObservation, scheduledTimeSeconds } from './src/observation.ts'
import { encodeReport, type FxReport } from './src/report.ts'

// ───────────────────────────── node mode ─────────────────────────────

const observeRates = (nodeRuntime: NodeRuntime<Config>): NodeObservation => {
  const cfg = parseConfig(nodeRuntime.config)
  const http = new HTTPClient()
  const get = (url: string): string => {
    const resp = http.sendRequest(nodeRuntime, { url, method: 'GET' }).result()
    if (resp.statusCode !== 200) throw new Error(`HTTP ${resp.statusCode} from ${url}`)
    if (resp.body.length > MAX_RESPONSE_BYTES) throw new Error(`response from ${url} exceeds ${MAX_RESPONSE_BYTES} bytes`)
    return new TextDecoder().decode(resp.body)
  }
  const round = computeRound(get, cfg.urls, cfg.maxSpreadBps, (m) => nodeRuntime.log(m))
  return roundToObservation(round)
}

const consensus = ConsensusAggregationByFields<NodeObservation>({
  r0: median,
  r1: median,
  r2: median,
  r3: median,
  r4: median,
  r5: median,
  r6: median,
  r7: median,
  m0: identical,
  m1: identical,
  m2: identical,
  m3: identical,
  m4: identical,
  m5: identical,
  m6: identical,
  m7: identical,
  rateDate: identical,
})

// ───────────────────────────── DON mode ─────────────────────────────

/** Reads the FxReference state the report must respect (replay time, move limit, last rates). */
const readOnchainState = (runtime: Runtime<Config>, evm: EVMClient, receiver: `0x${string}`): OnchainState => {
  const call = (data: `0x${string}`): `0x${string}` =>
    bytesToHex(
      evm
        .callContract(runtime, {
          call: encodeCallMsg({ from: zeroAddress, to: receiver, data }),
          blockNumber: LATEST_BLOCK_NUMBER,
        })
        .result().data,
    )
  const abi = FX_REFERENCE_VIEWS
  const lastScheduledTime = decodeFunctionResult({
    abi,
    functionName: 'lastScheduledTime',
    data: call(encodeFunctionData({ abi, functionName: 'lastScheduledTime' })),
  })
  const maxMoveBps = decodeFunctionResult({
    abi,
    functionName: 'maxMoveBps',
    data: call(encodeFunctionData({ abi, functionName: 'maxMoveBps' })),
  })
  const lastRates = decodeFunctionResult({
    abi,
    functionName: 'lastRates',
    data: call(encodeFunctionData({ abi, functionName: 'lastRates' })),
  })
  return { lastScheduledTime, maxMoveBps: Number(maxMoveBps), lastRates: [...lastRates] }
}

const onCron = (runtime: Runtime<Config>, payload: CronPayload): string => {
  const cfg = parseConfig(runtime.config)

  const network = getNetwork({ chainFamily: 'evm', chainSelectorName: cfg.chainName })
  if (!network) throw new Error(`unknown chain ${cfg.chainName}: needs @chainlink/cre-sdk >= 1.19.0`)
  if (network.chainSelector.selector !== cfg.chainSelector) throw new Error('chain selector mismatch between SDK and config')
  const evm = new EVMClient(network.chainSelector.selector)

  const { seconds: scheduledTime, source } = scheduledTimeSeconds(payload.scheduledExecutionTime?.seconds, () => runtime.now())
  runtime.log(`scheduledTime ${scheduledTime} (${source === 'trigger' ? 'cron payload' : 'DON time: payload time absent or in the future'})`)

  const obs = runtime.runInNodeMode(observeRates, consensus)().result()
  const aggregated = observationToRound(obs as unknown as Record<string, unknown>)

  const { round, dropped } = applyOnchainGuards(aggregated, scheduledTime, readOnchainState(runtime, evm, cfg.receiverAddress))
  for (const d of dropped) runtime.log(`left out (move above FxReference.maxMoveBps): ${d}`)

  CURRENCIES.forEach((ccy, i) => {
    const rate = round.usdPerUnitE8[i]
    runtime.log(`${ccy}: ${rate === 0n ? 'absent' : `${formatE8(rate)} USD (sources mask ${round.sourceMasks[i]})`}`)
  })

  const report: FxReport = {
    chainSelector: cfg.chainSelector,
    scheduledTime,
    rateDate: round.rateDate,
    currencies: CURRENCIES,
    usdPerUnitE8: round.usdPerUnitE8,
    sourceMasks: round.sourceMasks,
  }
  const encoded = encodeReport(report) // validates against FxReference's payload rules first
  runtime.log(`report: rateDate ${round.rateDate}, ${(encoded.length - 2) / 2} bytes`)

  const signed = runtime
    .report({
      encodedPayload: hexToBase64(encoded),
      encoderName: 'evm',
      signingAlgo: 'ecdsa',
      hashingAlgo: 'keccak256',
    })
    .result()

  const write = evm
    .writeReport(runtime, {
      receiver: cfg.receiverAddress,
      report: signed,
      gasConfig: { gasLimit: cfg.gasLimit },
    })
    .result()

  const txHash = bytesToHex(write.txHash ?? new Uint8Array(32))
  runtime.log(`writeReport: tx ${txHash} txStatus ${write.txStatus} receiverStatus ${write.receiverContractExecutionStatus}`)
  if (write.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`writeReport transaction failed (status ${write.txStatus}): ${write.errorMessage ?? ''}`)
  }
  if (write.receiverContractExecutionStatus === EVM_PB.ReceiverContractExecutionStatus.REVERTED) {
    throw new Error(`FxReference.onReport reverted (tx ${txHash}); the round was not written`)
  }

  return JSON.stringify({
    txHash,
    scheduledTime: scheduledTime.toString(),
    rateDate: round.rateDate,
    usdPerUnitE8: Object.fromEntries(CURRENCIES.map((c, i) => [c, round.usdPerUnitE8[i].toString()])),
    sourceMasks: Object.fromEntries(CURRENCIES.map((c, i) => [c, round.sourceMasks[i]])),
  })
}

const initWorkflow = (config: Config) => {
  parseConfig(config) // refuse to start on a bad config (e.g. no gasLimit from Monad's estimator)
  return [handler(new CronCapability().trigger({ schedule: config.schedule }), onCron)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}
