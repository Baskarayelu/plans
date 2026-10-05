# Bounty checklist

Bounty judging weights adherence to the written requirements at 40%. This file lists every written requirement, where its text comes from, how Plans meets it, and the evidence. Update it in the same commit as the change that produces the evidence.

**Sources**
- **Official**: the "Asked for at submission" text read from each bounty's page in the portal on 6 Oct 2026, pasted by the entrant.
- **2nd**: another entrant's public copy of the full bounty card. Treat it as unconfirmed until the full official card is pasted.

**Status**
- ⏳ pending
- 🟡 in progress
- ✅ done, with evidence linked

---

## Agora: Best Cross-Border Payments App on Monad ($10,000, Consumer Products & Payments only)

| Requirement | Source | How Plans meets it | Status | Evidence |
|---|---|---|---|---|
| Entry is in Consumer Products & Payments | Official (bounty track) | Primary track selected and saved | ✅ | Portal (entrant) |
| Describe how a user sends AUSD to another person or across borders | Official | Send tab, send-by-link, cross-border pot and settle-up; answer in [submission.md](submission.md#agora-best-cross-border-payments-app-on-monad) | ⏳ | — |
| Demo video, up to 2 min: passkey onboarding | Official | Phone B fresh install, one prompt | ⏳ | — |
| Demo video: an AUSD balance | Official | Phone A home balance, captioned "Digital dollars (AUSD)" | ⏳ | — |
| Demo video: completed send and receive, settled instantly | Official | Phone A → Phone B on mainnet; receipt shows settlement time and a Proof link | ⏳ | — |
| Mobile app | 2nd (card summary) | Native Android APK | ⏳ | — |
| Mera passkey onboarding | 2nd (card summary) | Mera is the only account layer | ⏳ | — |
| Uses AUSD (not a mock) | 2nd | AUSD `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` on mainnet | ⏳ | AUSD ERC-3009 relay simulated on mainnet, 6 Oct (local evidence) |

## Monad Foundation: Best Mera-Powered UX on Monad ($2,500, all tracks)

| Requirement | Source | How Plans meets it | Status | Evidence |
|---|---|---|---|---|
| Describe how Mera is the entire account layer | Official | No other wallet SDK, no custody backend; answer in submission.md | ⏳ | — |
| Optional video, up to 2 min, on UX | Official | Join with one prompt, prompt-free actions, stateless test | ⏳ | — |
| Deployed with real transactions and a live demo | 2nd | Mainnet deployment and APK | ⏳ | — |
| One-prompt onboarding | 2nd | Create or join = 1 fingerprint | ⏳ | — |
| Prompt-free signing through Mera signing sessions | 2nd | One session per app launch, then `toViemAccount` signs everything | ⏳ | — |
| Stateless test: clear storage or use a fresh device, and identity rebuilds from the passkey | 2nd | "I already use Plans" → `getPasskeyPrfOutput` → Envio rebuild | ⏳ | — |
| Bonus: Mera combined with the wider account stack | 2nd | EIP-712 pot actions plus AUSD ERC-3009 and ERC-2612 via `toViemAccount` | ⏳ | — |

## Monad Foundation: Mera: One Passkey, Many Keys ($2,500, all tracks)

| Requirement | Source | How Plans meets it | Status | Evidence |
|---|---|---|---|---|
| Describe how Mera is used in non-account work | Official | Namespace `plans.keys.v1`: group encryption identity, cache key | ⏳ | — |
| Optional video: at least one PRF namespace does non-account work | Official | Cross-device key fingerprint and receipt decryption | ⏳ | — |
| The same passkey on a second device reproduces the same derived keys, live | 2nd | Emoji fingerprint shown on both phones | ⏳ | — |
| Correct use of the primitives | 2nd | Distinct PRF salt, HKDF branches, no reuse of the account output for encryption | ⏳ | — |

## Envio: Best Use of Envio ($1,000, all tracks)

| Requirement | Source | How Plans meets it | Status | Evidence |
|---|---|---|---|---|
| HyperIndex, HyperSync or HyperRPC actually drives a feature | Official | Balances, budget bars, settle-up preview, fresh-device rebuild, stats page | ⏳ | — |
| Optional video: data flowing end to end | Official | Spend → GraphQL console → app updates | ⏳ | — |
| Public repo with `config.yaml`, `schema.graphql` and handlers | 2nd | `indexer/` in this repo | ⏳ | — |
| Non-trivial schema with derived or aggregated entities | 2nd | MemberBalance, CategorySpend, SettlementEdge, Corridor, PotDaily | ⏳ | — |
| A consumer of the data, plus a demo | 2nd | The Android app and the stats page | ⏳ | — |

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
