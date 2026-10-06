# Plans

A group money pot for trips and plans. Friends in different countries join with one fingerprint, fund a shared pot in digital dollars (AUSD on Monad), spend under rules the group sets, and settle up in one tap.

Built for Monad Metropolis, Track 02: Consumer Products & Payments.

## Status (6 Oct 2026)

**Built and tested; not yet deployed to Monad.** No contract addresses or transaction hashes exist yet. They will be listed here once the contracts are deployed and verified.

| Part | Folder | State | Tests |
|---|---|---|---|
| Contracts | [`contracts/`](contracts) | Built and tested, not deployed | **178 passing**: unit, fuzz, 6 invariants at 51,200 random calls each, and fork tests against real AUSD on Monad mainnet |
| Gas model | [`contracts/GAS.md`](contracts/GAS.md) | Done | 44 transactions replayed read-only on Monad mainnet; the model's minimum gas matched all 44 |
| Relayer | [`relayer/`](relayer) | Built and tested, not deployed | **85 passing** (unit, plus integration against anvil) |
| Envio indexer | [`indexer/`](indexer) | Built and tested, not deployed | **21 passing** |
| Android app | [`app/`](app) | Built and tested, not released | **137 passing**, plus a copy check that fails the build on crypto words |
| Website and docs | [`site/`](site) | Live preview at https://plans-0xo.vercel.app (the plans.0xo.in domain is pending DNS) | `next build`; screenshots at 1440 and 390 px in both themes in `site/screenshots/` |

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

Docs: [`docs/`](docs) in this repo, and the docs site at https://plans-0xo.vercel.app/docs.

## AI tool disclosure

AI coding tools (Claude Code) were used to help research, design and write this project, as section 4.1.4 of the Metropolis rules requires us to disclose.

## Licence

MIT. See [LICENSE](LICENSE).
