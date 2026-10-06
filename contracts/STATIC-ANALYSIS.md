# Static analysis: Plans contracts

Scope: `contracts/src` (Pot, PlansFactory, ClaimEscrow, KeyRegistry, PlansSend, AUSDLib, AuthLib, interfaces). Tests, scripts and `lib/` are excluded.

## Tools and commands

| Tool | Version | Command (run from `contracts/`) |
| --- | --- | --- |
| Slither | 0.11.4 | `slither . --filter-paths "lib/\|test/\|script/" --exclude-dependencies --json <out>` |
| Aderyn | 0.6.8 | `aderyn . --src src -o <out>` |
| Foundry | forge 1.5.0-stable, solc 0.8.28, `via_ir = true`, `evm_version = "prague"` | `forge build && forge test` |

## Counts by severity

Slither:

| Severity | Before fixes | After fixes |
| --- | --- | --- |
| High | 1 | 1 |
| Medium | 21 | 21 |
| Low | 53 | 53 |
| Informational | 3 | 3 |
| Total | 78 | 78 |

Aderyn (issue types / instances):

| Severity | Before fixes | After fixes |
| --- | --- | --- |
| High | 1 / 3 | 1 / 3 |
| Low | 9 / 36 | 9 / 39 |

The counts do not drop because the one genuine problem (below) was not a finding the tools describe directly; it sits behind the try/catch payouts that Slither reports as `calls-loop` and Aderyn as `unsafe-erc20-operation`. The fix keeps those calls in loops and inside try/catch on purpose. It adds three Aderyn `require-revert-in-loop` instances (the new out-of-gas revert is reachable from the payout and pull loops). Every finding is triaged below.

Locations refer to the current (post-fix) source. In `Pot.sol`, lines after 139 moved down by 1 to 16 compared with the pre-fix tool output, because one error and the gas check were added.

## Fix: out-of-gas payouts could be skipped (Medium)

**Problem.** Payouts (`Pot._tryPay`) and safety-net pulls (`Pot._pull`) wrap the AUSD call in try/catch, so that one account AUSD refuses (for example a frozen address) cannot block settlement for everyone else. The catch could not tell a real refusal from an out-of-gas failure. Under EIP-150 a call gets at most 63/64 of the remaining gas, so whoever submits the transaction can choose a gas limit at which the AUSD transfer runs out of gas while the remaining 1/64 is still enough to finish the transaction. After settlement there is no function that pays out a skipped claim again, so that creditor's money stays in the pot.

The attack works where little work follows the last payout: `payDebt` after settlement and `ClaimEscrow.refund` → `Pot.onEscrowRefund` after settlement (both end in `_distribute`). Anyone can submit either (the `payDebt` authorisation can be copied from a pending transaction; `refund` is open to anyone once a claim expires). The test below confirms it on the mock token: 66 gas limits between 20k and 200k made `payDebt` succeed with the creditor unpaid. In `settle` and `exit` the work after the last call (events, further payouts, `_resetAcks`) needs far more than 1/64 of an AUSD transfer, so it does not work there today. The same guard covers them in case AUSD (an upgradeable token) gets more expensive.

**Fix** (`src/Pot.sol`): record `gasleft()` before the AUSD call, and in the catch call `_revertIfOutOfGas(gasBefore)`, which reverts with the new `InsufficientGas()` error if `gasleft() <= gasBefore / 63`. A call that ran out of gas leaves at most `gasBefore / 64`. A real refusal leaves almost all the gas. Real refusals are still skipped and kept as claims or debt, as `docs/protocol.md` specifies. A starved call now reverts, and resubmitting with enough gas succeeds.

