# Static analysis: Plans contracts

Scope: `contracts/src` (Pot, PlansFactory, ClaimEscrow, KeyRegistry, PlansSend, FxReference, AUSDLib, AuthLib, interfaces). Tests, scripts and `lib/` are excluded.

Last re-run: 7 Oct 2026, after adding `Pot.collect` (Stage A finding F1), `FxReference` (Chainlink CRE receiver), PlansSend's FX reference fields and the settlement round. The new findings and their dispositions are in [Re-run: collect and FxReference](#re-run-collect-and-fxreference-7-oct). Every location in this file refers to the current source.

## Tools and commands

| Tool | Version | Command (run from `contracts/`) |
| --- | --- | --- |
| Slither | 0.11.4 (first run), 0.11.6 (re-run) | `slither . --filter-paths "lib/\|test/\|script/" --exclude-dependencies --json <out>` (note: it runs `forge clean`; run `forge build` afterwards) |
| Aderyn | 0.6.8 | `aderyn . --src src -o <out>` |
| Foundry | forge 1.5.0-stable, solc 0.8.28, `via_ir = true`, `evm_version = "prague"` | `forge build && forge test` |

## Counts by severity

Slither:

| Severity | Before fixes | After fixes | After collect + FxReference |
| --- | --- | --- | --- |
| High | 1 | 1 | 1 |
| Medium | 21 | 21 | 26 (+1 `tx-origin`, +4 `uninitialized-local`) |
| Low | 53 | 53 | 60 (+3 `missing-zero-check`, +1 `reentrancy-events`, +3 `timestamp`) |
| Informational | 3 | 3 | 9 (+1 `assembly`, +1 `cyclomatic-complexity`, +2 `naming-convention`, +2 `unused-state`) |
| Total | 78 | 78 | 96 |

Aderyn (issue types / instances):

| Severity | Before fixes | After fixes | After collect + FxReference |
| --- | --- | --- | --- |
| High | 1 / 3 | 1 / 3 | 2 / 4 (+ `tx-origin-used-for-auth`) |
| Low | 9 / 36 | 9 / 39 | 13 / 55 (new types `centralization-risk` 4, `large-numeric-literal` 3, `state-no-address-check` 1, `unused-state-variable` 1; +1 each `costly-loop`, `require-revert-in-loop`, `push-zero-opcode`, `unspecific-solidity-pragma`; +2 `literal-instead-of-constant`) |

The counts do not drop because the one genuine problem (below) was not a finding the tools describe directly; it sits behind the try/catch payouts that Slither reports as `calls-loop` and Aderyn as `unsafe-erc20-operation`. The fix keeps those calls in loops and inside try/catch on purpose. It adds three Aderyn `require-revert-in-loop` instances (the new out-of-gas revert is reachable from the payout and pull loops). Every finding is triaged below.

