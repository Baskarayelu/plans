# Plans

A group money pot for trips and plans. Friends in different countries join with one fingerprint, fund a shared pot in digital dollars (AUSD on Monad), spend under rules the group sets, and settle up in one tap.

Built for Monad Metropolis, Track 02: Consumer Products & Payments.

## Status (7 Oct 2026)

**Live on Monad testnet; not yet on mainnet.** Mainnet comes after the feature set is frozen and a full testnet run has passed.

| Part | Folder | State | Tests |
|---|---|---|---|
| Contracts | [`contracts/`](contracts) | **Deployed and verified on Monad testnet** (addresses below); not on mainnet | **182 passing**: unit, fuzz, 6 invariants at 51,200 random calls each, and fork tests against real AUSD on Monad mainnet |
| Gas model | [`contracts/GAS.md`](contracts/GAS.md) | Done | 44 transactions replayed read-only on Monad mainnet; the model's minimum gas matched all 44 |
| Relayer | [`relayer/`](relayer) | **Live on Monad testnet** at https://relayer-production-ecef.up.railway.app | **95 passing** (unit, plus integration against anvil) |
| Envio indexer | [`indexer/`](indexer) | Built and tested, not deployed | **21 passing** |
| Android app | [`app/`](app) | **Test version published**: [Plans Test 1.0.0](https://github.com/Baskarayelu/plans/releases/tag/v1.0.0-test.1) (Monad testnet) | **137 passing**, plus a copy check that fails the build on crypto words |
| Website and docs | [`site/`](site) | Live at https://plans.0xo.in | `next build`; screenshots at 1440 and 390 px in both themes in `site/screenshots/` |

## Monad testnet deployment (chain 10143)

All five contracts are verified on MonadVision (Sourcify, exact match). Source of truth: [`contracts/deployments/10143.json`](contracts/deployments/10143.json).

| Contract | Address | Deploy transaction |
|---|---|---|
| PlansFactory | `0x01F92d40b765516d54ED551da0DC56984CAA2e74` | `0xba15b4a00d7c8ff2bc0ef2891e54ddd573ccc0626879646da52b3bb1a6f73778` |
| Pot (implementation) | `0x46Fc9796653e648863b8A6720D34Ed4a6F8366c6` | created by the factory |
| ClaimEscrow | `0x28F6E6095761f003ff413cD99922894bee6e73C7` | created by the factory |
| KeyRegistry | `0xD5114ff91FD11B343c9193e9463020ca0D12d168` | `0x5ca4e39e1f6a10afce10c1dd82ab3db81e8abfe019823fea63152596e1cafd37` |
| PlansSend | `0xC73C87fb6E2c57c757eAE2a03F4ee02fF1fc0b8C` | `0x84f213791b9ede5206bc26c54261fe4bd048e74e3ccc8ca91f33e60a856d433b` |
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

## AI tool disclosure

AI coding tools (Claude Code) were used to help research, design and write this project, as section 4.1.4 of the Metropolis rules requires us to disclose.

## Licence

MIT. See [LICENSE](LICENSE).
