// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {ClaimEscrow} from "../../src/ClaimEscrow.sol";
import {Pot} from "../../src/Pot.sol";
import {MockAUSD} from "../mocks/MockAUSD.sol";
import {PotHandler} from "./PotHandler.sol";

/// @notice Invariants over one pot driven by {PotHandler}. See the handler for the actions and
/// for the independent spend-rule oracle.
/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 200
/// forge-config: default.invariant.show-metrics = true
contract PotInvariants is Test {
    PotHandler internal h;
    Pot internal pot;
    MockAUSD internal ausd;
    ClaimEscrow internal escrow;

    function setUp() public {
        h = new PotHandler();
        pot = h.pot();
        ausd = h.ausd();
        escrow = h.claimEscrow();

        bytes4[] memory s = new bytes4[](26);
        s[0] = PotHandler.joinMember.selector;
        s[1] = PotHandler.contribute.selector;
        s[2] = PotHandler.approveSafetyNet.selector;
        s[3] = PotHandler.proposeSpend.selector;
        s[4] = PotHandler.proposeSmall.selector;
        s[5] = PotHandler.voteSpend.selector;
        s[6] = PotHandler.cancelSpend.selector;
        s[7] = PotHandler.executeSpend.selector;
        s[8] = PotHandler.expireSpend.selector;
        s[9] = PotHandler.openDispute.selector;
        s[10] = PotHandler.resolveDispute.selector;
        s[11] = PotHandler.voteDispute.selector;
        s[12] = PotHandler.finalizeDispute.selector;
        s[13] = PotHandler.freezePot.selector;
        s[14] = PotHandler.voteUnfreeze.selector;
        s[15] = PotHandler.proposeRules.selector;
        s[16] = PotHandler.voteRules.selector;
        s[17] = PotHandler.applyRules.selector;
        s[18] = PotHandler.exitMember.selector;
        s[19] = PotHandler.ackMembers.selector;
        s[20] = PotHandler.settlePot.selector;
        s[21] = PotHandler.payDebt.selector;
        s[22] = PotHandler.claimLink.selector;
        s[23] = PotHandler.refundLink.selector;
        s[24] = PotHandler.warpTime.selector;
        s[25] = PotHandler.replay.selector;
        targetContract(address(h));
        targetSelector(FuzzSelector({addr: address(h), selectors: s}));
    }

    /// I1: Σ net over every member ever (active and exited) == AUSD.balanceOf(pot).
    function invariant_I1_sumNetEqualsPotBalance() public view {
        assertEq(_sumNet(), int256(ausd.balanceOf(address(pot))), "I1");
    }

    /// A settle where every debtor's allowance and balance covered their debt leaves the pot at
    /// exactly 0 with every net 0 (also checked by the handler right after `settle`). It stays
    /// exact afterwards: an escrow refund is the only later money movement, and its reversal makes
    /// the positive nets sum to exactly the refund (every net was 0), so the floored pro-rata
    /// payout `amount * net / credit` equals each `net` and no dust can remain.
    function invariant_cleanSettleDrainsPot() public view {
        assertEq(h.ghostCleanSettleViolations(), 0, "clean settle left money or nets");
        if (!h.ghostCleanSettle()) return;
        assertTrue(pot.settled(), "settled");
        assertEq(ausd.balanceOf(address(pot)), 0, "pot balance after clean settle");
        address[] memory all = pot.members();
        for (uint256 i; i < all.length; ++i) {
            assertEq(pot.netOf(all[i]), 0, "net after clean settle");
        }
    }

    /// Every executed spend was allowed by the rules, budgets, caps, payee policy, freeze, schedule
    /// and funds in force right before the call that executed it, and met the approvals of the
    /// tier computed at proposal time. Category usage matches an independent tally.
    function invariant_executedSpendsObeyRules() public view {
        assertEq(h.ghostExecViolations(), 0, h.lastViolation());
        for (uint8 c; c < 8; ++c) {
            assertEq(pot.categorySpent(c), h.ghostCategorySpent(c), "categorySpent");
        }
    }

    /// Replaying any successful signed call (or 3009 deposit, or claim) always reverts, every
    /// consumed nonce reads as used, and exited members can never rejoin.
    function invariant_noncesNeverReusable() public view {
        assertEq(h.ghostReplaySuccess(), 0, "replay succeeded");
        assertEq(h.ghostRejoins(), 0, "exited or existing member joined again");
        uint256 n = h.usedNonceCount();
        for (uint256 k; k < n; ++k) {
            (address member, uint256 nonce) = h.usedNonceAt(k);
            assertTrue(pot.usedNonce(member, nonce), "used nonce not marked");
        }
    }

    /// A claim is claimed or refunded, never both; claims only with the claim key before expiry and
    /// refunds only after; the escrow holds exactly the open claims.
    function invariant_escrowClaimOrRefund() public view {
        assertEq(h.ghostEscrowViolations(), 0, "claim/refund outside its window or with a wrong key");
        uint256 n = escrow.claimCount();
        uint256 open;
        for (uint256 id = 1; id <= n; ++id) {
            (address source,, uint256 amount,,, ClaimEscrow.Status st) = escrow.claimInfo(id);
            assertEq(source, address(pot), "claim source");
            assertFalse(h.ghostClaimed(id) && h.ghostRefunded(id), "claimed and refunded");
            assertEq(st == ClaimEscrow.Status.Claimed, h.ghostClaimed(id), "claimed status");
            assertEq(st == ClaimEscrow.Status.Refunded, h.ghostRefunded(id), "refunded status");
            if (st == ClaimEscrow.Status.Open) open += amount;
        }
        assertEq(ausd.balanceOf(address(escrow)), open, "escrow balance == open claims");
    }

    /// No AUSD is created or lost: pot + escrow + every actor == everything minted.
    function invariant_ausdConserved() public view {
        address[] memory a = h.actors();
        uint256 sum = ausd.balanceOf(address(pot)) + ausd.balanceOf(address(escrow));
        for (uint256 i; i < a.length; ++i) {
            sum += ausd.balanceOf(a[i]);
        }
        assertEq(sum, ausd.totalSupply(), "conservation");
    }

    function afterInvariant() external view {
        string[26] memory names = [
            "joinMember",
            "contribute",
            "approveSafetyNet",
            "proposeSpend",
            "proposeSmall",
            "voteSpend",
            "cancelSpend",
            "executeSpend",
            "expireSpend",
            "openDispute",
            "resolveDispute",
            "voteDispute",
            "finalizeDispute",
            "freezePot",
            "voteUnfreeze",
            "proposeRules",
            "voteRules",
            "applyRules",
            "exitMember",
            "ackMembers",
            "settlePot",
            "payDebt",
            "claimLink",
            "refundLink",
            "warpTime",
            "replay"
        ];
        for (uint256 i; i < names.length; ++i) {
            console2.log(names[i], h.callCount(i), h.okCount(i));
        }
        console2.log("executions", h.ghostExecutions(), "settled", h.ghostSettled() ? 1 : 0);
        console2.log("clean settle", h.ghostCleanSettle() ? 1 : 0, "post-settle refunds", h.ghostPostSettleRefunds());
    }

    function _sumNet() internal view returns (int256 sum) {
        address[] memory all = pot.members();
        for (uint256 i; i < all.length; ++i) {
            sum += pot.netOf(all[i]);
        }
    }
}