- Locations: `Pot._pull` (src/Pot.sol:1096-1108), `Pot._tryPay` (src/Pot.sol:1112-1124), new `Pot._revertIfOutOfGas` (src/Pot.sol:1131-1133), new `error InsufficientGas()` (src/Pot.sol:140).
- Signatures: no existing function, event or error changed. One error was added to `Pot` (`InsufficientGas()`, selector `0x1c26714c`). No interface changed.
- Behaviour: unchanged for every call with enough gas. A transaction that runs an AUSD payout or pull out of gas now reverts instead of succeeding with that payout or pull skipped.
- Gas: about 5 gas per payout/pull on the success path (one `GAS` opcode kept on the stack), plus about 30 gas when the call fails. Pot runtime is now 29,368 bytes.
- Residual assumption: a token failure that burns all forwarded gas (the `INVALID` opcode) would now revert instead of being skipped. AUSD is compiled with Solidity 0.8, where failures use `REVERT`.
- Tests (`test/unit/PotGasGriefing.t.sol`):
  - `test_payDebt_gasLimitCannotSkipCreditorPayout`: tries `payDebt` at every gas limit from 20k to 200k in 250-gas steps. Before the fix it fails (`66 != 0` runs skipped the payout). After the fix it passes, and the griefing window reverts with `InsufficientGas`.
  - `test_escrowRefund_gasLimitCannotSkipCreditorPayout`: the same scan for `ClaimEscrow.refund` after settlement. It is a regression guard: with the mock token's cheap transfers the window is closed before the fix too, but it opens with Monad's cold-access prices.
  - `test_payDebt_frozenCreditorStillSkipped`, `test_exit_frozenDebtorPullStillSkipped`: a real refusal (frozen account) is still skipped and kept as a claim or debt, not turned into a revert.

The same class was checked in `AUSDLib.permitOrAllowance` (try/catch around `permit`). Starving that call can only cause a `PermitFailed` revert of the whole call, or let the call go ahead on an allowance that already covers the value. It cannot be abused, so it was left unchanged.

## Trust facts used below

- **External calls.** The contracts only call AUSD, the factory's own `ClaimEscrow` and `KeyRegistry`, `PlansFactory.isPot` (view), `Pot.onEscrowRefund` (from ClaimEscrow only), and ERC-1271 `isValidSignature` on contract signers. ERC-1271 checks use Solady `SignatureCheckerLib`, which uses `STATICCALL`, so a signer contract cannot change state or call back with a state-changing call. `KeyRegistry` and `ClaimEscrow.createFromPot` make no calls that can reach a pot.
- **AUSD.** AUSD (Agora Dollar, `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`) is a plain ERC-20 with ERC-2612 and ERC-3009. It has no transfer hooks (no ERC-777 or ERC-1363 callbacks), so a transfer never calls the sender or the recipient. It reverts on failure and returns `true` on success. The protocol already trusts the issuer (freeze and upgrade powers), so no reentrancy path goes through AUSD.
- **Deposits.** Deposits use `receiveWithAuthorization` with `to = address(this)`, and AUSD requires `msg.sender == to`. The ERC-3009 signature from `from` therefore authorises exactly this deposit into this contract.

## Slither findings

### arbitrary-send-erc20 (High): 1 instance, False positive

- src/Pot.sol:1100-1105 in `Pot._pull`: `IAUSD(ausd).transferFrom(account, address(this), amount)`.

`account` is never caller-supplied:

- In `exit` (src/Pot.sol:795) it is `member`, who signed the `Exit` message checked by `_useSignature`.
- In `settle` (src/Pot.sol:823) it is `_members[i].account`, a member of this pot.

Membership itself requires the account's own EIP-712 signature: `Join` (src/Pot.sol:307-313) for joiners, or `CreatePot` verified by the factory for the creator. Both are bound to this clone's address through the domain separator. The destination is always the pot itself. The amount is `min(-net, allowance, balance)` (src/Pot.sol:1097), so at most the member's own recorded debt to this pot. The allowance is one the member gave this specific pot as its safety net: through `permit` in `join` or `createPot`, where `safetyNet.value` is covered by the member's `Join` or `CreatePot` signature, or by a direct `approve`.

A third party cannot point the pull at another address or another pot's allowance, and cannot take more than the member's debt. The debt itself only arises from spends under the rules the member joined with (approval tiers, caps, disputes). Pulling up to that debt is the documented safety net (docs/protocol.md, Settlement step 1). `ClaimEscrow.createFromPot` uses `transferFrom(msg.sender, ...)` and was not flagged.

### incorrect-equality (Medium): 3 instances, False positive

