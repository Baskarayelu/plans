# Plans protocol

The source of truth for contract behaviour. The Solidity interfaces in `contracts/src/interfaces/` define the exact functions, events and EIP-712 types. This document defines what they must do. Contracts, relayer, indexer and app all follow it. When behaviour changes, change this file in the same commit.

## Contracts

| Contract | Role |
|---|---|
| `PlansFactory` | Deploys `Pot` clones (Solady `LibClone` minimal proxy, 0age's 44-byte ERC-1167 variant; CREATE2 with salt `keccak256(abi.encode(creator, params.salt))`), registers them, and is the only caller of `Pot.initialize`. Its constructor deploys `ClaimEscrow` and the `Pot` implementation, and fixes the `FxReference` every pot reads. Use `predictPot(creator, salt)` to get a pot's address. |
| `Pot` | One plan: members, money, rules, proposals, disputes, settlement. No admin, not upgradeable. |
| `KeyRegistry` | Account → X25519 public key, set with the account's EIP-712 signature. |
| `ClaimEscrow` | Money locked against a one-time claim key, claimed by a signature from that key, refundable after expiry. |
| `PlansSend` | Person-to-person AUSD send with a receipt event, optionally citing an FX reference round. |
| `FxReference` | Reference FX rates written by a Chainlink CRE workflow, in numbered rounds. Display and receipts only; never touches funds. |

All contracts are immutable. Only `FxReference` has a privileged role (its owner, with the limited powers listed in [FX reference rates](#fx-reference-rates)); the money contracts have none. Token: AUSD, 6 decimals. Mainnet `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`, testnet `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`. AUSD's EIP-712 domain name is `"Agora Dollar"`, version `"1"`.

Gas is charged on the gas limit on Monad, and cold storage is expensive. Keep each member's ledger in one packed struct, and keep loops bounded by `MAX_MEMBERS = 50`.

## Signatures

- Every member action is an EIP-712 message signed by the member's key; see the type strings in `IPot.sol`.
- Anyone may submit a signed message.
- `deadline` is a unix timestamp; the action reverts after it.
- Nonces are **unordered**: `usedNonce[member][nonce]` must be false and is then set. Apps use random 256-bit nonces.
- Signatures are checked with `ecrecover` first (Solady `ECDSA.tryRecoverCalldata`) and then ERC-1271 (Solady `SignatureCheckerLib.isValidERC1271SignatureNowCalldata`), so EOA, EIP-7702 and ERC-1271 signers are accepted. Trying `ecrecover` first skips a cold `EXTCODESIZE` (10,100 gas on Monad) for EOAs.
- Used nonces are stored as a bitmap: nonces that share their upper 248 bits share one storage word. Random nonces always work; an app that picks a random 248-bit prefix and counts up in the low byte pays for a new storage slot once per 256 actions.
- Deposits use AUSD `receiveWithAuthorization`, the bytes-signature variant, with `to = the calling contract`, so a third party cannot front-run them.
- The safety net uses AUSD `permit(member, pot, value, deadline, v, r, s)`.
- A permit that has already been used, for example after a replay, must not make `join` revert. Wrap it in try/catch and continue if the allowance is already at least `value`.

## Membership

- **`createPot`**
  - The creator signs `CreatePot` on the factory domain; the factory deploys and initialises the pot.
  - The creator becomes member 0 inside `Pot.initialize` (the factory-only creator join: the CreatePot signature covers every parameter, and the invite proof is implied). In the same transaction the factory then processes the creator's optional extras through paths that need no further pot signature: the deposit through `pot.contribute` (the pot is the ERC-3009 recipient), the permit directly on AUSD (same try/catch rule as `join`) and the key through `KeyRegistry.register`. `safetyNet.value` must equal `params.creatorSafetyNet`.
  - The extras are not covered by the CreatePot signature: someone who front-runs the signed request without them only creates the same pot, and the deposit can follow with `contribute`.
  - `startTime <= endTime` is required. A `startTime` in the past is treated as now, so a signed request still lands a few blocks later; `PotCreated` carries the effective start. Maximum duration is 365 days.
- **`join`**
  - Requires a valid `Invite(member)` signature from the current `inviteSigner`, plus the member's own `Join` signature.
  - The member must not be in the pot already; this includes members who have exited.
  - Fails if the pot is settled or it already has `MAX_MEMBERS` members. Exited members keep their slot, so this caps members ever admitted (active and exited), which bounds every loop.
  - Optional parts in one transaction: deposit (3009), safety-net permit, and `KeyRegistry.register`.
  - Records the country.
  - Joining resets acks.
- `isMember(account)` is true for active members only.
- **`rotateInvite`**: any active member may replace the invite signer, which makes old links stop working.
- **`postKeyWraps`**: any active member may publish group-key wraps for members. These are events only; nothing is stored.

## Ledger and the core invariant

Each member has `contributed`, `personalPaid`, `share` and `withdrawn` (onchain the pot keeps only `net` and `contributed`, in one storage slot; the four components follow from events):

```
net(m) = contributed + personalPaid − share − withdrawn
```

| Event | Ledger change |
|---|---|
| contribute / deposit / pull | `contributed += amount` |
| PAY or LINK spend executes | pot sends `amount` out; each split member `share += their part` |
| PERSONAL spend executes | proposer `personalPaid += amount`; each split member `share += part` |
| payout (exit, settle, debt distribution, `collect`) | `withdrawn += amount` |
| escrow refund before settlement | the spend's current shares are reversed exactly and its amount becomes 0 (claims are all or nothing, so a refund is always the full amount) |

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
| 5 | Payee not allowed by the payee policy (PAY only; LINK and PERSONAL are always allowed). The pot itself and the ClaimEscrow are never allowed PAY payees, under any policy |
| 6 | Over the category budget: `categorySpent[c] + amount > budget[c]`, with budget > 0 |
| 7 | Over the member daily cap (UTC day bucket `now / 1 days`) |
| 8 | Over the member total cap |
| 9 | Not enough money in the pot (PAY, LINK) |
| 10 | Invalid split |
| 11 | Malformed request: amount is zero or does not fit in 96 bits, category > 7, or a PAY/LINK spend with a zero payee |

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
- A `vote(reject)` cancels the proposal when the remaining possible approvals (approvals so far plus active members who have not voted) can no longer reach the threshold.
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
  - The opener must be an active member, and the spend must not have been refunded from escrow.
  - Opening resets acks.
- **Voting:** eligible voters are active members other than the spend's proposer and the dispute's opener.
- **Resolution:**
  - The proposer can call `resolveDispute` with `Resplit` (a new valid split of the same amount) or `SpenderCovers` (the whole amount assigned to the proposer). Either resolves immediately.
  - Otherwise `finalizeDispute` after `DISPUTE_PERIOD = 48 hours`, or earlier once there is at least one eligible voter and every eligible voter has voted. Voting closes at the end of the period. A strict majority of votes cast for `spenderCovers` gives SpenderCovers; anything else gives Keep.
  - With no eligible voters and no proposer action, the result is Keep after the period.
- A dispute changes only `share` assignments. Money never moves, so I1 holds.

## Freeze

- `freeze`: any active member, at most once per 24 h per member. It blocks propose, execute and vote-execution until `now + 24 hours`. A second freeze extends it to `max(until, now + 24 h)`.
- `voteUnfreeze`: when a majority of active members have voted, during the current freeze, the freeze lifts. Votes count for one freeze episode: an extension keeps them, a freeze that starts after the previous one ended starts a new count.

## Rule changes

- `proposeRules`: any active member. It needs MAJORITY approval, counting the proposer, within `proposalTtl`.
- On approval, `eta = now + ruleTimelock` (the timelock of the rules in force at approval); `applyRules` is callable by anyone at or after `eta`, until the pot settles. Reject votes are recorded but do not cancel a rule change; it simply expires.
- Applying a change never alters open proposals.
- The allowlist is changed in the same flow; removals are applied before additions.

## Ending

- **`ack`**: an active member confirms the plan's summary. It records `ackEpoch`. The epoch increments, resetting all acks, on any spend execution, dispute open or resolution, join, exit, rule change, or escrow refund before settlement.
- **`settle()`** is callable by anyone when not settled, there are no Pending/Approved proposals or open disputes, and one of these holds:
  - (a) `now >= endTime + reviewWindow`; or
  - (b) every active member has acked in the current epoch (this is also how a plan ends early).
- **Settlement:**
  1. For each member with `net < 0`, pull `min(−net, allowance, balance)` with `transferFrom` inside try/catch. Each pull counts as contributed and emits `Pulled`.
  2. Let `C = Σ max(net, 0)` and `B` the pot balance.
  3. If `B >= C`, pay each creditor their net.
  4. Otherwise pay `net * B / C`, floored, and the remaining positive nets stay as claims. Every remaining negative net is emitted as `DebtRecorded`.
  - A payout whose transfer fails (for example to an address AUSD refuses) is skipped and stays as that member's claim, so one recipient cannot block settlement. The member gets it later with `collect`.
  5. Mark the pot settled and emit `Settled(by, paidOut, pulledIn, unpaidClaims, fxRoundId)`. Spending stops for good.
  - `fxRoundId` is `FxReference.latestRoundTime()`'s round if its scheduled time is at most `MAX_FX_AGE` (6 h) before the settle block, else 0. It labels the settlement for display and changes no amount. Settlement never fails because of FX: no FxReference, a reverting or misbehaving FxReference, or malformed return data all give 0. The read gets at most 100,000 gas; only a read starved by the submitter's gas limit reverts the settle (`InsufficientGas`, the same rule as payouts), so the round cannot be suppressed by choosing a gas limit.
- **`collect(member)`**: after settlement, anyone may call it. It pays `member`, and nobody else, what the pot still owes them:
  - `C = Σ max(net, 0)` over every member ever (active and exited), `B` = the pot balance.
  - If `B >= C`: `amount = net(member)`. Otherwise `amount = net(member) × B / C`, floored, so never more than the net. A collect in a short pot takes the member's pro-rata share of what is left, and the rest of the claim stays for later (debt payments and refunds are distributed pro rata to every positive net).
  - Reverts: `NotSettled` before settlement, `NotMember` for an address never admitted, `NothingToCollect` when `net <= 0` or the amount floors to 0, `PayoutRefused` when AUSD refuses the transfer (for example a frozen account; the claim is kept and can be collected later), `InsufficientGas` when the submitter starved the transfer.
  - On success: `withdrawn += amount`, `Payout(member, amount)` and `Collected(member, by = msg.sender, amount)`.
  - Only `member`'s net changes and only `member` is paid, so no other member's state (a frozen account, a refusing recipient, a debt) can block it.
- **`payDebt`**: a member with `net < 0` deposits up to `−net` with 3009. After settlement the amount is immediately distributed pro rata (floored) to members with `net > 0`, emitting `DebtPaid` and `Payout`. Before settlement only exited members can pay debt (active members `contribute`); the payment stays in the pot and is paid out by `settle`.
- **`exit`**:
  - Allowed when the member is not the proposer of a Pending or Approved proposal, is not the opener or subject of an open dispute, and the pot is not settled.
  - If `net > 0`, pay `min(net, balance)`. If `net < 0`, pull as in settlement and record any rest as debt.
  - The member becomes inactive: no votes, no new splits; shares already assigned stay.
- **Escrow refund after settlement**: shares are reversed as before settlement, then the refunded amount is distributed to positive nets.
- **Escrow claims**: a claim is claimable until `expiry` inclusive and refundable only after it, so it is never both.
- **Unsolicited transfers**: AUSD sent to a pot directly is credited to no one and stays in the pot; I1 then holds as `Σ net ≤ balance`.

## FX reference rates

### FxReference

A Chainlink CRE workflow (`cre/fx-workflow`) fetches keyless FX sources, takes a median per currency, and writes a report through Chainlink's forwarder to `FxReference.onReport(metadata, report)` (the CRE `IReceiver` interface; `supportsInterface` answers for `IReceiver` and ERC-165).

- **Rates:** USD per one unit of each currency, 8 decimals. AUSD is treated as USD, so `rateOf(id, "USD") = 1e8` for every existing round. Fixed currency list, in report order: GBP, EUR, INR, NGN, JPY, CHF, AED, SGD.
- **Report:** `abi.encode(uint64 chainSelector, uint64 scheduledTime, uint32 rateDate, bytes3[] currencies, uint64[] usdPerUnitE8, uint8[] sourceMasks)`.
  - `chainSelector` must equal this chain's CCIP selector (Monad testnet 2183018362218727504, mainnet 8481857512324358265): DON signatures do not commit to a chain.
  - `scheduledTime` is the cron trigger's scheduled time. It must be greater than the last accepted one (replay protection: the forwarder does not mark a reverted delivery as used) and at most 5 minutes ahead of the block.
  - `rateDate` is the newest source's reference date, yyyymmdd (informational).
  - `currencies` must be exactly the fixed list. A rate of 0 means the currency is absent from the round (its mask must be 0).
  - `sourceMasks[i]`: bit 0 Frankfurter v2 (ECB provider), bit 1 fawazahmed0 currency-api, bit 2 Frankfurter v2 central-bank blend (only for currencies the ECB does not publish: NGN, AED). A present rate needs at least 2 known bits.
  - Every present rate must be within `maxMoveBps` (default 1,000 = 10 %) of the last accepted rate for that currency (the last round that carried it). At least one rate must be present.
- **Rounds:** `roundId` increments from 1. Each stores `scheduledTime`, `writtenAt` (block time), `rateDate`, the per-currency rates and masks, and their OR `sourceMask`. Rounds are append-only. Event: `RoundWritten(roundId, scheduledTime, rateDate, sourceMask, usdPerUnitE8[], sourceMasks[])`.
- **Views:** `latestRound()`, `round(id)` (empty with `roundId = 0` if missing), `rateOf(id, ccy)` (0 if the round or currency is missing), `latestRoundTime()`, `roundTime(id)`, `latestRoundId()`, `currencies()`.
- **Who can write:**
  - *Simulation mode* (deploy-time mode; `simTransmitter != 0`): `msg.sender` must be the chain's Chainlink MockKeystoneForwarder (`SIM_FORWARDER`, fixed at deployment: testnet `0xB9F79d863261869B234c481D1f9A7af84AeAd192`, mainnet `0x9eF6468C5f37b976E57d52054c693269479A784d`) and `tx.origin` must be `simTransmitter`, the wallet that runs `cre workflow simulate --broadcast`. The mock forwarder is permissionless, checks no DON signatures and passes placeholder metadata, so **this is a demo guard**: a simulation-mode round is only as trustworthy as that one key and the one machine that ran the simulation.
  - *Production mode* (`simTransmitter == 0`): `msg.sender` must be the configured KeystoneForwarder (which checks the DON's f+1 signatures; testnet `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`, mainnet `0x76c9cf548b4179F8901cda1f8623568b58215E62`), and the metadata (`workflowId(32) | workflowName(10) | workflowOwner(20) | reportId(2)`) must carry the expected workflow id and workflow owner. Production mode can never use the mock forwarder.
- **Owner powers** (two-step handover): `setSimulationMode(transmitter)`, `setProductionMode(forwarder, workflowId, workflowOwner)`, `setMaxMoveBps(1..10,000)`. The owner cannot edit or delete rounds and has no path to any funds; a compromised owner could make future rounds (and receipts citing them) show wrong reference rates, never move money.

### Staleness

`MAX_FX_AGE = 6 hours`, measured from a round's `scheduledTime` (when the workflow's sources were read), not from when it landed onchain, so a delayed or replayed old report never looks fresh. The workflow runs every 30 minutes, so a 6-hour gap means the oracle is down. In simulation mode rounds are only written when someone runs the simulation, so run one shortly before a demo. Apps should also show `rateDate`: the ECB publishes on TARGET working days only, so a Friday rate is legitimately current over a weekend.

### PlansSend FX fields

`SendMeta` = `{to, fromCountry, toCountry, fromCurrency, toCurrency, fxRateE8, fxTimestamp, fxRoundId, memoHash, salt}`; the 3009 nonce is still `keccak256(abi.encode(meta))`, so the sender's signature covers the applied rate and the round.

- `fxRateE8` is the **applied** rate the app showed: units of `toCurrency` per 1 `fromCurrency`, 8 decimals.
- `fxRoundId = 0`: no FX reference; `Sent` carries `refRateE8 = 0`, `fxDiffBps = 0`. Sends never depend on the oracle being up.
- `fxRoundId != 0`: the round must exist (`FxRoundUnknown`), be at most `MAX_FX_AGE` old (`FxRoundStale`), and carry both currencies (`FxPairUnavailable`; "USD" is always present). Then `refRateE8 = usdPer(from) × 1e8 / usdPer(to)`, floored, and `fxDiffBps = (fxRateE8 − refRateE8) × 10,000 / refRateE8`, rounded toward zero. A reference that floors to 0 counts as unavailable.
- `Sent(from, to, amount, fromCountry, toCountry, fromCurrency, toCurrency, fxRateE8, fxTimestamp, memoHash, fxRoundId, refRateE8, fxDiffBps)`. The FX fields are display and transparency only: **the AUSD amount moved is always `auth.value`**, whatever the rates say. `previewReference(meta)` returns what `send` would record.

## KeyRegistry

`RegisterKey` has no nonce. A registration is accepted only if its `deadline` is later than the deadline of the account's current registration, so an older signature can never restore an older key. `join` and `createPot` skip the registration when the account already has that key.

## Constants

| Name | Value |
|---|---|
| MAX_MEMBERS | 50 |
| DISPUTE_PERIOD | 48 hours |
| FREEZE_DURATION | 24 hours |
| LINK_EXPIRY | 7 days, capped at `endTime + reviewWindow` |
| Max memo / meta / key-wrap bytes | 512 |
| MAX_FX_AGE (PlansSend, Pot) | 6 hours, from the round's scheduled time |
| FxReference max move (default) | 1,000 bps (10 %) per currency per round, owner-settable 1..10,000 |
| FxReference future skew | 5 minutes |

## Rules presets (app side)

| Preset | instantMax | oneApprovalMax | highTier | Daily cap | proposalTtl | ruleTimelock |
|---|---|---|---|---|---|---|
| Easygoing | $100 | uint64 max | MAJORITY | none | 24 h | 1 h |
| **Balanced (default)** | $25 | $200 | MAJORITY | $150 | 24 h | 1 h |
| Strict | $0 | $100 | ALL | $100 | 24 h | 1 h |
| Pilot | $0.25 | $1.00 | MAJORITY | none | 24 h | 1 h (plan lasts 48 h, review window 0) |

**Demo plans:** judges' plan and "Try a settle-up". Instant $0.25 and one approval up to $1. A 5-minute ruleTimelock and reviewWindow of 0.
