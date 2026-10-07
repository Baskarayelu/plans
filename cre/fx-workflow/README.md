# Plans FX reference workflow (Chainlink CRE)

A Chainlink Runtime Environment (CRE) workflow, written with the TypeScript SDK, that publishes reference
FX rates to the `FxReference` contract on Monad (`contracts/src/FxReference.sol`). Plans shows these rates
on receipts and send screens. **They never price a transfer**: the AUSD amount that moves is always the
amount the sender signed, and `FxReference` never holds or moves funds.

```
cre/fx-workflow/                 CRE project root: run every `cre` command from here
├── project.yaml                 targets -> Monad RPCs
├── .env.example                 CRE_ETH_PRIVATE_KEY placeholder (copy to .env)
├── fx-rates/                    the workflow folder
│   ├── workflow.yaml            targets -> main.ts + config file
│   ├── main.ts                  SDK glue: cron, HTTP, consensus, report, writeReport
│   ├── src/                     pure logic: parsing, E8 maths, median, encoding, guards
│   ├── config.staging.json      Monad testnet (chain selector 2183018362218727504)
│   ├── config.production.json   Monad mainnet (chain selector 8481857512324358265)
│   ├── package.json, tsconfig.json
├── scripts/gas-limit.mjs        writeReport gas limit from Monad's estimator (read-only)
├── test/                        offline vitest suite + fixtures (golden report vector)
└── package.json                 test / typecheck / gas-limit tooling (npm)
```

The workflow is keyless, so there is no `secrets.yaml` (`secrets-path: ""` in `workflow.yaml`).

## What one run does

1. **Cron trigger**, `0 */30 * * * *` (every 30 minutes; 6 fields, the first is seconds; CRE's minimum
   interval is 30 s). On a deployed DON, `scheduledTime` is the trigger's scheduled execution time.
   It is capped at DON time (`runtime.now()`); the host clock is never read. The cap matters in
   simulation (see below).
2. **Each node, in `runInNodeMode`**, makes at most 4 HTTP GETs (CRE quota: 15; each response must
   be under 250 KB):

   | Bit | Source | URL (final, no redirects) | Currencies |
   |---|---|---|---|
   | 0 (1) | Frankfurter v2, ECB provider only | `https://api.frankfurter.dev/v2/rates?base=USD&quotes=GBP,EUR,INR,JPY,CHF,SGD&providers=ecb` | GBP EUR INR JPY CHF SGD |
   | 2 (4) | Frankfurter v2, central-bank blend | `https://api.frankfurter.dev/v2/rates?base=USD&quotes=AED,NGN` | AED NGN (the ECB publishes neither) |
   | 1 (2) | fawazahmed0 currency-api | `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json`, falling back to `https://latest.currency-api.pages.dev/v1/currencies/usd.json` | all 8 |

   `api.frankfurter.app` answers with a 301 redirect, and CRE's HTTP capability does not follow
   redirects, so it is never used.

   For each currency, in the fixed order GBP, EUR, INR, NGN, JPY, CHF, AED, SGD, the node:
   - converts each source's units-per-USD into USD-per-unit with 8 decimals, as a `bigint`:
     `round(10^8 / rate)`, rounding half up. It uses exact decimal arithmetic on the published
     digits, with no floating-point multiplication.
   - takes the median of the available sources, and drops every source more than `maxSpreadBps`
     (default 200, i.e. 2 %) from that median.
   - if at least 2 sources remain, takes the median of the rest. The source mask is the OR of their
     bits. Otherwise the currency is **absent** (rate 0, mask 0).

   With two sources, the median is their mean, so each one sits half the gap away. Two sources are
   therefore rejected when they differ by more than about 4 %.

   `rateDate` is the newest source date (yyyymmdd) among the sources behind a present rate.
