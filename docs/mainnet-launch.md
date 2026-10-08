# Monad mainnet launch runbook

This file is for the owner. Follow it top to bottom. Each step lists the exact commands to paste.

> **[OWNER]** marks the steps only you can do: sending funds, saying "go" to a `send`, and anything that needs an account login (Railway, Vercel, Envio, GitHub, the CRE CLI).
>
> Every other step is prepared and was rehearsed on an anvil fork of mainnet (see [Rehearsal](#rehearsal-on-a-mainnet-fork)).

## Rules for every step

- **Gas limits come from Monad.** Every gas limit is Monad's own `eth_estimateGas`, or a simulation on Monad, for the exact transaction, + 10 % rounded up to 1,000. Never forge's Ethereum-priced simulation, never a third-party quote. Never run `forge script --broadcast` against Monad: `Deploy.s.sol` refuses it.
- **Two steps per send.** Every script that sends has a `check` and a `send`.
  - `check` sends nothing. It prints every transaction, its Monad estimate, gas limit and maximum cost, the balances involved and a **fingerprint**.
  - `send --confirm <fingerprint>` rebuilds the plan. If anything differs from what `check` printed, it refuses, so run `check` again.
- **Fork-only gas.** The scripts accept anvil estimates only with `--fork`, and only from a local anvil. Against chain 143 they refuse to sign a limit that did not come from a Monad RPC.
- **Keys and secrets.**
  - Keys stay in `../secrets/keys.env`, outside the repository. The scripts read them and never print them.
  - Claim links, the judges' plan invite link and the group key are written only to `../secrets/` (mode 0600). They go into the submission portal only, never into this repository.
- **Shell.** The commands are zsh-safe: no comments after a command on the same line. Run them from the repository root (`plans/`) unless a step says otherwise.

## Contents

0. [One-time setup](#0-one-time-setup)
1. [Preflight and funds](#1-preflight-and-funds)
2. [Deploy the contracts](#2-deploy-the-contracts)
3. [Verify on Sourcify (MonadVision)](#3-verify-on-sourcify-monadvision)
4. [Record the deployment](#4-record-the-deployment)
5. [Fund the relayer lanes](#5-fund-the-relayer-lanes)
6. [Relayer: mainnet service](#6-relayer-mainnet-service)
7. [Indexer: mainnet](#7-indexer-mainnet)
8. [FX reference (Chainlink CRE) on mainnet](#8-fx-reference-chainlink-cre-on-mainnet)
9. [Demo members](#9-demo-members)
10. [Judges' plan](#10-judges-plan)
11. [Judge claim links](#11-judge-claim-links)
12. [App and site builds](#12-app-and-site-builds)
13. [Post-launch smoke checklist](#13-post-launch-smoke-checklist)
14. [After judging: return the funds](#14-after-judging-return-the-funds)

---

## 0. One-time setup

```shell
cd contracts
forge build
cd ..
npm --prefix contracts/tools install
npm --prefix e2e/stage-a install
npm --prefix app install
```

- `contracts/tools` has the viem that every script here uses.
- `e2e/stage-a` provides tsx. The judges' plan script uses it to run the app's own encryption and EIP-712 code.
- `app` provides that code's dependencies.

## 1. Preflight and funds

**1a. Rehearse first.** On the exact commit you will deploy, run the rehearsal on a mainnet fork. It takes about 2 minutes, uses throwaway keys and sends nothing to mainnet. It must end with `0 failed`.

```shell
node e2e/mainnet-prep/run.mjs
```

**1b. Preflight** (read-only).

```shell
node scripts/mainnet-preflight.mjs
```

It checks:

- the RPC is a Monad node on chain **143**;
- AUSD `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` has EIP-712 domain "Agora Dollar" / 1;
- the canonical CREATE2 deployer and Chainlink's MockKeystoneForwarder exist;
- each account's MON and AUSD balance against what the next steps need.

**1c. [OWNER: funds]** Send stage 1 from [funding.md](funding.md). Re-run 1b until it says `Ready`.

| Send | To |
|---|---|
| 15 MON | Deployer `0x44E61d9E73394EDEBAB7095D224B0a6185EDa4e3` |
| $8.00 AUSD | Treasury `0x0C2118133d7dFC751c326c86a5ddff5cF3846E35` |

Stage 2 is another **$4.00 AUSD** to the treasury, for the eight $0.50 judge claim links (step 11). It can come now or at step 11.

## 2. Deploy the contracts

Order and salts are the same as on testnet. `Deploy.s.sol` decides what to deploy, and `monad-send.mjs` sends it.

| # | Contract | How | Salt |
|---|---|---|---|
| 1 | `KeyRegistry()` | CREATE2 | `keccak256("plans.v1.KeyRegistry")` = `0xb21dc9b1…0415f` |
| 2 | `FxReference(owner, simForwarder, simTransmitter, chainSelector)` | CREATE2 | `keccak256("plans.v1.FxReference")` = `0xef7e02c0…14af4` |
| 3 | `PlansSend(ausd, fxReference)` | CREATE2 | `keccak256("plans.v1.PlansSend")` = `0x3e8989b4…32641` |
| 4 | `PlansFactory(ausd, keyRegistry, fxReference)` | CREATE2 | `keccak256("plans.v1.PlansFactory")` = `0x3aa3ec4a…a0662` |
| – | `ClaimEscrow(ausd)` | CREATE by the factory constructor (nonce 1) | – |
| – | `Pot` implementation | CREATE by the factory constructor (nonce 2) | – |

FxReference's owner and simulation transmitter are part of its initcode, so they fix every address. They are the deployer address, as on testnet. On chain 143 the forwarder is Chainlink's MockKeystoneForwarder `0x9eF6468C5f37b976E57d52054c693269479A784d`, with chain selector `8481857512324358265`.

**2a. Dry run and check** (sends nothing). Run this from `contracts/`:

```shell
cd contracts
source ../../secrets/addresses.env
export FX_OWNER=$DEPLOYER_ADDRESS FX_SIM_TRANSMITTER=$DEPLOYER_ADDRESS
forge build
forge script script/Deploy.s.sol --rpc-url monad --disable-code-size-limit --sender 0x000000000000000000000000000000000000dEaD
node script/monad-send.mjs check --chain 143
```

Verify every line `check` prints.

- **Chain and RPC:** chain id 143, rpc `https://rpc.monad.xyz`.
- **Deployer:** `0x44E61d9E…a4e3`.
- **Transactions:** 4 to send (KeyRegistry, FxReference, PlansSend, PlansFactory), each to the CREATE2 deployer.
- **FxReference:**
  - fx owner and fx transmitter are the deployer;
  - fx forwarder is `0x9eF6…784d`;
  - fx chain sel. is `8481857512324358265`.
- **Predicted addresses.** The rehearsal from the current source (8 Oct 2026, `e2e/mainnet-prep/results.json`) predicts these. If `check` prints different ones, the contracts changed since the rehearsal; re-run 1a.

  | Contract | Address |
  |---|---|
  | KeyRegistry | `0xf514925f5f781455E162148eA5BF3E8f5626d5bb` |
  | FxReference | `0xFE5d4b34333A320b7848E22E0E4Ef21470CA0522` |
  | PlansSend | `0x92C165CE160D531F175541803c60180664c7d5c2` |
  | PlansFactory | `0x95d2C8f7d71e9772506D972459771ed495945576` (+ ClaimEscrow `0x25f93d9214673c58B02DB1db71DA769B6116da0a`, Pot implementation `0x8D23FdA44DAeF78be1feb26D3e680Ec72ffD404D`) |

- **Gas:** total gas limit about 12.45 M, max cost about 1.58 MON at 127 gwei. On testnet, Monad estimated 370,720 / 1,488,393 / 804,719 / 8,657,657.
- **Balance after:** not "INSUFFICIENT".

**2b. [OWNER: go] Send.** Paste the `send` line that `check` printed, or set `FP` to its fingerprint:

```shell
FP=PASTE_FINGERPRINT_FROM_CHECK
node script/monad-send.mjs send --chain 143 --rpc https://rpc.monad.xyz --confirm $FP
cd ..
```

`send` does three things:

- It re-estimates each transaction on Monad right before signing and sends it.
- It checks the code at all six addresses and the wiring.
- It writes `contracts/deployments/143.json`, with the Monad estimate, gas limit and gas used of every transaction.

If it stops halfway, run 2a again. Deployed contracts are skipped, so a re-run is always safe.

## 3. Verify on Sourcify (MonadVision)

From `contracts/`, with the same source and `foundry.toml` that were deployed:

```shell
cd contracts
CHAIN=143
D=deployments/$CHAIN.json
KR=$(jq -r .keyRegistry $D); PS=$(jq -r .plansSend $D); FX=$(jq -r .fxReference $D)
PF=$(jq -r .plansFactory $D); CE=$(jq -r .claimEscrow $D); PI=$(jq -r .potImplementation $D)
export MONADSCAN_API_KEY=
SV=(--chain $CHAIN --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/ --watch)
forge verify-contract $KR src/KeyRegistry.sol:KeyRegistry "${SV[@]}"
forge verify-contract $FX src/FxReference.sol:FxReference "${SV[@]}"
forge verify-contract $PS src/PlansSend.sol:PlansSend "${SV[@]}"
forge verify-contract $PF src/PlansFactory.sol:PlansFactory "${SV[@]}"
forge verify-contract $CE src/ClaimEscrow.sol:ClaimEscrow "${SV[@]}"
forge verify-contract $PI src/Pot.sol:Pot "${SV[@]}"
cd ..
```

- `MONADSCAN_API_KEY` must be empty here. A non-empty value makes forge 1.5 silently switch to Etherscan.
- Check each result at `https://sourcify-api-monad.blockvision.org/v2/contract/143/<address>`.
- Monadscan (Etherscan v2) commands, with constructor arguments, are in [contracts/README.md](../contracts/README.md#monadscan-etherscan-v2).

## 4. Record the deployment

Commit `contracts/deployments/143.json`. It holds addresses and transaction hashes only, no secrets. The app build, the web build, the indexer config script and the ops scripts below all read it.

```shell
git add contracts/deployments/143.json
git commit -m "Monad mainnet deployment (chain 143)"
git push origin main
```

The addresses also go into README.md and the submission text (docs/submission.md, "WHAT IS ON MAINNET"); Claude can do that from 143.json.

## 5. Fund the relayer lanes

This tops up RELAYER_1..3 to 4 MON each from the deployer. The deployer keeps at least 1 MON for steps 9–11 and 14.

```shell
node scripts/fund-lanes.mjs check
```

**[OWNER: go]**

```shell
FP=PASTE_FINGERPRINT_FROM_CHECK
node scripts/fund-lanes.mjs send --confirm $FP
```

Options: `--each <MON>` and `--keep <MON>`. Three lanes keep each sender's gas well inside Monad's reserve-balance budget.

## 6. Relayer: mainnet service

**[OWNER: Railway login]** Create a **new** Railway service from `relayer/`, next to the testnet one; never repoint the testnet service.

- `railway.json` builds the Dockerfile.
- Add a volume at `/data`.
- Keep one replica.
- Add the custom domain `relayer.plans.0xo.in`, with a CNAME at Cloudflare, DNS only. That is the mainnet relayer URL the app builds in by default. If you use another URL, pass `PLANS_RELAYER_URL_MAINNET=<url>` to both builds in step 12.

Variables. Copy the key values by hand from `../secrets/keys.env` into Railway's variable editor. Never paste them into a terminal or a file in the repository.

| Variable | Mainnet value |
|---|---|
| `CHAIN_ID` | `143` |
| `RPC_URL` | empty: the default is `https://rpc.monad.xyz,https://rpc1.monad.xyz,https://rpc2.monad.xyz,https://rpc3.monad.xyz` |
| `WS_URL` | empty (`wss://rpc.monad.xyz`) |
| `FACTORY_ADDRESS` | `plansFactory` from 143.json |
| `PLANS_SEND_ADDRESS` | `plansSend` from 143.json |
| `KEY_REGISTRY_ADDRESS` | `keyRegistry` from 143.json (or empty: read from the factory) |
| `CLAIM_ESCROW_ADDRESS` | `claimEscrow` from 143.json (or empty) |
| `FX_REFERENCE_ADDRESS` | `fxReference` from 143.json (or empty) |
| `AUSD_ADDRESS` | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` (or empty) |
| `RELAYER_KEYS` | `RELAYER_1,RELAYER_2,RELAYER_3` values from keys.env, comma-separated, in that order |
| `DATA_DIR` | `/data` |
| `BLOB_DIR` | empty (`/data/blobs`) |
| `LISTENER_ENABLED` | `true` |
| `START_BLOCK` | the KeyRegistry `blockNumber` in 143.json (the first deploy transaction) |
| `LOG_CHUNK_BLOCKS` | `100` |
| `POLL_INTERVAL_MS` | `2000` |
| `GAS_MARGIN_BPS` / `GAS_MARGIN_FIXED` | `1000` / `10000`: the margin on Monad's own estimate |
| `GAS_CAPS` | empty |
| `PRIORITY_FEE_GWEI` / `MAX_FEE_GWEI` | `2` / `1000` |
| `LANE_MIN_BALANCE_WEI` | `500000000000000000` (0.5 MON) |
| `BODY_LIMIT_BYTES` | `65536` |
| `CORS_ORIGINS` | `https://plans.0xo.in` |
| `TRUST_PROXY` | `true` |
| `RATE_LIMIT_IP_PER_MIN` / `RATE_LIMIT_ADDRESS_PER_MIN` / `CREATE_POT_PER_IP_PER_DAY` | `120` / `30` / `30` |
| `FX_URL` / `FX_CACHE_MS` | `https://api.frankfurter.app/latest` / `600000` |
| `FX_SIGNER_KEY` | empty (lane 0 signs) |
| **`FAUCET_ENABLED`** | **`false`**. The faucet is also hard-off in code for chain 143 (`relayer/src/config.ts`). `FAUCET_ADDRESS`, `FAUCET_AMOUNT` and `FAUCET_PER_*` are unused on mainnet; leave them unset. |
| `PUSH_ENABLED` / `EXPO_PUSH_URL` / `EXPO_ACCESS_TOKEN` | `true` / default / empty unless Expo enhanced security is on |
| `WEB_PUSH_VAPID_PUBLIC` / `WEB_PUSH_VAPID_PRIVATE` | a **new mainnet** key pair (below); never reuse the testnet pair |
| `WEB_PUSH_SUBJECT` / `WEB_PUSH_APP_ORIGIN` | `https://plans.0xo.in` / `https://plans.0xo.in` |
| `DEMO_ENABLED` | `true` (after step 9) |
| `DEMO_KEY_BEN` / `DEMO_KEY_ASHA` / `DEMO_KEY_MAYA` | `DEMO_BEN` / `DEMO_ASHA` / `DEMO_MAYA` values from keys.env |
| `DEMO_APPROVE_CAP` | `1000000` ($1) |
| `DEMO_VOTE_DELAY_MIN_MS` / `DEMO_VOTE_DELAY_MAX_MS` / `DEMO_STEP_DELAY_MS` / `DEMO_TICK_MS` | `3000` / `8000` / `1500` / `1000` |
| `DEMO_DEPOSIT` / `DEMO_MAX_OUTLAY` / `DEMO_PLAN_MINUTES` | `100000` / `300000` / `15` |
| `DEMO_PER_JUDGE_PER_DAY` / `DEMO_PER_IP_PER_DAY` | `3` / `40` |
| `BLOB_MAX_BYTES` / `BLOB_DISK_CAP_BYTES` / `BLOB_PUT_PER_IP_PER_HOUR` / `SLOT_PUT_PER_IP_PER_HOUR` | defaults (`2097152` / `2147483648` / `60` / `60`) |
| `LONGSTOP_ENABLED` / `LONGSTOP_INTERVAL_MS` / `LONGSTOP_GRACE_DAYS` | `true` / `3600000` / `30` |
| `INDEXER_GRAPHQL_URL` | the mainnet GraphQL URL from step 7, published to the app at `GET /v1/config` |
| `HOST` / `PORT` / `LOG_LEVEL` | `0.0.0.0` / set by Railway / `info` |

**Mainnet web push key pair.** Generate it once and keep it in `../secrets/`, never in the repository:

```shell
npx web-push generate-vapid-keys --json > ../secrets/webpush-mainnet.json
chmod 600 ../secrets/webpush-mainnet.json
```

Check after deploying:

```shell
curl -s https://relayer.plans.0xo.in/v1/health
curl -s https://relayer.plans.0xo.in/v1/config
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://relayer.plans.0xo.in/v1/faucet -H "content-type: application/json" -d "{\"address\":\"0x0000000000000000000000000000000000000001\"}"
```

- `/v1/health` must show chain 143, all three lanes with MON and no `lowBalance`, the contract addresses, and status 200.
- `/v1/config` shows `chainId` 143 and the `graphqlUrl`.
- The faucet call must print `404`.

## 7. Indexer: mainnet

**7a. Fill the config** from 143.json, then commit it:

```shell
node indexer/scripts/mainnet-config.mjs
git add indexer/config.mainnet.yaml indexer/config.selfhost.mainnet.yaml
git commit -m "Indexer: mainnet addresses and start block from deployments/143.json"
git push origin main
```

This writes:

- `indexer/config.mainnet.yaml`, for Envio Cloud (HyperSync), with addresses and `start_block`;
- `indexer/config.selfhost.mainnet.yaml`, the same, reading Monad's public RPCs.

`--check` prints the result without writing.

`indexer/internal-accounts.json` already lists Ben, Asha, Maya, the treasury and the deployer. Add any team test accounts (the Agora video's "Leah" and "Sam") before real users arrive. Classification happens while indexing, so a later change means a redeploy.

**7b. [OWNER: Envio or Railway login]** Pick one.

- **Envio Cloud, slot 2.** In https://envio.dev/app, add an indexer from `Baskarayelu/plans`:
  - root directory `indexer`;
  - config file `config.mainnet.yaml`;
  - branch `main`.

  Free a slot first if both are taken. Get the GraphQL URL with `npx envio-cloud deployment endpoint <name> <commit>`, then promote the deployment.
- **Self-hosted on Railway.** Add three new services, next to the testnet ones:
  - Postgres;
  - Hasura;
  - the indexer from `indexer/` (its Dockerfile), with `ENVIO_CONFIG=config.selfhost.mainnet.yaml`.

  Use the same Hasura and Postgres variables as the testnet services (`../secrets/indexer-selfhost.env` holds the Hasura admin secret pattern). The public GraphQL URL is `https://<hasura service>/v1/graphql`.

**7c.** Point the clients at it, then check every app query against it:

- the mainnet relayer: `INDEXER_GRAPHQL_URL=<url>`;
- the site on Vercel: `NEXT_PUBLIC_ENVIO_GRAPHQL_URL=<url>` and `NEXT_PUBLIC_CHAIN_ID=143`, once /stats should show mainnet.

```shell
node indexer/queries/run.mjs PASTE_GRAPHQL_URL
```

## 8. FX reference (Chainlink CRE) on mainnet

FxReference is deployed in **simulation mode**. Rounds come from `cre workflow simulate --broadcast`, through Chainlink's MockKeystoneForwarder on mainnet, from the transmitter, which is the deployer. Production mode (a real DON, the KeystoneForwarder `0x76c9cf548b4179F8901cda1f8623568b58215E62`) needs CRE deploy access. It is a later owner transaction; see [cre/fx-workflow/README.md](../cre/fx-workflow/README.md#moving-to-production-mode-later). Until then, never describe FX as "secured by a Chainlink DON".

The production target is `production-settings` in `cre/fx-workflow/fx-rates/workflow.yaml`. It uses `config.production.json`: `monad-mainnet`, selector `8481857512324358265`.

**8a.** The receiver and the gas limit come from Monad's estimator and simulation (read-only). From `cre/fx-workflow`:

```shell
cd cre/fx-workflow
npm install
source ../../../secrets/addresses.env
FX=$(jq -r .fxReference ../../contracts/deployments/143.json)
node scripts/gas-limit.mjs --config fx-rates/config.production.json --receiver $FX --transmitter $DEPLOYER_ADDRESS --write
```

This writes `receiverAddress` and `gasLimit` into `fx-rates/config.production.json`. Commit that file; it holds no secrets.

**8b. [OWNER: CRE login and go]**

1. Put the deployer key in `cre/fx-workflow/.env` as `CRE_ETH_PRIVATE_KEY`: 64 hex characters, no `0x`. That file is git-ignored; never commit it.
2. Run the first command (a dry run) and check its output.
3. The second command sends **one mainnet transaction** (one FX round):

```shell
cre workflow simulate fx-rates --target production-settings --non-interactive --trigger-index 0
cre workflow simulate fx-rates --target production-settings --non-interactive --trigger-index 0 --broadcast
cd ../..
```

A round is "fresh" for 6 hours. Broadcast one shortly before a demo or the judging window, and again if more than 6 hours pass. Without a fresh round, sends and settlements still work, with `fxRoundId = 0`.

## 9. Demo members

This tops up Ben, Asha and Maya to $1.00 AUSD each from the treasury ([funding.md](funding.md), stage 1). The treasury signs ERC-3009 authorisations, and the deployer submits them and pays the gas.

```shell
node scripts/fund-demo.mjs check
```

**[OWNER: go]**

```shell
FP=PASTE_FINGERPRINT_FROM_CHECK
node scripts/fund-demo.mjs send --confirm $FP
```

Then set `DEMO_ENABLED=true` on the mainnet relayer.

## 10. Judges' plan

Maya creates "Metropolis Judges' Trip" with the app's **Pilot** rules: instant spends up to $0.25, one approval up to $1, no review window. It ends 31 Oct 2026, 23:59 UTC. Ben and Asha join.

The amounts follow funding.md: $1.00 in total (Maya $0.40, Ben $0.30, Asha $0.30). docs/submission.md currently says "a judges' plan holding $2"; see [Open points](#open-points).

The plan meta and the invite key wrap are encrypted with the app's own code, so the app reads the plan like any other. The demo members sign; the deployer pays the gas.

```shell
node scripts/judges-plan.mjs check
```

`check` simulates `createPot` and both joins on Monad (`eth_simulateV1`).

**[OWNER: go]**

```shell
FP=PASTE_FINGERPRINT_FROM_CHECK
node scripts/judges-plan.mjs send --confirm $FP
```

- **Output.** The invite link `https://plans.0xo.in/j/<plan>#s=…&n=Maya` is written to `../secrets/judges-plan-143-<time>.json`, together with the group key. It goes into the portal's judge field only.
- **Options.** For $2.00 in total: `--deposits 0.70,0.65,0.65`. Top the demo members up first with `node scripts/fund-demo.mjs check --target 1.35`. That leaves each about $0.65 after the plan, enough for "Try a settle-up" runs. Other options: `--name` and `--end <ISO>`.

## 11. Judge claim links

**[OWNER: funds]** Stage 2: $4.00 AUSD to the treasury, if it hasn't arrived yet.

```shell
node scripts/claim-links.mjs check
```

The defaults are 8 links × $0.50, expiring 2026-10-31T23:59:59Z, which matches the submission text "Unclaimed links return to the sender after 31 Oct".

**[OWNER: go]**

```shell
FP=PASTE_FINGERPRINT_FROM_CHECK
node scripts/claim-links.mjs send --confirm $FP
```

- **Where the links go.** They are written to `../secrets/claim-links-143-<time>.json` (mode 0600) and never printed. Each key is saved **before** its transaction is sent. Paste the `url` values into the portal's judge field only.

  ```shell
  jq -r '.links[].url' ../secrets/claim-links-143-*.json
  ```

- **Options.** `--count`, `--amount`, `--expiry`, `--sender-name` (default "Plans").
- **Pilot.** Use the same script for the pilot links: $0.50 per confirmed pilot user, stage 3. Example: `--count 12 --expiry 2026-10-31T23:59:59Z`.
- **Unclaimed links do not return by themselves.** `ClaimEscrow.refund` is permissionless, but nothing calls it automatically. Step 14 refunds every expired link.

## 12. App and site builds

**APK.** The mainnet build is "Plans", package `in.oxo.plans`, chain 143. It reads the addresses from `contracts/deployments/143.json`, so build after step 4.

```shell
app/scripts/build-apk.sh mainnet release
shasum -a 256 app/dist/plans-mainnet-release.apk
```

**[OWNER: GitHub]** Publish the APK as `plans.apk`, then fill in the release record.

```shell
cp app/dist/plans-mainnet-release.apk /tmp/plans.apk
gh release create v1.0.0 /tmp/plans.apk --repo Baskarayelu/plans --title "Plans 1.0.0 (Monad mainnet)" --notes "Plans for Monad mainnet."
```

- The download page uses `releases/latest/download/plans.apk`. So the testnet releases must stay **pre-releases**, or "latest" would point at a release without `plans.apk`.
- Then edit `site/public/release.json`: the mainnet entry's `sha256` (lowercase hex) and `sizeBytes` (`stat -f %z /tmp/plans.apk`), plus `version` and `publishedAt`. Commit.

**Web app** (plans.0xo.in/app). It serves one network at a time. **[OWNER: decide]** when `/app` switches from testnet to mainnet. Then deploy from a clean checkout of the committed HEAD:

```shell
PLANS_WEB_NETWORK=mainnet scripts/deploy-site.sh
```

Without the variable it builds testnet, as before. A mainnet web build:

- refuses to run without `contracts/deployments/143.json`;
- checks that the bundle carries the mainnet relayer URL.

For a local check only: `app/scripts/build-web.sh mainnet /tmp/plans-web`.

**Site stats.** On Vercel, set `NEXT_PUBLIC_CHAIN_ID=143` and `NEXT_PUBLIC_ENVIO_GRAPHQL_URL=<mainnet GraphQL>` (step 7c), then redeploy.

## 13. Post-launch smoke checklist

Tick each one on mainnet. Use a team test phone; its account goes into `indexer/internal-accounts.json`.

- [ ] `node scripts/mainnet-preflight.mjs` shows all six contracts "deployed".
- [ ] Sourcify shows all six verified.
- [ ] MonadVision shows the deploy transactions from the deployer.
- [ ] Relayer checks:
  - [ ] `/v1/health` returns 200, chain 143, 3 lanes funded.
  - [ ] `/v1/config` has chain 143 and the graphql URL.
  - [ ] `POST /v1/faucet` returns 404.
- [ ] The indexer has synced past the deploy block. `node indexer/queries/run.mjs <url>` passes.
- [ ] A fresh `in.oxo.plans` install:
  - [ ] create an account (one passkey prompt);
  - [ ] the app shows no "not deployed yet" states.
- [ ] Claim link: open one link from step 11 on the test phone.
  - [ ] The balance shows $0.50 within about a second.
  - [ ] The link shows as claimed.
- [ ] Judges' plan: open the invite link from step 10 and join.
  - [ ] The plan reads "Metropolis Judges' Trip" with Ben, Asha and Maya.
  - [ ] Add $0.25.
  - [ ] Pay $0.10, instant.
  - [ ] Propose $0.40: Ben approves within about 10 s.
- [ ] Send $0.05 to Asha. The receipt shows both currencies; with a fresh round from step 8, it shows the reference rate.
- [ ] "Try a settle-up" completes, and Settle up pays everyone in one transaction.
- [ ] Push and web push arrive for an approval and for a settle-up.
- [ ] The site at https://plans.0xo.in/download offers the mainnet APK, with the SHA-256 matching `shasum`.
- [ ] `/.well-known/assetlinks.json` lists `in.oxo.plans`.
- [ ] `/stats` shows mainnet counts once `NEXT_PUBLIC_CHAIN_ID=143` is set.
- [ ] docs/funding.md ledger and docs/submission.md: replace the pending markers with real addresses and transaction hashes (Claude can do this from 143.json and the secrets files' tx hashes; no links or secrets).
- [ ] Report the treasury and deployer balances: `node scripts/mainnet-preflight.mjs`.

## 14. After judging: return the funds

One command, two steps. It does three things, in order:

- refunds every **expired** open claim link whose source is one of our accounts;
- moves all AUSD from the relayer lanes, demo members and test accounts to the **treasury**;
- moves all their MON to the **deployer**.

The AUSD moves are ERC-3009 authorisations submitted by the deployer, so those accounts send nothing themselves.

**[OWNER]** First **stop the mainnet relayer service** on Railway. Its lanes must send nothing during the sweep.

To keep the demo running while judging continues, add `--except DEMO_BEN,DEMO_ASHA,DEMO_MAYA` to both commands.

```shell
node scripts/return-funds.mjs check
```

**[OWNER: go]**

```shell
FP=PASTE_FINGERPRINT_FROM_CHECK
node scripts/return-funds.mjs send --confirm $FP
```

- **Test accounts.** Add any test account's key to `../secrets/keys.env` under a new name such as `TEST_LEAH=…`. Every 32-byte key in the file except the deployer and the treasury is swept.
- **Monad's reserve-balance rule.** An undelegated account can spend below its 10 MON reserve only in an "emptying" transaction: one sent when it has sent nothing in the previous k = 3 blocks. So `send`:
  - moves MON as each account's **only** transaction;
  - first waits until no account's nonce has moved for k + 1 blocks (it stops if one moves);
  - refuses EIP-7702-delegated accounts.
- **What stays behind.** Monad charges the full gas **limit**, so each sweep sends balance − gasLimit × maxFee. About 0.0006 MON per account stays behind (24,000 gas × 25 gwei).
- **What can't come back yet.** Claim links that have not expired are listed, but can't be recovered until they expire; run it again afterwards. The judges' plan's $1.00 belongs to the plan. It comes back to Maya, Ben and Asha when the plan settles (anyone can press Settle up after 31 Oct, or the relayer's long-stop does it 30 days later). Then run `return-funds` again to bring it to the treasury.
- **Report.** The final lines print every account's balance. Record the treasury balance in the ledger in docs/funding.md.

---

## Rehearsal on a mainnet fork

`node e2e/mainnet-prep/run.mjs` ([README](../e2e/mainnet-prep/README.md)) runs steps 2, 5, 9, 10, 11 and 14 on a local anvil fork of mainnet with real AUSD, using throwaway keys. Each step runs as `check` and then `send --confirm`, and the result is asserted onchain. Last run, 8 Oct 2026: **50 passed, 0 failed**.

| Step | Result on the fork |
|---|---|
| Deploy (2) | All 6 contracts deployed and wired. The addresses are listed in 2a. A re-run sends nothing, and `contracts/deployments/143.json` is untouched. |
| Relayer lanes (5) | All three lanes at 1.3 MON. |
| Demo members (9) | Ben, Asha and Maya at $1.00. |
| Claim links (11) | 8 × $0.50 open, signer = link key. Link 1 claimed with its key. |
| Judges' plan (10) | The plan holds $1.00, with Maya, Ben and Asha as members. |
| Return funds (14) | 7 expired links refunded. The treasury holds everything except the plan's $1.00, and every other account and the escrow hold $0. MON is conserved exactly. Each sweep left at most gasLimit × maxFee behind, and the deployer gained exactly what was swept minus its own gas. |
| Refusals | No `--fork` against anvil; `--fork` against a remote RPC; a wrong fingerprint; links written inside the repository. |

The anvil estimates in the rehearsal are anvil's. The real run takes every limit from Monad.

## Open points

- **Judges' plan amount.** funding.md funds the judges' plan with $1.00 in total; docs/submission.md says $2. Pick one before step 10, and update the other.
- **CRE production mode.** It needs CRE deploy access, and the `setProductionMode` owner transaction has no check/send script yet. Simulation mode is what launches.
- **One network on the web.** The web app at `/app` serves one network. Switching it to mainnet is a product decision (step 12).
- **Relayer URL.** The default mainnet relayer URL `relayer.plans.0xo.in` needs the Railway custom domain and DNS (step 6). Otherwise, build with `PLANS_RELAYER_URL_MAINNET`.