Locations refer to the current source. (The first fix moved `Pot.sol` lines after 139 down by 1 to 16; `collect`, the FX read and their constants and errors moved them again, by 7 to 72. Every reference below was re-checked against the re-run's tool output.)

## Fix: out-of-gas payouts could be skipped (Medium)

**Problem.** Payouts (`Pot._tryPay`) and safety-net pulls (`Pot._pull`) wrap the AUSD call in try/catch, so that one account AUSD refuses (for example a frozen address) cannot block settlement for everyone else. The catch could not tell a real refusal from an out-of-gas failure. Under EIP-150 a call gets at most 63/64 of the remaining gas, so whoever submits the transaction can choose a gas limit at which the AUSD transfer runs out of gas while the remaining 1/64 is still enough to finish the transaction. After settlement there is no function that pays out a skipped claim again, so that creditor's money stays in the pot.

The attack works where little work follows the last payout: `payDebt` after settlement and `ClaimEscrow.refund` → `Pot.onEscrowRefund` after settlement (both end in `_distribute`). Anyone can submit either (the `payDebt` authorisation can be copied from a pending transaction; `refund` is open to anyone once a claim expires). The test below confirms it on the mock token: 66 gas limits between 20k and 200k made `payDebt` succeed with the creditor unpaid. In `settle` and `exit` the work after the last call (events, further payouts, `_resetAcks`) needs far more than 1/64 of an AUSD transfer, so it does not work there today. The same guard covers them in case AUSD (an upgradeable token) gets more expensive.

**Fix** (`src/Pot.sol`): record `gasleft()` before the AUSD call, and in the catch call `_revertIfOutOfGas(gasBefore)`, which reverts with the new `InsufficientGas()` error if `gasleft() <= gasBefore / 63`. A call that ran out of gas leaves at most `gasBefore / 64`. A real refusal leaves almost all the gas. Real refusals are still skipped and kept as claims or debt, as `docs/protocol.md` specifies. A starved call now reverts, and resubmitting with enough gas succeeds.

- Locations: `Pot._pull` (src/Pot.sol:1137-1149), `Pot._tryPay` (src/Pot.sol:1153-1165), new `Pot._revertIfOutOfGas` (src/Pot.sol:1172-1174), new `error InsufficientGas()` (src/Pot.sol:147).
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

- src/Pot.sol:1141-1146 in `Pot._pull`: `IAUSD(ausd).transferFrom(account, address(this), amount)`.

`account` is never caller-supplied:

- In `exit` (src/Pot.sol:809) it is `member`, who signed the `Exit` message checked by `_useSignature`.
- In `settle` (src/Pot.sol:837) it is `_members[i].account`, a member of this pot.

Membership itself requires the account's own EIP-712 signature: `Join` (src/Pot.sol:321-327) for joiners, or `CreatePot` verified by the factory for the creator. Both are bound to this clone's address through the domain separator. The destination is always the pot itself. The amount is `min(-net, allowance, balance)` (src/Pot.sol:1138), so at most the member's own recorded debt to this pot. The allowance is one the member gave this specific pot as its safety net: through `permit` in `join` or `createPot`, where `safetyNet.value` is covered by the member's `Join` or `CreatePot` signature, or by a direct `approve`.

A third party cannot point the pull at another address or another pot's allowance, and cannot take more than the member's debt. The debt itself only arises from spends under the rules the member joined with (approval tiers, caps, disputes). Pulling up to that debt is the documented safety net (docs/protocol.md, Settlement step 1). `ClaimEscrow.createFromPot` uses `transferFrom(msg.sender, ...)` and was not flagged.

### incorrect-equality (Medium): 3 instances, False positive

- src/Pot.sol:1139 `amount == 0` in `_pull`: an early return when nothing can be pulled. It does not compare a balance against an expected value. Extra AUSD sent to anyone can only change how much is pulled (still capped by debt and allowance), never block it.
- src/Pot.sol:1265 `st.day == _today()` in `_spendCheck`, and src/Pot.sol:1341 `st.day == today` in `_execute`: equality of UTC day numbers (`block.timestamp / 1 days`) that selects the daily-cap bucket. Equality is the intended test.

### reentrancy-no-eth (Medium): 4 instances, False positive

- src/Pot.sol:1153-1165 `_tryPay`: `net` is reduced after `transfer` (src/Pot.sol:1162).
- src/Pot.sol:896-908 `payDebt`: `_credit` (src/Pot.sol:905) runs after `AUSDLib.receiveFrom` (src/Pot.sol:904).
- src/Pot.sol:896-908 `payDebt`: `_distribute` (src/Pot.sol:907) writes nets after `receiveFrom` and transfers.
- src/Pot.sol:828-863 `settle`: `_tryPay` (src/Pot.sol:852) writes nets after the pulls and transfers.

The only external contract called in these paths is AUSD, which has no hooks and cannot call back (see Trust facts). Any ERC-1271 check inside AUSD's `receiveWithAuthorization` is a view call. The order is also deliberate:

- `_tryPay` reduces `net` only once the transfer has succeeded, so a refused payout stays as the member's claim.
- `payDebt` credits only after `receiveWithAuthorization` has moved the money. If that reverts, nothing is credited.
- `settle` sets `settled = true` (src/Pot.sol:830) before any external call, which closes `settle`, `exit`, `contribute`, `join` and the spending paths.

### uninitialized-local (Medium): 14 instances, False positive

Each of these is an accumulator, a bitmap or a result that is meant to start at zero, which is Solidity's default:

- src/Pot.sol:799 `exit.paidOut`, src/Pot.sol:800 `exit.pulledIn`: zero unless the member is paid out or pulled.
- src/Pot.sol:834 `settle.pulledIn`, src/Pot.sol:841 `settle.credit`, src/Pot.sol:847 `settle.paidOut`, src/Pot.sol:856 `settle.unpaidClaims`: running sums.
- src/Pot.sol:776 `applyRules.metMin`, src/Pot.sol:1289 `_executionCheck.mask`, src/Pot.sol:1385 `_readSplit.seen`: bitmaps built with `|=`.
- src/Pot.sol:1210 `_distribute.credit`, src/Pot.sol:1436 `_parts.total`: running sums.
- src/Pot.sol:1403 `_storeSplit.packed`: a word built with `|=`, declared inside the per-word loop, so it is fresh for every word.
- src/Pot.sol:1421 `_loadSplit.packed`: loaded at `k % 6 == 0`, which includes the first iteration, before it is read.
- src/Pot.sol:1345 `_execute.claimId`: stays 0 for PAY and PERSONAL spends, meaning "no claim" in `SpendExecuted`. ClaimEscrow ids start at 1 (`++claimCount`), so 0 is unambiguous.

### missing-zero-check (Low): 5 instances, Accepted

- src/ClaimEscrow.sol:57 `ausd_`
- src/PlansFactory.sol:47 `ausd_`, `keyRegistry_` and `fxReference_` (also passed to the ClaimEscrow and Pot constructors)
- src/PlansSend.sol:35 `ausd_` and `fxReference_`
- src/Pot.sol:268 `ausd_`

These are one-time constructor arguments of immutable deployments. `script/Deploy.s.sol` checks that AUSD has code (`NoAUSD`) and checks every deployed address against its prediction. The Pot implementation's arguments come from the PlansFactory constructor, and its `claimEscrow_` is freshly deployed there.

A zero address could not lose funds:

- With AUSD at zero, every token call reverts: Solady `SafeTransferLib` reverts for a token without code, and the high-level calls fail when decoding an empty return.
- With `keyRegistry` at zero, only the optional key registration reverts.

The fix would be to redeploy. Adding checks would change initcode only.

### calls-loop (Low): 5 instances, Accepted (related fix applied)

- src/Pot.sol:1138 `allowance` and `balanceOf` in `_pull`, inside `settle`.
- src/Pot.sol:1141-1146 `transferFrom` in `_pull`, inside `settle`.
- src/Pot.sol:1156-1160 `transfer` in `_tryPay`, inside `settle`.
- src/Pot.sol:1156-1160 `transfer` in `_tryPay`, inside `payDebt` → `_distribute`.
- src/Pot.sol:1156-1160 `transfer` in `_tryPay`, inside `onEscrowRefund` → `_distribute`.

The loops are bounded by `MAX_MEMBERS = 50`, because member slots are never reused (`_addMember`). Every state-changing call is in try/catch, so one refusing account cannot block the loop. `allowance` and `balanceOf` are AUSD view functions that do not revert for any address. The gas-starvation case behind these try/catch calls was a real problem and is fixed above.

### reentrancy-benign (Low): 6 instances, False positive

- src/Pot.sol:1120-1124 `_deposit`: `_credit` after `receiveFrom`.
- src/Pot.sol:1327-1355 `_execute`: `_resetAcks` after `claimEscrow.createFromPot`.
- src/Pot.sol:1137-1149 `_pull`: `_credit` after `transferFrom`.
- src/ClaimEscrow.sol:73-87 `createWithAuthorization`: `_create` after `receiveFrom`.
- src/Pot.sol:791-815 `exit`: `_resetAcks` after `_pull`.
- src/Pot.sol:896-908 `payDebt`: `_credit` after `receiveFrom`.

The callees are AUSD, which has no hooks, and `ClaimEscrow.createFromPot`, which only calls `factory.isPot` (view) and AUSD. None can reach back into the caller. Crediting after `receiveWithAuthorization` or `transferFrom` is required: the credit must follow the money. In `_execute` all ledger and status writes happen before the escrow call. Only the ack epoch bump follows it.

### reentrancy-events (Low): 11 instances, False positive

Events are emitted after an external call in:

- src/Pot.sol:1120-1124 `_deposit` (`Contributed`)
- src/Pot.sol:1327-1355 `_execute` (`SpendExecuted`, `AcksReset`)
- src/Pot.sol:1137-1149 `_pull` (`Pulled`)
- src/Pot.sol:1153-1165 `_tryPay` (`Payout`)
- src/ClaimEscrow.sol:73-87 `createWithAuthorization` (`ClaimCreated`)
- src/Pot.sol:791-815 `exit` (`DebtRecorded`, `MemberExited`, `AcksReset`)
- src/Pot.sol:896-908 `payDebt` (`DebtPaid`)
- src/Pot.sol:896-908 `payDebt` (`Payout` via `_distribute`)
- src/ClaimEscrow.sol:105-116 `refund` (`ClaimRefunded`)
- src/PlansSend.sol:44-66 `send` (`Sent`)
- src/Pot.sol:828-863 `settle` (`DebtRecorded`, `Payout`, `Settled`)

No call in these paths can re-enter (see above), so the order of events cannot be changed by an attacker. Several events report the outcome of the call (`Payout` only after a successful transfer, `Pulled` with the amount actually pulled), so they must come after it.

In `ClaimEscrow.refund` the claim is marked `Refunded` (src/ClaimEscrow.sol:109) before the transfer and the `onEscrowRefund` callback. `onEscrowRefund` accepts calls only from the escrow and calls AUSD only.

### timestamp (Low): 26 instances, False positive / Accepted

Accepted: these are intended time windows. Every window is minutes to days (proposal TTL, 48-hour disputes, 24-hour freezes, rule timelock, 7-day link expiry, review window, signature deadlines, UTC day buckets). Validator timestamp drift of a few seconds cannot change any outcome meaningfully. Each boundary is defined in docs/protocol.md.

- src/ClaimEscrow.sol:84 `createWithAuthorization` (`expiry <= block.timestamp`)
- src/ClaimEscrow.sol:93 `claim` (`block.timestamp > c.expiry`)
- src/ClaimEscrow.sol:108 `refund` (`block.timestamp <= c.expiry`)
- src/KeyRegistry.sol:37 `register` (deadline)
- src/PlansFactory.sol:73 and src/PlansFactory.sol:82-90 `createPot` (deadline, start time in event)
- src/Pot.sol:287-288 `initialize` (schedule)
- src/Pot.sol:473 `vote` (proposal expiry)
- src/Pot.sol:504 `execute` (proposal expiry)
- src/Pot.sol:516 `expire` (proposal expiry)
- src/Pot.sol:627 `voteDispute` (dispute period)
- src/Pot.sol:641 `finalizeDispute` (dispute period)
- src/Pot.sol:659, 663, 664 `freeze` (cooldown and freeze end)
- src/Pot.sol:675 `voteUnfreeze` (freeze end)
- src/Pot.sol:746 `voteRules` (expiry)
- src/Pot.sol:759 `applyRules` (timelock)
- src/Pot.sol:965 `canSettle` (end plus review window)
- src/Pot.sol:1048 `_useSignature` (deadline)
- src/Pot.sol:1254, 1255, 1265 `_spendCheck` (plan open, frozen, day bucket)
- src/Pot.sol:1341 `_execute` (day bucket)

False positive: these comparisons do not involve the timestamp. Slither follows values derived from it, for example `required` via `_approvalsRequired`.

- src/Pot.sol:453 `propose` (`required <= 1`)
- src/Pot.sol:729 `proposeRules` (`rc.approvalsRequired <= 1`)
- src/Pot.sol:778 `applyRules` (`contributed >= minContribution`)
- src/Pot.sol:803, 811 `exit` (`paidOut != 0`, `debt != 0`)
- src/Pot.sol:1132 `_credit` (`contributed >= minContribution`)
- src/Pot.sol:1139 `_pull` (`amount == 0`)
- src/Pot.sol:1526 `_sat64` (`x > type(uint64).max`)
- src/Pot.sol:1530 `_min` (`a < b`)

### costly-loop (Informational): 1 instance, Accepted

- src/Pot.sol:1132 `_metMinMask |= ...` in `_credit`, reached from the `settle` pull loop.

This runs at most once per debtor (at most 50 times), and the slot is warm after the first write (100 gas per later write). Collecting the mask in memory would add code for a negligible saving.

### cyclomatic-complexity (Informational): 1 instance, Accepted

- src/Pot.sol:828-863 `settle` (13).

The four loops follow the spec's settlement steps 1-5 one to one. The function is covered by unit, fuzz and invariant tests (I1 `Σ net == balance`). Splitting it would not make it clearer.

### naming-convention (Informational): 1 instance, False positive

- src/interfaces/IPlansPeriphery.sol:155 `IAUSD.DOMAIN_SEPARATOR()`: the name is fixed by EIP-2612 and must match AUSD's ABI.

## Aderyn findings

### H-1 unsafe-casting (High): 3 instances, False positive

- src/Pot.sol:428 `s.amount = uint96(amount)` in `propose`: this line runs only when `reason == OK`. That requires `_requestCheck` to pass, and it returns `R_REQUEST` for `amount > type(uint96).max` (src/Pot.sol:1279), so `propose` reverts with `SpendBlocked(11)` first. This is tested by `test/unit/PotSpending.t.sol:265`, which uses `type(uint96).max + 1`.
- src/Pot.sol:552 `spendId: uint32(spendId)` in `openDispute`: line 530 requires `_spends[spendId].status == Executed && amount != 0`. Spends are only ever written at ids `1..spendCount`, and `spendCount` is a `uint32`. Any larger `spendId` reads an empty slot and reverts with `NothingToDispute`.
- src/Pot.sol:1351 `uint64(expiry)` in `_execute`: `expiry = min(block.timestamp + 7 days, endTime + reviewWindow)`, where `endTime` is a `uint40` and `reviewWindow` a `uint32`, so `expiry < 2^41`.

Other narrowing casts in `src/` were reviewed for the same reasons. Member indices are below 50. Timestamps plus `uint32` durations fit `uint40`. Day numbers fit `uint16` until 2149. Caller-supplied values go through `SafeCastLib`.

### L-1 costly-loop: 7 instances, Accepted

Each loop does one storage write per element because each element is a separate piece of state. Loops are bounded by `MAX_MEMBERS`.

- src/Pot.sol:764, 769 `applyRules`: one `isAllowedPayee` write per listed address. The lists are capped at 50 (src/Pot.sol:715).
- src/Pot.sol:835, 848 `settle`: per-member ledger updates through `_pull` and `_tryPay`.
- src/Pot.sol:1216 `_distribute`: per-member payouts.
- src/Pot.sol:1402 `_storeSplit`: already packs six entries in the local `packed` and writes one slot per word (at most 9).
- src/Pot.sol:1454 `_applyShares`: one `net` update per split member.

### L-2 literal-instead-of-constant: 8 instances, Accepted

- src/Pot.sol:1259 `category < 8`: the length of the `uint64[8]` budget arrays.
- src/Pot.sol:1407 `w[k] << 8`, src/Pot.sol:1427 `>> 8` and `0xffffffff`: the split entry layout documented at `SPLIT_ENTRY_BITS`.
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

- src/Pot.sol:386 `postKeyWraps` (`DataTooLong`): the batch is signed by the member as a whole and must be all or nothing. An oversized wrap is a malformed request.
- src/Pot.sol:835, 848 (`settle`) and src/Pot.sol:1216 (`_distribute`): new with the fix. `InsufficientGas` is reachable from these loops. It fires only when the submitter gave an AUSD call too little gas, and resubmitting with enough gas succeeds. A real refusal is still skipped, so one account can never block the loop.

### L-5 unchecked-return: 5 instances, False positive

- src/Pot.sol:303 `_addMember` in `initialize`: the creator's index is always 0 and not needed.
- src/Pot.sol:367, 384 `_activeIndexOf` in `rotateInvite` and `postKeyWraps`: called only for its `NotActiveMember` revert.
- src/Pot.sol:922 (`onEscrowRefund`) and src/Pot.sol:1490 (`_resolve`): `_applyShares(..., true)` returns the member accounts for event logging. When reversing shares, no event needs them.

### L-6 uninitialized-local-variable: 5 instances, False positive

- src/Pot.sol:386, 777, 1290, 1404, 1437: loop counters (`for (uint256 k; ...)`) that start at zero by default.

### L-7 unsafe-erc20-operation: 1 instance, Accepted (related fix applied)

- src/Pot.sol:1156 `IAUSD(ausd).transfer` in `_tryPay`.

The bool result is checked (`ok = success`). `SafeTransferLib` cannot be used here because it reverts, and the design requires a refused payout to be skipped (docs/protocol.md, Settlement). AUSD returns `bool`. The out-of-gas case of this try/catch was the genuine issue fixed above. Every other transfer in `src/` uses Solady `SafeTransferLib`.

### L-8 unspecific-solidity-pragma: 3 instances, Accepted

- src/interfaces/IPlansPeriphery.sol:2
- src/interfaces/IPlansTypes.sol:2
- src/interfaces/IPot.sol:2

The interfaces use `^0.8.28` so that integrators can import them with a later compiler. Every deployable contract pins `pragma solidity 0.8.28`, and the build uses solc 0.8.28.

### L-9 unused-public-function: 1 instance, Accepted

- src/Pot.sol:958 `activeMemberCount()`: part of `IPot`, which declares it `external`. Changing `public` to `external` would not change the ABI and would save nothing for a no-argument view.

## Re-run: collect and FxReference (7 Oct)

No new finding needed a code change. The genuine design points the tools touch (the simulation-mode `tx.origin` guard, the FxReference owner's powers and the FX read inside `settle`) are deliberate and documented in `docs/protocol.md`. One cosmetic change was made in response: FxReference's metadata offsets and array sizes became named constants (Aderyn `literal-instead-of-constant`, 13 → 10 instances), which Slither in turn reports as `unused-state` (below).

### Slither

- **tx-origin (Medium), 1 instance, Accepted (by design).** src/FxReference.sol:156 `tx.origin != transmitter` in `onReport`. This is the simulation-mode guard: the CRE simulation forwarder (Chainlink's MockKeystoneForwarder) is permissionless (`report` and even `route` can be called by anyone with any metadata) and checks no signatures, so `msg.sender == forwarder` proves nothing and the only thing that identifies the CRE CLI run is the transaction's origin, the `CRE_ETH_PRIVATE_KEY` wallet. The usual `tx.origin` phishing risk (a victim calling a malicious contract that then calls ours) only lets that contract deliver a report *on the transmitter's behalf*, which is then still subject to every report check (chain selector, increasing scheduled time, two sources, 10 % move limit). It is labelled a demo guard in the contract NatSpec, protocol.md and the CRE README; production mode does not use `tx.origin` (forwarder + DON signatures + workflow id/owner). The mock-forwarder path is covered by fork tests on both networks (`test_fork_fxReferenceThroughSimulationForwarder`) and by Stage A.
- **uninitialized-local (Medium), +4, False positive.** src/Pot.sol:879 `collect.credit` (running sum); src/FxReference.sol:198 `_processReport.roundMask`, :199 `packedMasks` (bitmaps built with `|=`), :200 `any` (flag that starts false). All are meant to start at zero.
- **missing-zero-check (Low), +3, Accepted.** src/PlansFactory.sol:47 `fxReference_` and src/PlansSend.sol:35 `fxReference_`: zero is a valid configuration (no FX: pots settle with round 0, sends with `fxRoundId != 0` revert `FxRoundUnknown`), tested by `test_settle_withoutFxReference` and `test_send_noFxReferenceConfigured`. src/FxReference.sol:323 `transferOwnership(newOwner)`: zero cancels a pending two-step handover; ownership only changes in `acceptOwnership`, which `address(0)` can never call.
- **reentrancy-events (Low), +1, False positive.** src/Pot.sol:873-890 `collect`: `Collected` is emitted after the AUSD transfer inside `_tryPay`, which must succeed first (the event reports a payout that happened). AUSD has no hooks (see Trust facts).
- **timestamp (Low), +3, Accepted.** src/Pot.sol:1180-1205 `_freshFxRound` and src/PlansSend.sol:78-91 `_reference` (`MAX_FX_AGE` = 6 h staleness), src/FxReference.sol:176-232 `_processReport` (`MAX_FUTURE_SKEW` = 5 min). Hours-scale windows; a few seconds of validator drift cannot matter, and the FX values are display-only.
- **assembly (Informational), 1, Accepted.** src/Pot.sol:1180-1205 `_freshFxRound`: a `staticcall` with a gas cap that copies at most 64 bytes of return data, so a misbehaving FxReference can neither return-bomb nor revert the settlement (tested with reverting, short, huge, gas-burning and 100 KB-returning mocks in `test/unit/FxSendSettle.t.sol`). Marked `memory-safe`; it writes only scratch memory above the free-memory pointer.
- **cyclomatic-complexity (Informational), +1, Accepted.** src/FxReference.sol:176-232 `_processReport` (15): one branch per report rule, each with its own error and test.
- **naming-convention (Informational), +2, Accepted.** src/FxReference.sol:83 `CHAIN_SELECTOR`, :85 `SIM_FORWARDER`: immutables named like constants (the foundry lint `screaming-snake-case-immutable` is already excluded for the same style).
- **unused-state (Informational), +2, False positive.** src/FxReference.sol:50 `METADATA_ID_END`, :51 `METADATA_OWNER_START`: used as calldata slice bounds in `onReport` (`metadata[0:METADATA_ID_END]`, `metadata[METADATA_OWNER_START:METADATA_OWNER_END]`), which Slither's IR does not attribute.
- Unchanged in count: `arbitrary-send-erc20`, `incorrect-equality`, `reentrancy-no-eth`, `calls-loop`, `reentrancy-benign`, `costly-loop`. `collect` calls AUSD once, not in a loop; `settle`'s FX read is a `staticcall` outside the loops.

### Aderyn

- **H tx-origin-used-for-auth, 1 instance, Accepted (by design).** src/FxReference.sol:156; see Slither `tx-origin` above.
- **L centralization-risk, 4, Accepted.** src/FxReference.sol:290 `setSimulationMode`, :303 `setProductionMode`, :315 `setMaxMoveBps`, :323 `transferOwnership`. The owner's powers are exactly these; it cannot edit rounds or touch funds (FxReference holds none and is never approved). The worst case is wrong reference rates on future receipts, never a wrong amount (PlansSend moves `auth.value` and Pot never prices anything with FX). Documented in the contract, protocol.md and the deploy check output (`fx owner` line).
- **L large-numeric-literal, 3, Accepted.** src/FxReference.sol:53 and src/PlansSend.sol:20 `BPS = 10_000`, src/Pot.sol:47 `FX_READ_GAS = 100_000`: named constants with underscores already.
- **L state-no-address-check, 1, Accepted.** src/FxReference.sol:324 `pendingOwner = newOwner`: zero cancels a pending handover (see above).
- **L unused-state-variable, 1, False positive.** src/Pot.sol:47 `FX_READ_GAS` is used inside the `staticcall` in `_freshFxRound`'s assembly block.
- **L costly-loop, +1, Accepted.** src/FxReference.sol:201: the per-currency loop writes each present rate (8 currencies, 2 slots) and its last-rate slot; one round is ~183k gas on Monad (GAS.md).
- **L require-revert-in-loop, +1, Accepted.** src/FxReference.sol:201: a report is all or nothing; a currency that breaks a rule rejects the round (and the workflow pre-filters currencies that would break the move limit, so one currency does not stall the others; see cre/fx-workflow/README.md).
- **L literal-instead-of-constant, +2 net (10 instances).** src/FxReference.sol:219 and :363 `8 * i`: the byte position of a currency's mask in the packed word, same bit-layout reasoning as the existing Pot and AuthLib instances.
- **L push-zero-opcode / unspecific-solidity-pragma, +1 each.** src/interfaces/IFxReference.sol:2, same as the other interfaces (Monad supports PUSH0; interfaces use `^0.8.28` for integrators).
- Unchanged: `unsafe-casting` (3), `unchecked-return` (5), `uninitialized-local-variable` (6), `unsafe-erc20-operation` (1), `unused-public-function` (1). `collect` reuses `_tryPay`, so its AUSD `transfer` is the same reviewed instance (src/Pot.sol:1156).

## Test results

`forge build && forge test`: 182 tests passed, 0 failed, 0 skipped (the 178 existing tests plus 4 new ones in `test/unit/PotGasGriefing.t.sol`).

After collect and FxReference: 250 tests passed, 0 failed, 0 skipped (19 suites, fork suites included). New: `test/unit/PotCollect.t.sol` (10), `test/fuzz/PotCollectFuzz.t.sol` (2), `test/unit/FxReference.t.sol` (26), `test/unit/FxSendSettle.t.sol` (16), `test/unit/FxReferenceCre.t.sol` (5, the CRE workflow's golden report vector), 3 fork tests per network minus overlap (mainnet 7, testnet 5), 2 regressions, and the invariant `invariant_collectPaysOnlyMemberProRata` with the handler actions `collectPayout` and `freezeAusd`.
