# Traction plan

This file, the go-to-market answer in [submission.md](submission.md) and the public stats page must say the same thing. Change all three together.

## Where we are (6 Oct 2026)

| Metric | Value | Source |
|---|---|---|
| Plans contracts deployed on mainnet | none | — |
| Accounts | 0 | — |
| Plans created | 0 | — |
| Funded plans | 0 | — |
| Settlements | 0 | — |
| APK downloads | 0 (no release yet) | — |

Rule: only numbers that can be read onchain (through the Envio indexer) are reported as traction. APK downloads are the one offchain number, and they are always labelled as such.

## Who we reach first, and how

- **First users.** Friend groups that already collect money in a group chat for a trip or a festival, with at least one member in another country.
- **Beachhead.** People who already hold digital dollars or have an exchange account: the Monad community and crypto-native organisers of trips for friends who are not crypto users.
- **Channels:**
  1. The invite link, shared inside the group chat.
  2. Direct recruiting of organisers in Monad Discord and X, international-student societies and travel groups in the UK and US, and festival group chats.
  3. Shareable settle-up summaries.
- **Install to first funded action:**
  1. Invite link.
  2. APK install.
  3. One fingerprint: account plus join, in one onchain transaction.
  4. Add money, or claim the organiser's link.

## Pilot before judging (targets)

| Target | By |
|---|---|
| 3 real groups run a small plan on mainnet, from invite to settlement | 13 Oct |
| At least 12 people across those groups | 13 Oct |
| At least 3 countries represented | 13 Oct |

These need recruiting by the entrant. They are targets and are reported as results only once they are onchain.

## Metrics: definitions (all from the Envio indexer unless marked)

| Metric | Definition |
|---|---|
| Accounts | Distinct addresses with a `KeyRegistered` event |
| Plans created | `PotCreated` events from the Plans factory |
| Funded plans | Plans with at least one `Contributed` event |
| Members per plan | Active members at the plan's end, median |
| Countries per plan | Distinct country codes among a plan's members, median |
| Time to first funded action | From a member's `Joined` to their first `Contributed`, `Sent` or `Claimed`, median, in seconds |
| Spends / approvals | `SpendExecuted` and `Approved` events |
| Settlements and settled volume | `Settled` events, and the sum of their payouts |
| Cross-border volume | AUSD volume where the sender's and receiver's country codes differ, by country pair |
| APK downloads (offchain) | GitHub release asset download count |

## Public stats page

**Pending.** It will be a `/stats` page on the landing site, reading these metrics live from the Envio GraphQL endpoint. It will show the same definitions as this table.
