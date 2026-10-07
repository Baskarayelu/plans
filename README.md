# Plans

A group money pot for trips and plans. Friends in different countries join with one fingerprint, fund a shared pot in digital dollars (AUSD on Monad), spend under rules the group sets, and settle up in one tap.

Built for Monad Metropolis, Track 02: Consumer Products & Payments.

## Status (7 Oct 2026)

**Live on Monad testnet; not yet on mainnet.** Mainnet comes after the feature set is frozen and a full testnet run has passed.

| Part | Folder | State | Tests |
|---|---|---|---|
| Contracts | [`contracts/`](contracts) | **Deployed and verified on Monad testnet** (addresses below); not on mainnet | **250 passing**: unit, fuzz, 6 invariants at 51,200 random calls each, and fork tests against real AUSD on Monad mainnet |
| Gas model | [`contracts/GAS.md`](contracts/GAS.md) | Done | 44 transactions replayed read-only on Monad mainnet; the model's minimum gas matched all 44 |
| Relayer | [`relayer/`](relayer) | **Live on Monad testnet** at https://relayer-production-ecef.up.railway.app | **122 passing** (unit, plus integration against anvil) |
| Envio indexer | [`indexer/`](indexer) | Built and tested, not deployed | **26 passing** |
| Android app | [`app/`](app) | **Test version published**: [Plans Test 1.0.0](https://github.com/Baskarayelu/plans/releases/tag/v1.0.0-test.1) (Monad testnet) | **173 passing**, plus a copy check that fails the build on crypto words |
| Website and docs | [`site/`](site) | Live at https://plans.0xo.in | `next build`; screenshots at 1440 and 390 px in both themes in `site/screenshots/` |

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

## Run the tests

```sh
# Contracts (Foundry). Fork tests skip themselves if the Monad RPC is unreachable.
cd contracts && forge test

# Relayer (Node 24, pnpm). Integration tests spawn anvil and need `forge build` in contracts/ first.
cd relayer && pnpm install && pnpm test

# Envio indexer
cd indexer && pnpm install && pnpm codegen && pnpm test

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

Docs: [`docs/`](docs) in this repo, and the docs site at https://plans.0xo.in/docs. Updates on X: [@PlansOnMonad](https://x.com/PlansOnMonad).

## Agora

Plans uses AUSD, Agora's digital dollar, and only Agora's public interfaces:

- **Public API:** `GET https://api.agora.finance/v0/metrics` for AUSD supply on Monad.
- **Reserves:** Agora's monthly attestation reports. The latest one's date and firm are bundled in [`app/src/lib/agora/attestation.json`](app/src/lib/agora/attestation.json) and updated by hand.
- **Staging environment:** access requested by the entrant on 7 Oct 2026; **pending**.

"Instant settlement" in Plans means a send that is final on Monad in under a second (measured). It is not Agora's Instant Settlement product.

## AI tool disclosure

AI coding tools (Claude Code) were used to help research, design and write this project, as section 4.1.4 of the Metropolis rules requires us to disclose.

## Licence

MIT. See [LICENSE](LICENSE).