- src/Pot.sol:1098 `amount == 0` in `_pull`: an early return when nothing can be pulled. It does not compare a balance against an expected value. Extra AUSD sent to anyone can only change how much is pulled (still capped by debt and allowance), never block it.
- src/Pot.sol:1193 `st.day == _today()` in `_spendCheck`, and src/Pot.sol:1269 `st.day == today` in `_execute`: equality of UTC day numbers (`block.timestamp / 1 days`) that selects the daily-cap bucket. Equality is the intended test.

### reentrancy-no-eth (Medium): 4 instances, False positive

- src/Pot.sol:1112-1124 `_tryPay`: `net` is reduced after `transfer` (src/Pot.sol:1121).
- src/Pot.sol:855-867 `payDebt`: `_credit` (src/Pot.sol:864) runs after `AUSDLib.receiveFrom` (src/Pot.sol:863).
- src/Pot.sol:855-867 `payDebt`: `_distribute` (src/Pot.sol:866) writes nets after `receiveFrom` and transfers.
- src/Pot.sol:814-849 `settle`: `_tryPay` (src/Pot.sol:838) writes nets after the pulls and transfers.

The only external contract called in these paths is AUSD, which has no hooks and cannot call back (see Trust facts). Any ERC-1271 check inside AUSD's `receiveWithAuthorization` is a view call. The order is also deliberate:

- `_tryPay` reduces `net` only once the transfer has succeeded, so a refused payout stays as the member's claim.
- `payDebt` credits only after `receiveWithAuthorization` has moved the money. If that reverts, nothing is credited.
- `settle` sets `settled = true` (src/Pot.sol:816) before any external call, which closes `settle`, `exit`, `contribute`, `join` and the spending paths.

### uninitialized-local (Medium): 14 instances, False positive

Each of these is an accumulator, a bitmap or a result that is meant to start at zero, which is Solidity's default:

- src/Pot.sol:785 `exit.paidOut`, src/Pot.sol:786 `exit.pulledIn`: zero unless the member is paid out or pulled.
- src/Pot.sol:820 `settle.pulledIn`, src/Pot.sol:827 `settle.credit`, src/Pot.sol:833 `settle.paidOut`, src/Pot.sol:842 `settle.unpaidClaims`: running sums.
- src/Pot.sol:762 `applyRules.metMin`, src/Pot.sol:1217 `_executionCheck.mask`, src/Pot.sol:1313 `_readSplit.seen`: bitmaps built with `|=`.
- src/Pot.sol:1138 `_distribute.credit`, src/Pot.sol:1364 `_parts.total`: running sums.
- src/Pot.sol:1331 `_storeSplit.packed`: a word built with `|=`, declared inside the per-word loop, so it is fresh for every word.
- src/Pot.sol:1349 `_loadSplit.packed`: loaded at `k % 6 == 0`, which includes the first iteration, before it is read.
- src/Pot.sol:1273 `_execute.claimId`: stays 0 for PAY and PERSONAL spends, meaning "no claim" in `SpendExecuted`. ClaimEscrow ids start at 1 (`++claimCount`), so 0 is unambiguous.

### missing-zero-check (Low): 5 instances, Accepted

- src/ClaimEscrow.sol:57 `ausd_`
- src/PlansFactory.sol:44 `ausd_` and `keyRegistry_` (also passed to the ClaimEscrow and Pot constructors)
- src/PlansSend.sol:19 `ausd_`
- src/Pot.sol:255 `ausd_`

These are one-time constructor arguments of immutable deployments. `script/Deploy.s.sol` checks that AUSD has code (`NoAUSD`) and checks every deployed address against its prediction. The Pot implementation's arguments come from the PlansFactory constructor, and its `claimEscrow_` is freshly deployed there.

A zero address could not lose funds:

- With AUSD at zero, every token call reverts: Solady `SafeTransferLib` reverts for a token without code, and the high-level calls fail when decoding an empty return.
- With `keyRegistry` at zero, only the optional key registration reverts.

The fix would be to redeploy. Adding checks would change initcode only.

### calls-loop (Low): 5 instances, Accepted (related fix applied)

