# Plans protocol

The source of truth for contract behaviour. The Solidity interfaces in `contracts/src/interfaces/` define the exact functions, events and EIP-712 types. This document defines what they must do. Contracts, relayer, indexer and app all follow it. When behaviour changes, change this file in the same commit.

## Contracts

| Contract | Role |
|---|---|
| `PlansFactory` | Deploys `Pot` clones (ERC-1167, CREATE2 with salt `keccak256(creator, params.salt)`), registers them, and is the only caller of `Pot.initialize`. |
| `Pot` | One plan: members, money, rules, proposals, disputes, settlement. No admin, not upgradeable. |
| `KeyRegistry` | Account → X25519 public key, set with the account's EIP-712 signature. |
| `ClaimEscrow` | Money locked against a one-time claim key, claimed by a signature from that key, refundable after expiry. |
| `PlansSend` | Person-to-person AUSD send with a receipt event. |

All contracts are immutable and hold no privileged roles. Token: AUSD, 6 decimals. Mainnet `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`, testnet `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`. AUSD's EIP-712 domain name is `"Agora Dollar"`, version `"1"`.

Gas is charged on the gas limit on Monad, and cold storage is expensive. Keep each member's ledger in one packed struct, and keep loops bounded by `MAX_MEMBERS = 50`.

## Signatures

- Every member action is an EIP-712 message signed by the member's key; see the type strings in `IPot.sol`.
- Anyone may submit a signed message.
- `deadline` is a unix timestamp; the action reverts after it.
- Nonces are **unordered**: `usedNonce[member][nonce]` must be false and is then set. Apps use random 256-bit nonces.
- Signatures are checked with Solady `SignatureCheckerLib.isValidSignatureNowCalldata`, so both EOA and ERC-1271 signers are accepted.
- Deposits use AUSD `receiveWithAuthorization`, the bytes-signature variant, with `to = the calling contract`, so a third party cannot front-run them.
- The safety net uses AUSD `permit(member, pot, value, deadline, v, r, s)`.
- A permit that has already been used, for example after a replay, must not make `join` revert. Wrap it in try/catch and continue if the allowance is already at least `value`.

## Membership

- **`createPot`**
  - The creator signs `CreatePot` on the factory domain; the factory deploys and initialises the pot.
  - The creator becomes member 0. In the same transaction the factory processes the creator's optional deposit, permit and key registration on the pot's behalf, by calling `pot.join` internally. The creator's invite proof is implied.
  - `startTime <= endTime` is required. Both are in the future or `startTime` is now. Maximum duration is 365 days.
- **`join`**
  - Requires a valid `Invite(member)` signature from the current `inviteSigner`, plus the member's own `Join` signature.
  - The member must not be in the pot already; this includes members who have exited.
  - Fails if the pot is settled or `activeMemberCount == MAX_MEMBERS`.
  - Optional parts in one transaction: deposit (3009), safety-net permit, and `KeyRegistry.register`.
  - Records the country.
  - Joining resets acks.
- **`rotateInvite`**: any active member may replace the invite signer, which makes old links stop working.
- **`postKeyWraps`**: any active member may publish group-key wraps for members. These are events only; nothing is stored.

## Ledger and the core invariant

Each member has `contributed`, `personalPaid`, `share` and `withdrawn`:

```
net(m) = contributed + personalPaid − share − withdrawn
```

| Event | Ledger change |
|---|---|
| contribute / deposit / pull | `contributed += amount` |
| PAY or LINK spend executes | pot sends `amount` out; each split member `share += their part` |
| PERSONAL spend executes | proposer `personalPaid += amount`; each split member `share += part` |
| payout (exit, settle, debt distribution) | `withdrawn += amount` |
| escrow refund before settlement | each member's share on that spend is reduced pro rata to the refund (exact, remainder to the first member) |

**Invariant I1:** `Σ net(m) over all members (active and exited) == AUSD.balanceOf(pot)`. Funds held in ClaimEscrow left the pot when the LINK spend executed, so they are not counted.

**Share computation:** `part_i = amount * w_i / Σw` for i ≥ 1, and `part_0 = amount − Σ_{i≥1} part_i`. Every member of a split must be an active member, and weights must be greater than zero. At most `MAX_MEMBERS` entries, with no duplicates.

## Spending rules

`propose` checks, in order. The reason code is what `previewSpend` returns and what reverts carry as `SpendBlocked(uint8 reason)`.

| Code | Check |
|---|---|
| 1 | Not an active member |
| 2 | Plan not open: `now < startTime`, `now > endTime`, or settled |
| 3 | Frozen |
| 4 | Minimum contribution not met by every active member (only if `minContribution > 0`) |
| 5 | Payee not allowed by the payee policy (PAY only; LINK and PERSONAL are always allowed) |
| 6 | Over the category budget: `categorySpent[c] + amount > budget[c]`, with budget > 0 |
| 7 | Over the member daily cap (UTC day bucket `now / 1 days`) |
| 8 | Over the member total cap |
| 9 | Not enough money in the pot (PAY, LINK) |
| 10 | Invalid split |
| 11 | Amount is zero or category > 7 |

**Approvals required**, counting the proposer:
- `amount <= instantMax`: 1
- `amount <= oneApprovalMax`: 2
- above that: `MAJORITY` = `floor(active / 2) + 1`, or `ALL` = `active`