3. **Consensus across nodes** (`ConsensusAggregationByFields`): `median` for each of the 8 rates, and
   `identical` (a Byzantine quorum of nodes must agree) for each mask and for `rateDate`. In DON mode
   the result is then reconciled: a currency is present only if its median rate is non-zero **and**
   its agreed mask names at least 2 known sources.
4. **Guards against the contract's state.** The workflow reads `lastScheduledTime()`, `maxMoveBps()`
   and `lastRates()` from `FxReference` and:
   - stops if `scheduledTime` would be a replay;
   - leaves out (marks absent) any currency that moved more than `maxMoveBps` (10 % by default)
     since the last accepted round. Otherwise `FxReference` would revert the **whole** round with
     `RateMoveTooLarge`.
   - stops if no currency is left.
5. **Report.** The workflow ABI-encodes the payload exactly as `FxReference` decodes it (see the next
   section), then calls `runtime.report(...)` (`evm` / `ecdsa` / `keccak256`) and
   `EVMClient.writeReport` to `receiverAddress` on `monad-testnet` with `gasConfig.gasLimit` from the
   config. It checks both `txStatus` and `receiverContractExecutionStatus`, and fails the run if
   `onReport` reverted.

## Report format

```solidity
abi.encode(
    uint64   chainSelector,  // CCIP selector of the target chain (cross-chain replay guard)
    uint64   scheduledTime,  // unix seconds; strictly increasing (same-chain replay guard)
    uint32   rateDate,       // yyyymmdd
    bytes3[] currencies,     // exactly "GBP","EUR","INR","NGN","JPY","CHF","AED","SGD"
    uint64[] usdPerUnitE8,   // USD per 1 unit, 8 decimals; 0 = absent this round
    uint8[]  sourceMasks     // bit 0 Frankfurter/ECB, bit 1 currency-api, bit 2 Frankfurter blend;
)                            // >= 2 bits for a present rate, 0 for an absent one
```

`FxReference` also requires `scheduledTime <= block.timestamp + 300`, at least one present rate, and
each rate within `maxMoveBps` of the last accepted rate for that currency.

`test/fixtures/report-vector.json` is a golden vector for this format. Its inputs were computed
independently (Python `Decimal`) from the fixture HTTP bodies, and its bytes come from
`cast abi-encode`. The TypeScript encoder must reproduce it byte for byte (`npm test`).
`contracts/test/unit/FxReferenceCre.t.sol` delivers the same bytes to `FxReference.onReport` and
checks every stored value.

## Sources and licences

- **Frankfurter** (api.frankfurter.dev): free, keyless, "free for commercial use", rate-limited
  only to prevent abuse. The server code is MIT. The `providers=ecb` query returns the ECB's euro
  reference rates rebased to USD. The default v2 query blends central-bank rates, and the workflow
  uses that only for AED and NGN, which the ECB does not publish. The ECB itself states that its
  reference rates are "for information purposes only"; that is one more reason Plans uses them as
  reference data only.
- **fawazahmed0 currency-api**: CC0-1.0 (public domain), no rate limits, updated daily. jsDelivr can
  lag the pages.dev mirror by a day.
- **ExchangeRate-API's open endpoint (open.er-api.com) is deliberately not used.** Its terms allow
  caching for your own conversions but say its data may not be redistributed. A rate written to a
  public chain is redistributed to everyone, so it cannot feed `FxReference`. `parseConfig` refuses
  it as a source URL.

## What you can truthfully claim

> Plans' FX reference rates are produced by a Chainlink CRE workflow (TypeScript SDK). Each run
> fetches ECB rates (via Frankfurter), central-bank rates for AED/NGN (Frankfurter) and the CC0
> currency-api over CRE's HTTP capability, takes a per-currency median with outlier rejection
> (at least 2 agreeing sources), and encodes a round with the chain selector and the scheduled time.
> Using `cre workflow simulate --broadcast`, the report is delivered through Chainlink's
> MockKeystoneForwarder on Monad testnet to our `FxReference` contract (tx `<hash>`). The rates are
> for display and receipts and never change an amount that moves.