- src/Pot.sol:1097 `allowance` and `balanceOf` in `_pull`, inside `settle`.
- src/Pot.sol:1100-1105 `transferFrom` in `_pull`, inside `settle`.
- src/Pot.sol:1115-1119 `transfer` in `_tryPay`, inside `settle`.
- src/Pot.sol:1115-1119 `transfer` in `_tryPay`, inside `payDebt` → `_distribute`.
- src/Pot.sol:1115-1119 `transfer` in `_tryPay`, inside `onEscrowRefund` → `_distribute`.

The loops are bounded by `MAX_MEMBERS = 50`, because member slots are never reused (`_addMember`). Every state-changing call is in try/catch, so one refusing account cannot block the loop. `allowance` and `balanceOf` are AUSD view functions that do not revert for any address. The gas-starvation case behind these try/catch calls was a real problem and is fixed above.

### reentrancy-benign (Low): 6 instances, False positive

- src/Pot.sol:1079-1083 `_deposit`: `_credit` after `receiveFrom`.
- src/Pot.sol:1255-1283 `_execute`: `_resetAcks` after `claimEscrow.createFromPot`.
- src/Pot.sol:1096-1108 `_pull`: `_credit` after `transferFrom`.
- src/ClaimEscrow.sol:73-87 `createWithAuthorization`: `_create` after `receiveFrom`.
- src/Pot.sol:777-801 `exit`: `_resetAcks` after `_pull`.
- src/Pot.sol:855-867 `payDebt`: `_credit` after `receiveFrom`.

The callees are AUSD, which has no hooks, and `ClaimEscrow.createFromPot`, which only calls `factory.isPot` (view) and AUSD. None can reach back into the caller. Crediting after `receiveWithAuthorization` or `transferFrom` is required: the credit must follow the money. In `_execute` all ledger and status writes happen before the escrow call. Only the ack epoch bump follows it.

### reentrancy-events (Low): 11 instances, False positive

Events are emitted after an external call in:

- src/Pot.sol:1079-1083 `_deposit` (`Contributed`)
- src/Pot.sol:1255-1283 `_execute` (`SpendExecuted`, `AcksReset`)
- src/Pot.sol:1096-1108 `_pull` (`Pulled`)
- src/Pot.sol:1112-1124 `_tryPay` (`Payout`)
- src/ClaimEscrow.sol:73-87 `createWithAuthorization` (`ClaimCreated`)
- src/Pot.sol:777-801 `exit` (`DebtRecorded`, `MemberExited`, `AcksReset`)
- src/Pot.sol:855-867 `payDebt` (`DebtPaid`)
- src/Pot.sol:855-867 `payDebt` (`Payout` via `_distribute`)
- src/ClaimEscrow.sol:105-116 `refund` (`ClaimRefunded`)
- src/PlansSend.sol:26-44 `send` (`Sent`)
- src/Pot.sol:814-849 `settle` (`DebtRecorded`, `Payout`, `Settled`)

No call in these paths can re-enter (see above), so the order of events cannot be changed by an attacker. Several events report the outcome of the call (`Payout` only after a successful transfer, `Pulled` with the amount actually pulled), so they must come after it.

In `ClaimEscrow.refund` the claim is marked `Refunded` (src/ClaimEscrow.sol:109) before the transfer and the `onEscrowRefund` callback. `onEscrowRefund` accepts calls only from the escrow and calls AUSD only.

### timestamp (Low): 26 instances, False positive / Accepted

Accepted: these are intended time windows. Every window is minutes to days (proposal TTL, 48-hour disputes, 24-hour freezes, rule timelock, 7-day link expiry, review window, signature deadlines, UTC day buckets). Validator timestamp drift of a few seconds cannot change any outcome meaningfully. Each boundary is defined in docs/protocol.md.

