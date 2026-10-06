# Plans: where gas limits come from

**The rule.** On Monad, every transaction gas limit must come from Monad's own estimator. That means `eth_estimateGas` on a Monad RPC, or a simulation on a Monad node (`eth_simulateV1`, or a search built on `eth_call`). A limit must never come from:

- a third-party quote,
- forge's local, Ethereum-priced simulation (revm), or
- a hard-coded constant that wasn't derived that way.

Monad charges the full gas **limit**, has no refunds, and prices cold state differently from Ethereum (see [GAS.md](GAS.md)).

Audited 2026-10-07. The audit covers every place in the repo that sets or implies a transaction gas limit: `contracts/`, `relayer/`, `indexer/`, `app/`, `marketing/tools`, `site/`, `brand/`, `scripts/` and `app-e2e-tools/`. Line numbers refer to the code after the fixes.

## Summary

| # | Where | Sends to | Gas limit source (before) | Verdict (before) | Now |
|---|---|---|---|---|---|
| 1 | `contracts/script/Deploy.s.sol:68` (`vm.startBroadcast`) with `forge script --broadcast` (contracts/README) | Monad mainnet / testnet | forge's local revm simulation × 130 % (`--gas-estimate-multiplier`) | **Violation** | Dry run only. `run()` reverts `BroadcastNotAllowed` on `--broadcast` unless the RPC is a local anvil. `script/monad-send.mjs` sends. |
| 2 | `contracts/README.md`, Deploy section | Monad | the README told users to `--broadcast` and to tune `--gas-estimate-multiplier 110` | **Violation** | Rewritten: dry run, then `monad-send.mjs check`, then `send` |
| 3 | `contracts/script/monad-send.mjs:80-104, 422` (new) | Monad | Monad `eth_estimateGas` from the deployer, no state override, + 10 %, rounded up to 1,000 | OK | `signWithMonadGas` refuses any quote that `monadGasQuote` didn't issue for that exact tx |
| 4 | `relayer/src/gas.ts:79` `gasLimitFor` (before: `withMargin > cap ? cap : withMargin`) | – | Monad estimate + margin, **clamped to the per-action cap** | **Violation** (a cap acted as a limit) | Clamp removed: the cap only rejects an estimate (`GAS_CAP_EXCEEDED`) |
| 5 | `relayer/src/relay.ts:129-155, 181` (`simulate` → `#send`) | Monad | viem `estimateGas` (→ `eth_estimateGas` on the configured RPC) from the lane + margin | Source OK, **not enforced** | `MonadGasEstimator.limitFor()` → `MonadGasLimit` |
| 6 | `relayer/src/lanes.ts:208-224` `LanePool.submit` → `signTransaction` | Monad | `gas: bigint`, any caller-supplied value | **Not enforced**: any bigint could be sent | `gas` must be a `MonadGasLimit`. `assertMonadGas` checks that it was issued by `MonadGasEstimator` on the pool's own RPC client, for this lane, `to`, `data` and `value`. Otherwise it throws before signing. |
| 7 | `relayer/src/faucet.ts:47, 77` (`requestFromFaucet`, `drip`) | Monad testnet | `relayer.sendInternal` → #5/#6 | OK through #5 | same; covered by `monad-gas.test.ts` |
| 8 | `relayer/src/longstop.ts:57` (`settle`) | Monad | `relayer.relay` → #5/#6 | OK through #5 | same |
| 9 | `relayer/src/demo/demo.ts:311, 318, 327, 351, 374, 407, 563`; `#fundFromFaucet` → faucet | Monad | `relayer.relay` / faucet → #5/#6 | OK through #5 | same |
| 10 | `relayer/src/app.ts:182` (`POST /v1/relay`) | Monad | `relayPrepared` → #5/#6 | OK through #5 | same |
| 11 | `contracts/script/monad-gas.mjs:380` (`anvil eth_sendTransaction`, `gas = anvil estimate × 2`, max 29 M) | **local anvil fork only** | anvil's Ethereum estimate | OK: not a Monad transaction. It records Ethereum traces for the Monad model and never reaches Monad. | Hardened: `assertLocalAnvil()` refuses to send unless `web3_clientVersion` is anvil, so `ANVIL_URL` can't point it at a live RPC |
| 12 | `contracts/script/monad-gas.mjs:760, 770` (live `eth_estimateGas`, `eth_simulateV1` with `gas` probes) | Monad, **read-only** | – (these probes *are* the Monad simulation that finds the minimal limit) | OK | – |
| 13 | `contracts/tools/ausd-relay-baseline.mjs:52` | Monad mainnet, **read-only** `eth_estimateGas` with a balance override | – (sends nothing) | OK | – |
| 14 | `contracts/tools/monad-model.mjs`, `live-check.mjs` | none (offline model / reads json) | – | OK | – |
| 15 | `relayer/test/integration/helpers.ts:65, 75` (`deployContract`, `writeContract`) | **local anvil (31337)**, test only | viem's auto-estimate on anvil | OK: test fixture on a local chain, not Monad | – |
| 16 | `relayer/src/fx.ts`, `eip712.ts`, `push.ts`, `listener.ts` | none | – (EIP-191/712 signatures and reads; no transactions) | OK | – |
| 17 | `app/` (`src/lib/chain/rpc.ts`, `src/lib/chain/actions.ts`, `modules/`, `plugins/`) | **never sends a transaction** | – | OK | Verified: no `signTransaction`, `sendTransaction`, `writeContract` or `eth_send*` anywhere in the app. `rpc.ts` is read-only (`readContract`). `actions.ts` signs EIP-712 / ERC-3009 messages and POSTs them to the relayer's `/v1/relay`, which sets the gas. |
| 18 | `indexer/` (Envio handlers, `scripts/sync-abis.mjs`, `queries/run.mjs`) | none | – | OK | – |
| 19 | `marketing/tools/` (`record-site.mjs`, `render-cast.mjs`, `day-*.sh`), `site/`, `brand/scripts/`, `scripts/`, `app-e2e-tools/` | none | – | OK | – |

