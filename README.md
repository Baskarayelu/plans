# Plans

A group money pot for trips and plans. Friends in different countries join with one fingerprint, fund a shared pot in digital dollars (AUSD on Monad), spend under rules the group sets, and settle up in one tap.

Built for Monad Metropolis, Track 02: Consumer Products & Payments.

## Status (8 Oct 2026)

**Live on Monad testnet; not yet on mainnet.** Mainnet comes after the feature set is frozen and a full testnet run has passed.

| Part | Folder | State | Tests |
|---|---|---|---|
| Contracts | [`contracts/`](contracts) | **Deployed and verified on Monad testnet** (addresses below); not on mainnet | **250 passing**: unit, fuzz, 6 invariants at 51,200 random calls each, and fork tests against real AUSD on Monad mainnet |
| Gas model | [`contracts/GAS.md`](contracts/GAS.md) | Done | 44 transactions replayed read-only on Monad mainnet; the model's minimum gas matched all 44 |
| Relayer | [`relayer/`](relayer) | **Live on Monad testnet** at https://relayer-production-ecef.up.railway.app, with browser push (web push); Android push pending (needs Firebase) | **165 passing** (unit, plus integration against anvil) |
| Envio indexer | [`indexer/`](indexer) | **Self-hosted on Railway, syncing Monad testnet** (see [Indexer](#indexer)); Envio Cloud configured, not yet deployed | **26 passing** |
| Chainlink CRE workflow | [`cre/fx-workflow/`](cre/fx-workflow) | Exchange-rate rounds 1 and 2 written to FxReference on Monad testnet with `cre workflow simulate --broadcast` (simulation forwarder); not deployed to a CRE DON | **69 passing** |
| Web app | [`app/`](app) (web build) | **Live on Monad testnet** at https://plans.0xo.in/app: passkey sign-in, link a browser, browser notifications, collect after settle-up | Post-deploy check on every deploy against the public URL, Chrome and Safari: last run 43/43 |
| Android app | [`app/`](app) | **Test version published**: [Plans Test 1.0.0, test 2](https://github.com/Baskarayelu/plans/releases/tag/v1.0.0-test.2) (Monad testnet) | **314 passing** (shared with the web app), plus a copy check that fails the build on crypto words |
| Website and docs | [`site/`](site) | Live at https://plans.0xo.in | `next build`; screenshots at 1440 and 390 px in both themes in `site/screenshots/` |

Not done yet: mainnet deployment, a full end-to-end run on testnet across phones and the web app (Stage B), and the pilot with real groups.

## Monad testnet deployment (chain 10143)

All six contracts are verified on MonadVision (Sourcify, exact match). Redeployed 7 Oct 2026 with `collect`, FxReference and exchange-rate rounds. Source of truth: [`contracts/deployments/10143.json`](contracts/deployments/10143.json).

| Contract | Address | Deploy transaction |
|---|---|---|
| PlansFactory | `0xCE282ad9d8CacA94170eB311b12ebFBAbDa203B4` | `0x59aa196379a9cde3e1974701baf7fd34aa0a42c03a1df41c927fb1724696e8f6` |
| Pot (implementation) | `0x3b93F30f923f8DeE346ef84f3a0a08d5cf7718A8` | created by the factory |
| ClaimEscrow | `0x720876392Da37b7a3122289F537892E069F91eF5` | created by the factory |
| KeyRegistry | `0xf514925f5f781455E162148eA5BF3E8f5626d5bb` | `0x6bcae3d2916d37334137eb9db2edec68ceaeed219363147f094753d338088040` |
| PlansSend | `0x2e29d27dBeE1B9fa6C31f0e4cC21CDCc5dbaf56B` | `0xbfbae34409a6ef26c4b1bd551dec908f6738b8cde1520667c44532797c57bda0` |
| FxReference | `0xaB7eeDe1DA994137a340155f350A8F81358FFCa2` | `0x1d338153a401122b7019a903eb43b4846f62b016dfc0d1394261979ea82a2751` |
| AUSD (Agora, testnet) | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` | — |

Every gas limit was taken from Monad's own `eth_estimateGas` (see [`contracts/GAS-LIMITS.md`](contracts/GAS-LIMITS.md)).

## Indexer

**Live: the self-hosted indexer.** The same Envio HyperIndex project runs on Railway (services Postgres, Hasura and the indexer, built from [`indexer/Dockerfile`](indexer/Dockerfile)). Its config, [`indexer/config.selfhost.yaml`](indexer/config.selfhost.yaml), is generated from `config.yaml` by `node indexer/scripts/selfhost-config.mjs` and reads Monad testnet over its public RPC (no HyperSync token needed).

- Public GraphQL (read-only): https://hasura-production-c5c7.up.railway.app/v1/graphql
- The relayer publishes this URL at `/v1/config` (`graphqlUrl`), and the web app reads it from there.
- It indexes from block 68,940,999. On 8 Oct it was still catching up. Check before relying on it: `{ _meta { progressBlock sourceBlock isReady } }`.

**Configured, not yet live: Envio Cloud.** [`indexer/config.yaml`](indexer/config.yaml) is the Envio Cloud deployment (HyperSync). It goes live once two old deployments are deleted from the project's free slots. To switch, set `INDEXER_GRAPHQL_URL` on the relayer (Railway) and `NEXT_PUBLIC_ENVIO_GRAPHQL_URL` on the site (Vercel) to the Envio Cloud URL. Nothing else changes, because the app takes the URL from the relayer.

## Run the tests

```sh
# Contracts (Foundry). Fork tests skip themselves if the Monad RPC is unreachable.
cd contracts && forge test

# Relayer (Node 24, pnpm). Integration tests spawn anvil and need `forge build` in contracts/ first.
cd relayer && pnpm install && pnpm test

# Envio indexer
cd indexer && pnpm install && pnpm codegen && pnpm test

# Chainlink CRE workflow (offline tests)
cd cre/fx-workflow && npm install && npm test

# Android app: the copy check (no crypto words in the UI) then jest
cd app && npm install && npm test

# Gas model (forks Monad mainnet with anvil, replays read-only on the live chain)
cd contracts && npm --prefix tools install && npm --prefix tools run gas
```

## How it fits together

- **Accounts:** Mera passkeys. Each person's key comes from their passkey's WebAuthn PRF output, and a second PRF namespace, `plans.keys.v1`, gives each member an encryption key for receipts and notes. No custody backend.
- **Money:** AUSD on Monad. Deposits and sends are ERC-3009 signed transfers; every other action is an EIP-712 message to the plan's pot contract. A relayer pays gas, and anyone can submit the signed messages.
- **Rules:** enforced by the pot contract — instant limit, approvals, category budgets, per-person caps, payee policy, pause, timelocked rule changes, disputes and one-transaction settle-up. See [`docs/protocol.md`](docs/protocol.md).
- **Data:** an Envio HyperIndex indexer derives balances, the who-owes-whom graph and cross-border corridors.
- **Exchange rates:** a Chainlink CRE workflow ([`cre/fx-workflow/`](cre/fx-workflow)) writes reference-rate rounds to `FxReference`. They are for receipts only and never price a transfer.

Docs: [`docs/`](docs) in this repo, and the docs site at https://plans.0xo.in/docs. Updates on X: [@PlansOnMonad](https://x.com/PlansOnMonad).

## Agora

Plans uses AUSD, Agora's digital dollar, and only Agora's public interfaces:

- **Public API:** `GET https://api.agora.finance/v0/metrics` for AUSD supply on Monad.
- **Reserves:** Agora's monthly attestation reports. The latest one's date and firm are bundled in [`app/src/lib/agora/attestation.json`](app/src/lib/agora/attestation.json) and updated by hand.
- **Staging environment:** requested from Agora's CTO through the mentor page on 7 Oct 2026; no reply yet.

"Instant settlement" in Plans means a send that is final on Monad in under a second (measured). It is not Agora's Instant Settlement product.

## AI tool disclosure

AI coding tools (Claude Code) were used to help research, design and write this project, as section 4.1.4 of the Metropolis rules requires us to disclose.

## Licence

MIT. See [LICENSE](LICENSE).