You must also say:

- **Simulation runs on a single node** on your machine. DON consensus and DON signature checks are
  *simulated*: no quorum is formed and the mock forwarder verifies no signatures.
- **The contract's simulation-mode check is a demo guard.** The MockKeystoneForwarder is
  permissionless, so `FxReference` accepts a round only if `tx.origin` equals `simTransmitter`. A
  round written this way is as trustworthy as that one key and that one machine.

Do **not** claim "secured by a Chainlink DON", "Chainlink price feed" or "decentralized oracle live
on Monad" unless the workflow is actually deployed to a DON and `FxReference` is in production mode
(see the last section).

## Running it (Monad testnet)

Prerequisites: a CRE account, the **CRE CLI >= 1.30.0** (Monad testnet support), **Bun >= 1.2.21**,
Node >= 22.18 (for the tests and the gas tool), and a Monad testnet wallet with some MON.

```bash
# 1. CLI and Bun
curl -sSL https://app.chain.link/cre/install.sh | bash     # then: cre version  (>= 1.30.0; `cre update` to upgrade)
curl -fsSL https://bun.sh/install | bash                   # bun --version >= 1.2.21
cre login                                                  # browser login; check with `cre whoami`

# 2. Dependencies (from the repo root)
cd cre/fx-workflow
npm install                       # tests + gas tool (vitest, viem, typescript)
(cd fx-rates && bun install)      # workflow deps; postinstall runs `bunx cre-setup` (WASM toolchain)
npm test                          # offline unit tests
```

3. **Key.** `cp .env.example .env` and set `CRE_ETH_PRIVATE_KEY` to the 64-hex-character key,
   **without** `0x`, of the funded Monad testnet wallet. Its address **must equal**
   `FxReference.simTransmitter()`: the deploy script takes that from `FX_SIM_TRANSMITTER`, and the
   owner can change it later with `setSimulationMode(address)`. Never commit `.env`.

4. **Receiver.** After deploying (`contracts/`, see contracts/README), take the `fxReference` address
   from `contracts/deployments/10143.json`. Put it in `fx-rates/config.staging.json` as
   `receiverAddress`, or let step 5 fill it in.

