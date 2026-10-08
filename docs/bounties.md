# Bounty checklist

Bounty judging weights adherence to the written requirements at 40%. This file lists every written requirement, where its text comes from, how Plans meets it, and the evidence. Update it in the same commit as the change that produces the evidence.

Last checked: 8 Oct 2026. "Testnet" below means live on Monad testnet (chain 10143) in the web app at https://plans.0xo.in/app and the Plans Test Android build. Nothing is on mainnet yet.

**Sources**
- **Official**: the "Asked for at submission" text read from each bounty's page in the portal on 6 Oct 2026, pasted by the entrant.
- **2nd**: another entrant's public copy of the full bounty card. Treat it as unconfirmed until the full official card is pasted.

**Status**
- ⏳ pending
- 🟡 in progress, or live on testnet only
- ✅ done, with evidence linked

---

## Agora: Best Cross-Border Payments App on Monad ($10,000, Consumer Products & Payments only)

| Requirement | Source | How Plans meets it | Status | Evidence |
|---|---|---|---|---|
| Entry is in Consumer Products & Payments | Official (bounty track) | Primary track selected and saved | ✅ | Portal (entrant) |
| Describe how a user sends AUSD to another person or across borders | Official | Send tab, send-by-link, cross-border pot, settle-up and collect; answer in [submission.md](submission.md#agora-best-cross-border-payments-app-on-monad) | ✅ drafted | — |
| Demo video, up to 2 min: passkey onboarding | Official | Phone B fresh install, one prompt ([storyboards.md §1](storyboards.md#1-agora-bounty-video-required-at-most-200)) | ⏳ needs mainnet | — |
| Demo video: an AUSD balance | Official | Send tab "You can send" with the AUSD pill | ⏳ needs mainnet | — |
| Demo video: completed send and receive, settled instantly | Official | Phone A → Phone B; receipt shows "Settled in" and a Proof link | ⏳ needs mainnet | — |
| Mobile app | 2nd (card summary) | Native Android APK (test build on testnet), plus the web app on phone browsers | 🟡 testnet | [Plans Test 1.0.0, test 2](https://github.com/Baskarayelu/plans/releases/tag/v1.0.0-test.2) |
| Mera passkey onboarding | 2nd (card summary) | Mera is the only account layer | 🟡 testnet | [passkey-checks.md](passkey-checks.md): Android, Mac and iPhone pass |
| Uses AUSD (not a mock) | 2nd | Agora's testnet AUSD `0xa9012a05…22dC` now; mainnet AUSD `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` pending | 🟡 testnet, plus a mainnet fork | [contracts/test/fork](../contracts/test/fork) runs the full lifecycle against real AUSD |

## Monad Foundation: Best Mera-Powered UX on Monad ($2,500, all tracks)

| Requirement | Source | How Plans meets it | Status | Evidence |
|---|---|---|---|---|
| Describe how Mera is the entire account layer | Official | No other wallet SDK, no custody backend; answer in submission.md | ✅ drafted | — |
| Optional video, up to 2 min, on UX | Official | Join with one prompt, prompt-free actions, stateless test | ⏳ | — |
| Deployed with real transactions and a live demo | 2nd | Testnet: web app and APK, relayed transactions (faucet, join) | 🟡 testnet; mainnet pending | [first-tx-timing.md](first-tx-timing.md) (live faucet tx `0x635c5408…`) |
| One-prompt onboarding | 2nd | Create or join = 1 fingerprint | 🟡 testnet | [passkey-checks.md](passkey-checks.md) |
| Prompt-free signing through Mera signing sessions | 2nd | One session per unlock, then `toViemAccount` signs everything | 🟡 testnet | `app/src/lib/identity/session.ts` |
| Stateless test: clear storage or use a fresh device, and identity rebuilds from the passkey | 2nd | "I already use Plans" → PRF → rebuild from the indexer | 🟡 built; physical-phone test pending | [phone-check.md](phone-check.md) step 10 |
| Bonus: Mera combined with the wider account stack | 2nd | EIP-712 pot actions plus AUSD ERC-3009 and ERC-2612 via `toViemAccount`; linked browsers | 🟡 testnet | — |

## Monad Foundation: Mera: One Passkey, Many Keys ($2,500, all tracks)

| Requirement | Source | How Plans meets it | Status | Evidence |
|---|---|---|---|---|
| Describe how Mera is used in non-account work | Official | Namespace `plans.keys.v1`: group encryption identity, cache key, linked-browser vault | ✅ drafted | — |
| Optional video: at least one PRF namespace does non-account work | Official | Cross-device key fingerprint and receipt decryption | ⏳ | — |
| The same passkey on a second device reproduces the same derived keys, live | 2nd | Emoji fingerprint shown on both devices | ⏳ recording pending | — |
| Correct use of the primitives | 2nd | Distinct PRF salt, HKDF branches, no reuse of the account output for encryption | 🟡 testnet | [app/docs/crypto.md](../app/docs/crypto.md) |

## Envio: Best Use of Envio ($1,000, all tracks)

| Requirement | Source | How Plans meets it | Status | Evidence |
|---|---|---|---|---|
| HyperIndex, HyperSync or HyperRPC actually drives a feature | Official | Balances, budget bars, settle-up preview, fresh-device rebuild, stats page | 🟡 self-hosted HyperIndex on Railway, syncing testnet; Envio Cloud (HyperSync) configured, pending | Public GraphQL https://hasura-production-c5c7.up.railway.app/v1/graphql; relayer `/v1/config` → `graphqlUrl`; README [Indexer](../README.md#indexer) |
| Optional video: data flowing end to end | Official | Spend → GraphQL → app updates | ⏳ needs the indexer caught up | — |
| Public repo with `config.yaml`, `schema.graphql` and handlers | 2nd | `indexer/` in this repo | ✅ | [indexer/config.yaml](../indexer/config.yaml), [config.selfhost.yaml](../indexer/config.selfhost.yaml), [schema.graphql](../indexer/schema.graphql), [src/handlers](../indexer/src/handlers); 26 tests |
| Non-trivial schema with derived or aggregated entities | 2nd | MemberBalance, CategorySpend, SettlementEdge, Corridor, PotDaily, GlobalStats, FxRound links | ✅ built | 34 entities; settlement-graph tests on 2,000 random pots |
| A consumer of the data, plus a demo | 2nd | The app (Android and web) and the stats page | 🟡 the app reads the URL from the relayer; demo pending | `app/src/lib/api/envio.ts` |

## Chainlink: Best workflow with CRE ($3,000, all tracks)

Card text (2nd, from another entrant's copy; the official detail page has not been read): "Build, simulate, or deploy a Chainlink Runtime Environment (CRE) Workflow used as an orchestration layer within your project." ETHGlobal's Chainlink prize pages use the same CRE wording ("demonstrate a successful simulation (via the CRE CLI) or a live deployment").

| Requirement | Source | How Plans meets it | Status | Evidence |
|---|---|---|---|---|
| Build a CRE workflow | 2nd | TypeScript SDK workflow: cron trigger, HTTP fetch in node mode from 3 FX sources, per-node median, DON consensus by field, guards against the contract's state, `runtime.report` + `writeReport` | ✅ | [cre/fx-workflow](../cre/fx-workflow) ([README](../cre/fx-workflow/README.md)); 69 offline tests |
| Simulate it (CRE CLI) | 2nd | `cre workflow simulate fx-rates --target staging-settings --broadcast` (CLI v1.37.0); single-node simulation, real transactions | ✅ on Monad testnet | Round 1 [`0x66ad55a2…f8a6`](https://testnet.monadvision.com/tx/0x66ad55a247afa377891003740866303791aaa41edfcff9c161e35015de16f8a6), round 2 [`0x94f2071f…b1b3`](https://testnet.monadvision.com/tx/0x94f2071fe1d1b2afc4e999552d106f5dd5158d64355cd13bfac10c445920c1b3): status 1, sent to MockKeystoneForwarder `0xB9F79d86…D192`, one `RoundWritten` each from FxReference `0xaB7eeDe1…FCa2`. `latestRoundTime()` → round 2. |
| Deploy it to a CRE DON | 2nd ("or deploy") | Not done: workflow deployment needs `cre account access` approval, not requested | ⏳ pending | — |
| Used as an orchestration layer within the project | 2nd | FxReference stores rounds; PlansSend checks a cited round (known, under 6 h old) and records the reference rate and the difference in the onchain receipt; Pot settle-up tags the latest fresh round; relayer serves `/v1/fx/round`; the indexer links rounds to sends and settlements | 🟡 contracts, relayer and indexer use it; the app's rate line still shows the relayer's signed ECB rate, and rounds run by hand, so they are often stale (sends then cite round 0) | [contracts/src/FxReference.sol](../contracts/src/FxReference.sol), [contracts/src/PlansSend.sol](../contracts/src/PlansSend.sol), `relayer/src/fx.ts`, `indexer/src/handlers/FxReference.ts` |
| Receiver security | (good practice, CRE docs) | Simulation mode: mock forwarder plus a `tx.origin` transmitter check, labelled a demo guard; production mode: KeystoneForwarder plus workflow id and owner; chain selector and increasing scheduled time against replay | ✅ | FxReference NatSpec; `contracts/test/unit/FxReference*.t.sol` |
| Answer text | — | [submission.md](submission.md#chainlink-best-workflow-with-cre) | ✅ drafted | — |

## Aurora Intents: Bring Any-Chain Liquidity to Monad ($5,000, all tracks): not added

| Requirement | Source | Status |
|---|---|---|
| Integrate at least one Aurora Intents product | Official | ❌ Blocked |
| Video showing funds arriving from another chain and being used in the app, live | Official | ❌ Blocked |

Why it is blocked (re-tested 5 Oct, 20:59 UTC):
- Every 1Click quote involving Monad returns "Quoting for this pair is not available".
- Aurora's incident feed lists `chain monad` as active since 3 Oct.
- There is no AUSD in Aurora's token list.

Re-test on 10 Oct.