- src/ClaimEscrow.sol:84 `createWithAuthorization` (`expiry <= block.timestamp`)
- src/ClaimEscrow.sol:93 `claim` (`block.timestamp > c.expiry`)
- src/ClaimEscrow.sol:108 `refund` (`block.timestamp <= c.expiry`)
- src/KeyRegistry.sol:37 `register` (deadline)
- src/PlansFactory.sol:69 and src/PlansFactory.sol:79-87 `createPot` (deadline, start time in event)
- src/Pot.sol:273-274 `initialize` (schedule)
- src/Pot.sol:459 `vote` (proposal expiry)
- src/Pot.sol:490 `execute` (proposal expiry)
- src/Pot.sol:502 `expire` (proposal expiry)
- src/Pot.sol:613 `voteDispute` (dispute period)
- src/Pot.sol:627 `finalizeDispute` (dispute period)
- src/Pot.sol:645, 649, 650 `freeze` (cooldown and freeze end)
- src/Pot.sol:661 `voteUnfreeze` (freeze end)
- src/Pot.sol:732 `voteRules` (expiry)
- src/Pot.sol:745 `applyRules` (timelock)
- src/Pot.sol:924 `canSettle` (end plus review window)
- src/Pot.sol:1007 `_useSignature` (deadline)
- src/Pot.sol:1182, 1183, 1193 `_spendCheck` (plan open, frozen, day bucket)
- src/Pot.sol:1269 `_execute` (day bucket)

False positive: these comparisons do not involve the timestamp. Slither follows values derived from it, for example `required` via `_approvalsRequired`.

- src/Pot.sol:439 `propose` (`required <= 1`)
- src/Pot.sol:715 `proposeRules` (`rc.approvalsRequired <= 1`)
- src/Pot.sol:764 `applyRules` (`contributed >= minContribution`)
- src/Pot.sol:789, 797 `exit` (`paidOut != 0`, `debt != 0`)
- src/Pot.sol:1091 `_credit` (`contributed >= minContribution`)
- src/Pot.sol:1098 `_pull` (`amount == 0`)
- src/Pot.sol:1454 `_sat64` (`x > type(uint64).max`)
- src/Pot.sol:1458 `_min` (`a < b`)

### costly-loop (Informational): 1 instance, Accepted

- src/Pot.sol:1091 `_metMinMask |= ...` in `_credit`, reached from the `settle` pull loop.

This runs at most once per debtor (at most 50 times), and the slot is warm after the first write (100 gas per later write). Collecting the mask in memory would add code for a negligible saving.

### cyclomatic-complexity (Informational): 1 instance, Accepted

- src/Pot.sol:814-849 `settle` (13).

The four loops follow the spec's settlement steps 1-5 one to one. The function is covered by unit, fuzz and invariant tests (I1 `Σ net == balance`). Splitting it would not make it clearer.

### naming-convention (Informational): 1 instance, False positive

- src/interfaces/IPlansPeriphery.sol:138 `IAUSD.DOMAIN_SEPARATOR()`: the name is fixed by EIP-2612 and must match AUSD's ABI.

## Aderyn findings

### H-1 unsafe-casting (High): 3 instances, False positive

- src/Pot.sol:414 `s.amount = uint96(amount)` in `propose`: this line runs only when `reason == OK`. That requires `_requestCheck` to pass, and it returns `R_REQUEST` for `amount > type(uint96).max` (src/Pot.sol:1207), so `propose` reverts with `SpendBlocked(11)` first. This is tested by `test/unit/PotSpending.t.sol:265`, which uses `type(uint96).max + 1`.
- src/Pot.sol:538 `spendId: uint32(spendId)` in `openDispute`: line 530 requires `_spends[spendId].status == Executed && amount != 0`. Spends are only ever written at ids `1..spendCount`, and `spendCount` is a `uint32`. Any larger `spendId` reads an empty slot and reverts with `NothingToDispute`.
- src/Pot.sol:1279 `uint64(expiry)` in `_execute`: `expiry = min(block.timestamp + 7 days, endTime + reviewWindow)`, where `endTime` is a `uint40` and `reviewWindow` a `uint32`, so `expiry < 2^41`.

Other narrowing casts in `src/` were reviewed for the same reasons. Member indices are below 50. Timestamps plus `uint32` durations fit `uint40`. Day numbers fit `uint16` until 2149. Caller-supplied values go through `SafeCastLib`.

### L-1 costly-loop: 7 instances, Accepted

Each loop does one storage write per element because each element is a separate piece of state. Loops are bounded by `MAX_MEMBERS`.