The result is capped at `active`, so a solo member is never stuck.

**Behaviour:**
- If approvals required == 1, the spend executes inside `propose`.
- Otherwise the proposal is Pending with `expiresAt = now + proposalTtl`.
- Caps and budgets are checked at proposal time, and again at execution against the then-current state. Budget and cap usage is counted only when a spend executes.
- A `vote(approve)` that reaches the threshold executes immediately if all checks pass. Otherwise the proposal becomes Approved, and anyone may call `execute` once it passes before `expiresAt`.
- A `vote(reject)` cancels the proposal when the remaining possible approvals can no longer reach the threshold.
- The proposer may withdraw with `cancelSpend`.
- Each member votes once per proposal; the proposer's vote is implied.

**LINK spends:** on execution the pot calls `ClaimEscrow.createFromPot(payee, amount, expiry, id)`, where `payee` is the claim key address, after approving the escrow for `amount`. Expiry is `min(now + 7 days, endTime + reviewWindow)`. That keeps every claim resolved before settlement normally opens.

**Categories:**

| Id | Category |
|---|---|
| 0 | Stay |
| 1 | Travel |
| 2 | Getting around |
| 3 | Food & drink |
| 4 | Tickets & activities |
| 5 | Groceries |
| 6 | Shopping |
| 7 | Other |

## Disputes

- **Opening:** any member included in an executed spend's split can open a dispute, until the pot is settled. Only one open dispute per spend.
  - `reason`: 0 wrong amount, 1 wrong split, 2 not a group cost.
  - Opening resets acks.
- **Voting:** eligible voters are active members other than the spend's proposer and the dispute's opener.
- **Resolution:**
  - The proposer can call `resolveDispute` with `Resplit` (a new valid split of the same amount) or `SpenderCovers` (the whole amount assigned to the proposer). Either resolves immediately.
  - Otherwise `finalizeDispute` after `DISPUTE_PERIOD = 48 hours`, or once every eligible voter has voted. A strict majority of votes cast for `spenderCovers` gives SpenderCovers; anything else gives Keep.
  - With no eligible voters and no proposer action, the result is Keep after the period.
- A dispute changes only `share` assignments. Money never moves, so I1 holds.

## Freeze

- `freeze`: any active member, at most once per 24 h per member. It blocks propose, execute and vote-execution until `now + 24 hours`. A second freeze extends it to `max(until, now + 24 h)`.
- `voteUnfreeze`: when a majority of active members have voted, during the current freeze, the freeze lifts.

## Rule changes

- `proposeRules`: any active member. It needs MAJORITY approval, counting the proposer, within `proposalTtl`.
- On approval, `eta = now + ruleTimelock`; `applyRules` is callable by anyone at or after `eta`.
- Applying a change never alters open proposals.
- The allowlist is changed in the same flow.

## Ending

- **`ack`**: an active member confirms the plan's summary. It records `ackEpoch`. The epoch increments, resetting all acks, on any spend execution, dispute open or resolution, join, exit or rule change.
- **`settle()`** is callable by anyone when not settled, there are no Pending/Approved proposals or open disputes, and one of these holds:
  - (a) `now >= endTime + reviewWindow`; or
  - (b) every active member has acked in the current epoch (this is also how a plan ends early).
- **Settlement:**
  1. For each member with `net < 0`, pull `min(−net, allowance, balance)` with `transferFrom` inside try/catch. Each pull counts as contributed and emits `Pulled`.
  2. Let `C = Σ max(net, 0)` and `B` the pot balance.
  3. If `B >= C`, pay each creditor their net.
  4. Otherwise pay `net * B / C`, floored, and the remaining positive nets stay as claims. Every remaining negative net is emitted as `DebtRecorded`.
  5. Mark the pot settled and emit `Settled`. Spending stops for good.
- **`payDebt`**: a member with `net < 0` deposits up to `−net` with 3009. The amount is immediately distributed pro rata to members with `net > 0`, emitting `DebtPaid` and `Payout`.
- **`exit`**:
  - Allowed when the member is not the proposer of a Pending or Approved proposal, is not the opener or subject of an open dispute, and the pot is not settled.
  - If `net > 0`, pay `min(net, balance)`. If `net < 0`, pull as in settlement and record any rest as debt.
  - The member becomes inactive: no votes, no new splits; shares already assigned stay.
- **Escrow refund after settlement**: shares are reversed as before settlement, then the refunded amount is distributed to positive nets.

## Constants

| Name | Value |
|---|---|
| MAX_MEMBERS | 50 |
| DISPUTE_PERIOD | 48 hours |
| FREEZE_DURATION | 24 hours |
| LINK_EXPIRY | 7 days, capped at `endTime + reviewWindow` |
| Max memo / meta / key-wrap bytes | 512 |

## Rules presets (app side)

| Preset | instantMax | oneApprovalMax | highTier | Daily cap | proposalTtl | ruleTimelock |
|---|---|---|---|---|---|---|
| Easygoing | $100 | uint64 max | MAJORITY | none | 24 h | 1 h |
| **Balanced (default)** | $25 | $200 | MAJORITY | $150 | 24 h | 1 h |
| Strict | $0 | $100 | ALL | $100 | 24 h | 1 h |

**Demo plans:** judges' plan and "Try a settle-up". Instant $0.25 and one approval up to $1. A 5-minute ruleTimelock and reviewWindow of 0.
