# Stage A end-to-end tests

Every Plans flow and failure path, driven through the relayer's HTTP API with requests signed the way the app signs them. The run uses a local anvil fork of Monad mainnet and the real AUSD. Each run starts from scratch and repeats exactly.

## Run

```shell
npm --prefix e2e/stage-a install   # once
npm --prefix e2e/stage-a test
```

Prerequisites:

- Node 24 and Foundry 1.5 (`anvil` on `PATH`).
- `forge build` in `contracts/` (the harness reads `contracts/out`).
- `pnpm install && pnpm build` in `relayer/` (the harness runs `relayer/dist/index.js`).

A run takes about 2–3 minutes. The exit code is 0 only if every scenario passes. It writes:

- `REPORT.md`: pass/fail table with fork tx hashes and latency, findings, and what isn't covered.
- `results.json`: the same data, machine-readable.
- `.runs/<timestamp>/`: anvil and relayer logs.

Optional env: `FORK_URL` (default `https://rpc.monad.xyz`, read-only) and `FORK_BLOCK` (pin the fork).

## What it does

1. Starts `anvil --fork-url https://rpc.monad.xyz --code-size-limit 131072` on a free port (chain id 143).
2. Deploys KeyRegistry, PlansSend and PlansFactory through the canonical CREATE2 deployer with `Deploy.s.sol`'s salts and initcode, then checks the ClaimEscrow and Pot implementation addresses and the factory wiring. The harness does this itself rather than with `forge script --broadcast`, so it never writes `contracts/deployments/143-anvil.json` or touches `contracts/broadcast/Deploy.s.sol/143`.
3. Funds fresh throwaway actors with real AUSD by writing AUSD's ERC-7201 balance slots (`balance << 8 | frozen`, base `0x4557…b700`, totalSupply at `…b702`).
4. Starts two relayers on the fork, each with its own throwaway lane keys:
   - **main**: demo on, faucet, push and long-stop off, FX from a local frankfurter mock, rate limits raised;
   - **strict**: production body and rate limits, used for the limit tests.
5. Runs the scenarios in `scenarios/` in chain-time order. The fork's clock is moved forward with `evm_increaseTime` for timelocks, expiries, the dispute period and plan ends.
6. Checks invariants after each group:
   - Σ netOf = pot balance for every pot;
   - escrow balance = Σ open claims;
   - PlansSend holds 0;
   - AUSD is conserved across every tracked address, and totalSupply is unchanged;
   - a cleanly settled pot holds 0.

Every failure scenario also asserts three things:

- the HTTP status, code, SpendBlocked reason and Solidity error name;
- a plain-English message (no raw selectors);
- nothing changed onchain: no transaction reached the target, and a fingerprint of every pot, the escrow and all tracked balances is identical.

## Safety

- Transactions go only to the local anvil. `lib/env.ts` `sendLocal` refuses unless the node is `127.0.0.1` and `web3_clientVersion` says anvil. The live RPC is used only by anvil, read-only, for forking.
- All relayed gas limits come from the relayer's own `MonadGasEstimator`, which calls `eth_estimateGas` on the fork. The harness's few direct sends (deploys, one front-run permit) use anvil's `eth_estimateGas` + 10 %. The gas-griefing scenario plays an attacker: it picks the starved limit from an `eth_call` scan, never from a constant.
- Keys are generated fresh each run and are never printed. The relayer redacts its own keys.

## Signing like the app

`lib/plans.ts` imports these straight from `app/src/lib/chain/eip712.ts`, `nonces.ts` and `crypto/bytes.ts`:

- the EIP-712 builders (`typed.*`) and struct hashes;
- the 3009 nonce bindings (`sendAuthNonce`, `claimAuthNonce`);
- `codeToBytes`;
- the 248-bit-prefix `NonceAllocator`.

The demo join uses the app's `DEMO_SAFETY_NET` and `demoDeposit` from `app/src/lib/ending/demo.ts`.

`app/src/lib/chain/actions.ts` itself pulls in React Native config and the passkey session, so its glue (`receiveAuth`, `permitFor`, `keyRegFor`, the request bodies) is mirrored one for one. The one deliberate difference: deadlines come from the fork's clock, so they stay valid after time warps.

## Layout

| Path | What |
|---|---|
| `run.ts` | Setup, scenario order, report |
| `lib/env.ts` | anvil, deployment, AUSD funding, relayer processes, FX mock |
| `lib/plans.ts` | Relayer HTTP client and app-identical request builders |
| `lib/harness.ts` | Scenario runner, `rejects` (no-change check), invariants, time warps |
| `lib/report.ts` | REPORT.md writer |
| `scenarios/*.ts` | HTTP and limits, demo, KeyRegistry/PlansSend/send-by-link, Pot A lifecycle, other pots, time phase |
| `findings.ts` | Reviewed findings and the "not covered" list, rendered into the report |