- src/Pot.sol:750, 755 `applyRules`: one `isAllowedPayee` write per listed address. The lists are capped at 50 (src/Pot.sol:701).
- src/Pot.sol:821, 834 `settle`: per-member ledger updates through `_pull` and `_tryPay`.
- src/Pot.sol:1144 `_distribute`: per-member payouts.
- src/Pot.sol:1330 `_storeSplit`: already packs six entries in the local `packed` and writes one slot per word (at most 9).
- src/Pot.sol:1382 `_applyShares`: one `net` update per split member.

### L-2 literal-instead-of-constant: 8 instances, Accepted

- src/Pot.sol:1187 `category < 8`: the length of the `uint64[8]` budget arrays.
- src/Pot.sol:1335 `w[k] << 8`, src/Pot.sol:1355 `>> 8` and `0xffffffff`: the split entry layout documented at `SPLIT_ENTRY_BITS`.
- src/libraries/AuthLib.sol:33, 34, 36, 46 (two at line 46): `0xff` and `>> 8`, the nonce bitmap's bit and word split.

These are bit-layout literals. Naming them would not make the code clearer.

### L-3 push0-opcode: 5 instances, False positive

- src/interfaces/IPlansPeriphery.sol:2
- src/interfaces/IPlansTypes.sol:2
- src/interfaces/IPot.sol:2
- src/libraries/AUSDLib.sol:2
- src/libraries/AuthLib.sol:2

The target is Monad, whose EVM supports Shanghai opcodes (including `PUSH0`) and later. `foundry.toml` sets `evm_version = "prague"` explicitly.

### L-4 require-revert-in-loop: 1 instance before, 4 after, Accepted

- src/Pot.sol:372 `postKeyWraps` (`DataTooLong`): the batch is signed by the member as a whole and must be all or nothing. An oversized wrap is a malformed request.
- src/Pot.sol:821, 834 (`settle`) and src/Pot.sol:1144 (`_distribute`): new with the fix. `InsufficientGas` is reachable from these loops. It fires only when the submitter gave an AUSD call too little gas, and resubmitting with enough gas succeeds. A real refusal is still skipped, so one account can never block the loop.

### L-5 unchecked-return: 5 instances, False positive

- src/Pot.sol:289 `_addMember` in `initialize`: the creator's index is always 0 and not needed.
- src/Pot.sol:353, 370 `_activeIndexOf` in `rotateInvite` and `postKeyWraps`: called only for its `NotActiveMember` revert.
- src/Pot.sol:881 (`onEscrowRefund`) and src/Pot.sol:1418 (`_resolve`): `_applyShares(..., true)` returns the member accounts for event logging. When reversing shares, no event needs them.

### L-6 uninitialized-local-variable: 5 instances, False positive

- src/Pot.sol:372, 763, 1218, 1332, 1365: loop counters (`for (uint256 k; ...)`) that start at zero by default.

### L-7 unsafe-erc20-operation: 1 instance, Accepted (related fix applied)

- src/Pot.sol:1115 `IAUSD(ausd).transfer` in `_tryPay`.

The bool result is checked (`ok = success`). `SafeTransferLib` cannot be used here because it reverts, and the design requires a refused payout to be skipped (docs/protocol.md, Settlement). AUSD returns `bool`. The out-of-gas case of this try/catch was the genuine issue fixed above. Every other transfer in `src/` uses Solady `SafeTransferLib`.

### L-8 unspecific-solidity-pragma: 3 instances, Accepted

- src/interfaces/IPlansPeriphery.sol:2
- src/interfaces/IPlansTypes.sol:2
- src/interfaces/IPot.sol:2

The interfaces use `^0.8.28` so that integrators can import them with a later compiler. Every deployable contract pins `pragma solidity 0.8.28`, and the build uses solc 0.8.28.

### L-9 unused-public-function: 1 instance, Accepted

- src/Pot.sol:917 `activeMemberCount()`: part of `IPot`, which declares it `external`. Changing `public` to `external` would not change the ABI and would save nothing for a no-argument view.

## Test results

`forge build && forge test`: 182 tests passed, 0 failed, 0 skipped (the 178 existing tests plus 4 new ones in `test/unit/PotGasGriefing.t.sol`).