## Details

### 1–3. Contract deployment

The original flow was `forge script script/Deploy.s.sol --broadcast`. forge simulates the script in its local EVM (revm, Ethereum pricing) and sets each transaction's limit to that simulation × 130 % (or the `--gas-estimate-multiplier`). This happens to overshoot for these three deployments: a deployment has no cold storage reads, so Monad and Ethereum price it about the same. But it is the wrong source, and because Monad charges the limit, the overshoot is paid in full. The table below shows the mainnet dry run of the final bytecode against `monad-send.mjs check` on mainnet (2026-10-07):

| Tx | forge's limit (revm × 1.3) | Monad `eth_estimateGas` | Monad limit (+10 %, ceil 1,000) |
|---|---:|---:|---:|
| KeyRegistry | 501,281 | 370,720 | 408,000 |
| PlansSend | 470,453 | 348,092 | 383,000 |
| PlansFactory (+ ClaimEscrow, Pot impl) | 11,581,792 | 8,511,434 | 9,363,000 |
| **Total** | **12,553,526** | 9,230,246 | **10,154,000** |

That is 2.40 M gas (≈ 0.30 MON at 127 gwei) that forge would have charged for nothing. On testnet, forge's values are different again (481,936 / 452,583 / 11,064,926), while Monad's estimates are the same to within 50 gas. For a transaction that touches cold state, the same approach would *under*-estimate. GAS.md measures Monad at up to 1.70× Ethereum for Plans actions, and that is how a swap failed in another project.

**Fix.**

- `Deploy.s.sol` stays the single source of what to deploy: the salts, the initcode, the order and the skip-if-deployed logic.
- `run()` now starts with `if (broadcasting && !_isAnvil()) revert BroadcastNotAllowed();`. A local anvil rehearsal still works.
- `script/monad-send.mjs` reads the dry-run file and validates every transaction. Each must be a CREATE2-deployer call whose address, recomputed from `salt ++ initcode`, matches forge's prediction and the `Deployment` returned by `run()`. The script ignores forge's `gas`, `nonce` and `from`.
- For each transaction whose address has no code yet, it calls `eth_estimateGas` on the Monad RPC from the deployer, with no state override. It sets `gasLimit = ceil1000(ceil(estimate × 1.1))`.
- In `send` mode it requires the fingerprint that `check` printed. It refuses a non-Monad chain id and an anvil, hardhat or ganache node. It refuses to start if the balance is below the total `limit × maxFee`.
- It re-estimates each transaction right before signing, then signs and sends with `eth_sendRawTransactionSync`, falling back to `eth_sendRawTransaction` plus receipt polling. It checks the receipt status and the code at the predicted address.
- At the end it verifies all five addresses and the factory's `ausd()`, `keyRegistry()`, `claimEscrow()` and `potImplementation()`, then writes `deployments/<chainid>.json`.

The key comes from `PLANS_DEPLOYER_KEY` or from `DEPLOYER` in `../secrets/keys.env`. It is never printed.

### 4–10. Relayer

Before the fix, the relayer already estimated on Monad, but nothing forced it to:

- `LanePool.submit()` took `gas: bigint`.
- `gasLimitFor` clamped the limit to the per-action cap, so a cap could *become* the limit.

**Fix** (`relayer/src/gas.ts`):