5. **Gas limit (from Monad's estimator only).** `gasLimit` is empty on purpose, and the workflow
   refuses to start without it. Run:

   ```bash
   node scripts/gas-limit.mjs --receiver <fxReference> --transmitter <simTransmitter address> --write
   ```

   The script is read-only. It checks that the RPC is Monad (chain id 10143 or 143), that the
   receiver is an `FxReference` in simulation mode with that transmitter, and that the chain
   selector matches. It then builds the exact transaction the simulator sends,
   `MockKeystoneForwarder.report(receiver, rawReport, reportContext, signatures)`, around a real
   payload (live rates, `scheduledTime` = latest block time), and asks Monad's `eth_estimateGas` for
   it. The mock forwarder swallows a failing `onReport`, so the outer transaction can succeed even
   when the round was not written. The script therefore searches with `eth_simulateV1` for the
   smallest gas whose logs contain `RoundWritten`, and writes
   `gasLimit = ceil1000(ceil(min * 1.10))` into the config. Monad bills the full gas limit, so the
   limit should stay tight. Re-run the script after redeploying, or if the contract changes.
   `--preview` gives a number before deployment by overlaying the contract code on a placeholder
   address; it refuses `--write`.

6. **Dry run, then broadcast** (from `cre/fx-workflow`):

   ```bash
   cre workflow simulate fx-rates --target staging-settings --non-interactive --trigger-index 0
   cre workflow simulate fx-rates --target staging-settings --non-interactive --trigger-index 0 --broadcast
   ```

   - The dry run makes real HTTP calls and RPC reads, but its write is not sent (tx hash `0x000…0`).
   - `--broadcast` sends one real transaction from your `CRE_ETH_PRIVATE_KEY` wallet to the Monad
     testnet MockKeystoneForwarder `0xB9F79d863261869B234c481D1f9A7af84AeAd192`, which calls
     `FxReference.onReport`.
   - Use `--non-interactive --trigger-index 0`. Without it, the simulator's cron trigger waits for
     the next scheduled slot (up to 30 minutes) unless you press Enter.

   The simulator's cron payload carries the schedule's **next** run time, not the current time. The
   workflow therefore caps `scheduledTime` at DON time, which in simulation is the local time.
   Without the cap, `FxReference` would reject most runs with `FutureReport`.

7. **Confirm the round onchain:**

   ```bash
   RPC=https://testnet-rpc.monad.xyz; FX=<fxReference>
   cast call $FX "latestRoundTime()(uint64,uint64)" --rpc-url $RPC            # round id, scheduledTime
   cast call $FX "latestRound()((uint64,uint64,uint64,uint32,uint8,bytes3[],uint64[],uint8[]))" --rpc-url $RPC
   cast call $FX "rateOf(uint64,bytes3)(uint64)" 1 0x474250 --rpc-url $RPC   # GBP in round 1, 8 decimals
   cast receipt <txHash> --rpc-url $RPC                                       # logs: RoundWritten, then the mock's ReportProcessed
   cast logs --address $FX 0x8476deb7dae7ccbca73276a9dc7a676dd3d71d7dd028588e95c88c4c111a233e \
     --from-block <block of txHash> --rpc-url $RPC                            # RoundWritten
   ```

   A transaction that emits `ReportProcessed(..., result=false)` and no `RoundWritten` means
   `onReport` reverted. Common causes: a wrong transmitter key, a replay, or a too-low gas limit
   (re-run step 5).

**Staleness rule:** PlansSend and Pot treat a round whose `scheduledTime` is older than **6 hours**
(`MAX_FX_AGE`) as stale. A send that quotes a stale round reverts with `FxRoundStale`, and a pot
settles with `fxRoundId = 0`. Nothing runs on a schedule in simulation, so **run a `--broadcast`
simulation shortly before a demo** (and again if the demo is more than 6 h later).

## Tests

```bash
npm test             # vitest, offline (fixture HTTP bodies, no network)
npm run typecheck    # the workflow against the real @chainlink/cre-sdk types, and the tests
cd ../../contracts && forge test --match-path test/unit/FxReferenceCre.t.sol   # Solidity side of the golden vector
```

## Moving to production mode later

Production means the workflow runs on a Chainlink DON and `FxReference` accepts only reports that
the production KeystoneForwarder has verified (f+1 DON signatures), carrying the expected workflow
id and owner.

1. **Deploy access.** `cre workflow deploy` needs approval: run `cre account access` to request it.
2. **Deploy the workflow.** Use `cre workflow deploy fx-rates --target staging-settings` for Monad
   testnet; set `deployment-registry` in `workflow.yaml` if you use the private registry. Note:
   - the **Workflow ID** and the **Owner Address** the CLI prints;
   - the workflow ID **changes on every update**, so repeat step 3 after each redeploy.
3. **Switch the contract.** As the `FxReference` owner, call
   `setProductionMode(0xF8344CFd5c43616a4366C34E3EEE75af79a74482, <workflowId>, <workflowOwner>)`.
   That is the Monad testnet KeystoneForwarder; on mainnet it is
   `0x76c9cf548b4179F8901cda1f8623568b58215E62`. Sending this owner transaction follows the
   repository's gas rule (contracts/GAS-LIMITS.md).
4. **Gas limit.** The production path goes through the KeystoneForwarder, which verifies signatures,
   so it costs more than the mock path that `scripts/gas-limit.mjs` measures. The script refuses a
   contract in production mode. Measure the production limit with Monad's estimator against a real
   signed report before relying on it, and do not reuse the simulation number blindly.

`setSimulationMode(transmitter)` switches back. In production mode the mock forwarder can never
deliver, whatever the transmitter.