- `MonadGasLimit` is a class with private fields. Its constructor requires a module-private symbol, and every issued instance is recorded in a module-private `WeakSet`. Only `MonadGasEstimator.limitFor(action, {from, to, data, value})` creates one. That method calls `eth_estimateGas` on its RPC client (`[tx, "latest"]`), applies `ceil(estimate × (1 + GAS_MARGIN_BPS)) + GAS_MARGIN_FIXED`, and rejects an estimate above the action cap.
- Each limit remembers its RPC client and the exact transaction it was estimated for.
- `LanePool.submit(lane, { to, data, gas: MonadGasLimit, value? })` calls `assertMonadGas(gas, this.client, {from: lane.address, to, data, value})` before signing. A plain number, a look-alike object, a forged constructor call, a limit for another lane, target, calldata or value, and a limit from a different RPC client are all refused at runtime. TypeScript also refuses a `bigint` at compile time.
- `Relayer` builds its `MonadGasEstimator` on `pool.client`, the client the pool sends with, and `relay`/`sendInternal` both go through `simulate()` → `limitFor()` → `submit()`. The faucet, long-stop, demo members and `POST /v1/relay` have no other route to a transaction.
- Caps (`DEFAULT_GAS_CAPS`, `GAS_CAPS`, and 1,000,000 for an unknown action) are now only an upper bound on the Monad estimate. The limit is always the estimate plus the margin, even when that is above the cap.

**Behaviour change:**

- An estimate just under the cap used to be clamped to the cap. It now keeps its full margin.
- Estimates above the cap are still refused, as before.
- `Relayer.simulate()` now takes the action as its first argument and returns a `MonadGasLimit` instead of a `bigint`.

**Residual note.** The relayer estimates against the latest state before the transaction waits for its lane's mutex. If an earlier queued transaction on the same lane changes the state (rare: lanes are per-sender), the 10 % + 10,000 margin covers the usual drift. A larger change shows up as a revert or out-of-gas, which the relayer reports. It never falls back to a constant.

**Estimator and try/catch payouts** (see STATIC-ANALYSIS.md). `eth_estimateGas` returns the *lowest* gas at which a transaction succeeds. Before the Pot fix, a payout in `Pot._tryPay`/`_pull` that ran out of gas was swallowed by its try/catch. So for `payDebt` and escrow refunds after settlement, there was a gas range in which the transaction succeeded with a payout skipped. An estimator's search could land in that range, and so could anyone choosing the limit on purpose. `Pot` now reverts with `InsufficientGas()` when the caught failure left at most 1/63 of the gas it started with. The lowest succeeding gas is therefore always one where the payout went through, and estimator-derived limits are safe for these actions. GAS.md's live search avoids this independently: it counts a probe as a success only if it emits the same events as on anvil.

### 11–13. Measurement tooling

- `monad-gas.mjs` sends transactions **only to a local anvil fork**, to collect Ethereum traces that `monad-model.mjs` re-prices. Their limit (2 × anvil's estimate, at most 29 M) is never used on Monad. The script now checks that the node is anvil before its first send.
- Its live work is read-only: `eth_estimateGas` and a k-ary search over `eth_simulateV1` on the Monad RPC. That search is the Monad simulation the rule asks for, and it produced GAS.md's limits.
- `ausd-relay-baseline.mjs` is one read-only `eth_estimateGas` on Monad.

## Tests that enforce the rule

| Test | What fails it |
|---|---|
| `relayer/test/unit/monad-gas.test.ts` | Runs the real `Relayer`, `LanePool` and `Faucet` on a real viem client whose transport is a fake Monad RPC. The fake logs every `eth_estimateGas` (params and a fresh pseudo-random result) and every raw transaction. For `settle`, `execute`, `ausdTransfer`, `faucetRequest`, a faucet `drip`, and 6 concurrent relays across 2 lanes, it checks that each sent transaction's `gas` equals `ceil(estimate × 1.1) + 10,000`, where the estimate was made in the same request for the same sender, target and calldata at `latest`. It also checks that a cap rejects without sending, and that `submit` refuses a bigint, a look-alike, a forged constructor call, and a limit for a different calldata, target, value, lane or RPC. |
| `relayer/test/unit/gas-sources.test.ts` | Static scan of `relayer/src`, `contracts/script` and `contracts/tools`. It fails on any `gas:`, `gasLimit:` or `gas_limit:` key, and on any send primitive (`signTransaction`, `sendTransaction`, `writeContract`, `deployContract`, `eth_send*`, `startBroadcast`/`broadcast`, `--gas-limit`, `--gas-estimate-multiplier`), unless it is one of the reviewed lines in its allowlist. Each allowlist entry has a reason, and stale entries fail too. |
| `relayer/test/unit/lanes.test.ts`, `gas.test.ts` | Updated: lanes get their limits from `MonadGasEstimator`, and the old "capped at the cap" test now asserts the opposite (no clamp). |
| `contracts/script/monad-send.test.mjs` (`npm --prefix tools test`) | With a mocked Monad RPC, checks that every signed transaction's gas equals `gasLimitFromEstimate()` of the `eth_estimateGas` made just before it, for that exact sender, target and calldata, with no state override. It also checks that `check` sends nothing and prints every required field, that forge's dry-run gas never appears, that already-deployed transactions are skipped (and a second run sends nothing), and the `eth_sendRawTransaction` fallback. It checks refusals for: a wrong `--confirm`, an unfunded deployer, an anvil node, the wrong chain, a tampered or non-CREATE2 plan, and a forged or mismatched quote. It also checks that the deployer key is loaded without being exposed. |

A mutation check was run on each: hard-coding the limit, or removing `assertMonadGas`, makes these tests fail.
