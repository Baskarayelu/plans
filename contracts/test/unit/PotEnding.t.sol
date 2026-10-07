// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PlansBase} from "../utils/PlansBase.sol";
import {PlansSigs} from "../utils/PlansSigs.sol";
import {MockAUSD} from "../mocks/MockAUSD.sol";
import {IPot} from "../../src/interfaces/IPot.sol";
import {Pot} from "../../src/Pot.sol";

/// @notice Acks, settlement, exit, debt payment and escrow refunds.
contract PotEndingTest is PlansBase {
    address internal shop = address(0x5b0b);

    /// @dev Three members; user 0 deposits 90, users 1 and 2 deposit nothing; user 0 pays 90
    /// for all three. Nets: u0 +60, u1 -30, u2 -30. Pot balance 0.
    function _debtPot() internal returns (Pot pot) {
        Rules memory r = _balancedRules();
        r.instantMax = uint64(100 * USD);
        pot = _createPot(0, _params(r), 90 * USD);
        _join(pot, 1, 0);
        _join(pot, 2, 0);
        _proposeEqual(pot, 0, SpendKind.PAY, shop, 90 * USD, _users(3));
        assertEq(pot.netOf(users[0]), int256(60 * USD));
    }

    // ─────────────── ack ───────────────

    function test_ack() public {
        Pot pot = _potWith(2, _balancedRules(), 0);
        uint256 epoch = pot.ackEpoch();
        vm.expectEmit(address(pot));
        emit IPot.Acked(users[0], epoch);
        _ack(pot, 0);
        vm.expectRevert(Pot.AlreadyAcked.selector);
        _ack(pot, 0);
        assertFalse(pot.canSettle());
        _ack(pot, 1);
        assertTrue(pot.canSettle());
    }

    function test_ack_resetByJoinSpendExitAndRules() public {
        Pot pot = _potWith(3, _balancedRules(), 30 * USD);
        _ackAll(pot);
        assertTrue(pot.canSettle());
        _proposeEqual(pot, 0, SpendKind.PAY, shop, 3 * USD, _users(3));
        assertFalse(pot.canSettle());
        _ackAll(pot);
        _join(pot, 3, 0);
        assertFalse(pot.canSettle());
        _ackAll(pot);
        _exit(pot, 3);
        assertFalse(pot.canSettle());
        _ackAll(pot);
        uint256 rc = _proposeRules(pot, 0, _balancedRules(), new address[](0), new address[](0));
        _voteRules(pot, 1, rc, true);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        assertTrue(pot.canSettle()); // proposing and approving rules does not reset acks
        pot.applyRules(rc);
        assertFalse(pot.canSettle());
    }

    function test_ack_reverts() public {
        Pot pot = _potWith(1, _balancedRules(), 0);
        vm.expectRevert(Pot.NotActiveMember.selector);
        _ack(pot, 4);
        _ack(pot, 0);
        pot.settle();
        vm.expectRevert(Pot.PotSettled.selector);
        _ack(pot, 0);
    }

    // ─────────────── settle ───────────────

    function test_settle_afterReviewWindow() public {
        Pot pot = _potWith(2, _balancedRules(), 50 * USD);
        assertFalse(pot.canSettle());
        vm.expectRevert(Pot.CannotSettle.selector);
        pot.settle();
        vm.warp(uint256(pot.endTime()) + pot.reviewWindow());
        assertTrue(pot.canSettle());
        vm.expectEmit(address(pot));
        emit IPot.Payout(users[0], 50 * USD);
        vm.expectEmit(address(pot));
        emit IPot.Payout(users[1], 50 * USD);
        vm.expectEmit(address(pot));
        emit IPot.Settled(address(this), 100 * USD, 0, 0, 0);
        pot.settle();
        assertTrue(pot.settled());
        assertEq(_balance(address(pot)), 0);
        assertEq(_balance(users[0]), 50 * USD);
        vm.expectRevert(Pot.CannotSettle.selector);
        pot.settle();
    }

    function test_settle_pullsDebtThroughSafetyNet() public {
        Pot pot = _debtPot();
        _fund(users[1], 30 * USD);
        _approveSafetyNet(pot, 1, 30 * USD);
        _fund(users[2], 30 * USD);
        _approveSafetyNet(pot, 2, 30 * USD);
        _ackAll(pot);
        vm.expectEmit(address(pot));
        emit IPot.Pulled(users[1], 30 * USD);
        vm.expectEmit(address(pot));
        emit IPot.Pulled(users[2], 30 * USD);
        vm.expectEmit(address(pot));
        emit IPot.Payout(users[0], 60 * USD);
        vm.expectEmit(address(pot));
        emit IPot.Settled(address(this), 60 * USD, 60 * USD, 0, 0);
        pot.settle();
        assertEq(_balance(address(pot)), 0);
        assertEq(pot.netOf(users[0]), 0);
        assertEq(pot.netOf(users[1]), 0);
        assertEq(pot.netOf(users[2]), 0);
    }

    function test_settle_partialPullIsProRataAndRecordsDebt() public {
        Pot pot = _debtPot();
        _fund(users[1], 30 * USD);
        _approveSafetyNet(pot, 1, 20 * USD); // allowance-limited
        _fund(users[2], 5 * USD);
        _approveSafetyNet(pot, 2, 30 * USD); // balance-limited
        _ackAll(pot);
        vm.recordLogs();
        pot.settle();
        // pulled 25, all of it goes to user 0 (sole creditor): C = 60, B = 25
        assertEq(_balance(address(pot)), 0);
        assertEq(pot.netOf(users[0]), int256(35 * USD));
        assertEq(pot.netOf(users[1]), -int256(10 * USD));
        assertEq(pot.netOf(users[2]), -int256(25 * USD));
        _assertI1(pot);
    }

    function test_settle_partialPayoutFloors() public {
        // two creditors, pot short: payouts are net * B / C floored, rest stays as claims
        Rules memory r = _balancedRules();
        r.instantMax = uint64(100 * USD);
        Pot pot = _createPot(0, _params(r), 10 * USD);
        _join(pot, 1, 20 * USD);
        _join(pot, 2, 0);
        // user 2 owes 15 via a PERSONAL spend by user 1 (users 2 only)
        _propose(pot, 1, SpendKind.PERSONAL, shop, 15 * USD, 0, _addrs(users[2]), _ones(1));
        // nets: u0 10, u1 35, u2 -15; B = 30, C = 45 after no pull
        _ackAll(pot);
        pot.settle();
        assertEq(_balance(users[0]), uint256(10 * USD) * 30 / 45);
        assertEq(_balance(users[1]), uint256(35 * USD) * 30 / 45);
        _assertI1(pot);
        assertEq(pot.netOf(users[2]), -int256(15 * USD));
    }

    function test_settle_blockedByOpenItems() public {
        Pot pot = _potWith(3, _balancedRules(), 100 * USD);
        uint256 s = _proposeEqual(pot, 0, SpendKind.PAY, shop, 3 * USD, _users(3));
        _openDispute(pot, 1, s, 0);
        vm.warp(uint256(pot.endTime()) + pot.reviewWindow());
        assertFalse(pot.canSettle());
        vm.expectRevert(Pot.CannotSettle.selector);
        pot.settle();
    }

    function test_settle_frozenRecipientKeepsClaim() public {
        Pot pot = _potWith(2, _balancedRules(), 50 * USD);
        MockAUSD(token).setFrozen(users[1], true);
        _ackAll(pot);
        pot.settle();
        assertEq(_balance(users[0]), 50 * USD);
        assertEq(pot.netOf(users[1]), int256(50 * USD));
        assertEq(_balance(address(pot)), 50 * USD);
        _assertI1(pot);
    }

    function test_settle_allExitedSettlesEarly() public {
        Pot pot = _potWith(2, _balancedRules(), 0);
        _exit(pot, 0);
        _exit(pot, 1);
        assertTrue(pot.canSettle());
        pot.settle();
    }

    // ─────────────── exit ───────────────

    function test_exit_paysPositiveNet() public {
        Pot pot = _potWith(3, _balancedRules(), 30 * USD);
        _proposeEqual(pot, 0, SpendKind.PAY, shop, 9 * USD, _users(3));
        vm.expectEmit(address(pot));
        emit IPot.Payout(users[1], 27 * USD);
        vm.expectEmit(address(pot));
        emit IPot.MemberExited(users[1], int256(27 * USD), 27 * USD, 0);
        _exit(pot, 1);
        assertFalse(pot.isMember(users[1]));
        assertEq(pot.activeMemberCount(), 2);
        assertEq(pot.netOf(users[1]), 0);
        assertEq(_balance(users[1]), 27 * USD);
        _assertI1(pot);
        // exited members cannot act, and are not in new splits
        vm.expectRevert(Pot.NotActiveMember.selector);
        _ack(pot, 1);
    }

    function test_exit_pullsDebtAndRecordsRest() public {
        Pot pot = _debtPot();
        _fund(users[1], 10 * USD);
        _approveSafetyNet(pot, 1, 100 * USD);
        vm.expectEmit(address(pot));
        emit IPot.Pulled(users[1], 10 * USD);
        vm.expectEmit(address(pot));
        emit IPot.DebtRecorded(users[1], 20 * USD);
        vm.expectEmit(address(pot));
        emit IPot.MemberExited(users[1], -int256(30 * USD), 0, 10 * USD);
        _exit(pot, 1);
        assertEq(pot.netOf(users[1]), -int256(20 * USD));
        _assertI1(pot);
    }

    function test_exit_payoutCappedAtBalance() public {
        Pot pot = _potWith(2, _balancedRules(), 10 * USD);
        // user 1 paid 25 personally for user 0: nets u0 -15, u1 +35; the pot holds 20
        _propose(pot, 1, SpendKind.PERSONAL, shop, 25 * USD, 0, _addrs(users[0]), _ones(1));
        _exit(pot, 1);
        assertEq(_balance(users[1]), 20 * USD);
        assertEq(pot.netOf(users[1]), int256(15 * USD));
        _assertI1(pot);
    }

    function test_exit_reverts() public {
        Pot pot = _potWith(2, _balancedRules(), 0);
        vm.expectRevert(Pot.NotActiveMember.selector);
        _exit(pot, 5);
        _ackAll(pot);
        pot.settle();
        vm.expectRevert(Pot.PotSettled.selector);
        _exit(pot, 0);
    }

    // ─────────────── payDebt ───────────────

    function test_payDebt_afterSettleDistributes() public {
        Pot pot = _debtPot();
        _ackAll(pot);
        pot.settle(); // nothing collected: u0 +60 unpaid, u1/u2 -30 debts
        _fund(users[1], 30 * USD);
        Auth3009 memory auth = _auth(pks[1], address(pot), 30 * USD);
        vm.expectEmit(address(pot));
        emit IPot.DebtPaid(users[1], 30 * USD);
        vm.expectEmit(address(pot));
        emit IPot.Payout(users[0], 30 * USD);
        pot.payDebt(users[1], auth);
        assertEq(pot.netOf(users[1]), 0);
        assertEq(pot.netOf(users[0]), int256(30 * USD));
        assertEq(_balance(users[0]), 30 * USD);
        assertEq(_balance(address(pot)), 0);
    }

    function test_payDebt_proRataBetweenCreditors() public {
        Rules memory r = _balancedRules();
        r.instantMax = uint64(100 * USD);
        Pot pot = _potWith(3, r, 0);
        _propose(pot, 0, SpendKind.PERSONAL, shop, 20 * USD, 0, _addrs(users[2]), _ones(1));
        _propose(pot, 1, SpendKind.PERSONAL, shop, 10 * USD, 0, _addrs(users[2]), _ones(1));
        _ackAll(pot);
        pot.settle();
        _fund(users[2], 15 * USD);
        pot.payDebt(users[2], _auth(pks[2], address(pot), 15 * USD));
        assertEq(_balance(users[0]), 10 * USD);
        assertEq(_balance(users[1]), 5 * USD);
        _assertI1(pot);
    }

    function test_payDebt_exitedBeforeSettleStaysInPot() public {
        Pot pot = _debtPot();
        _exit(pot, 1);
        _fund(users[1], 10 * USD);
        pot.payDebt(users[1], _auth(pks[1], address(pot), 10 * USD));
        assertEq(pot.netOf(users[1]), -int256(20 * USD));
        assertEq(_balance(address(pot)), 10 * USD);
        _assertI1(pot);
    }

    function test_payDebt_reverts() public {
        Pot pot = _debtPot();
        _fund(users[1], 40 * USD);
        Auth3009 memory auth = _auth(pks[1], address(pot), 10 * USD);
        vm.expectRevert(Pot.DebtNotDue.selector); // active member before settlement
        pot.payDebt(users[1], auth);
        vm.expectRevert(Pot.NotMember.selector);
        pot.payDebt(users[9], auth);
        _ackAll(pot);
        pot.settle();
        auth = _auth(pks[1], address(pot), 31 * USD);
        vm.expectRevert(Pot.InvalidAmount.selector); // more than the debt
        pot.payDebt(users[1], auth);
        auth = _auth(pks[0], address(pot), 1);
        vm.expectRevert(Pot.InvalidAmount.selector); // creditor has no debt
        pot.payDebt(users[0], auth);
        auth = _auth(pks[1], address(pot), 0);
        vm.expectRevert(Pot.InvalidAmount.selector);
        pot.payDebt(users[1], auth);
    }

    // ─────────────── escrow refunds ───────────────

    function test_escrowRefund_beforeSettleReversesShares() public {
        Pot pot = _potWith(3, _balancedRules(), 30 * USD);
        uint256 s = _propose(pot, 0, SpendKind.LINK, vm.addr(0xc1a1), 10 * USD, 0, _users(3), _ones(3));
        assertEq(pot.netOf(users[0]), int256(30 * USD - 3_333_334));
        vm.warp(vm.getBlockTimestamp() + 7 days + 1);
        uint256 epoch = pot.ackEpoch();
        vm.expectEmit(address(pot));
        emit IPot.EscrowRefunded(s, 10 * USD);
        vm.expectEmit(address(pot));
        emit IPot.AcksReset(epoch + 1);
        escrow.refund(1);
        assertEq(pot.netOf(users[0]), int256(30 * USD));
        assertEq(pot.netOf(users[1]), int256(30 * USD));
        (,,, uint256 amount,,,,) = pot.spendInfo(s);
        assertEq(amount, 0);
        _assertI1(pot);
        vm.expectRevert(Pot.NothingToDispute.selector);
        _openDispute(pot, 1, s, 0);
    }

    function test_escrowRefund_afterSettleDistributes() public {
        Pot pot = _potWith(2, _balancedRules(), 30 * USD);
        _proposeEqual(pot, 0, SpendKind.LINK, vm.addr(0xc1a1), 10 * USD, _users(2));
        _ackAll(pot);
        pot.settle(); // pays 25 each
        assertEq(_balance(address(pot)), 0);
        vm.warp(vm.getBlockTimestamp() + 7 days + 1);
        escrow.refund(1);
        assertEq(_balance(users[0]), 30 * USD);
        assertEq(_balance(users[1]), 30 * USD);
        assertEq(_balance(address(pot)), 0);
        assertEq(pot.netOf(users[0]), 0);
        _assertI1(pot);
    }

    function test_escrowRefund_afterDisputeUsesCurrentSplit() public {
        Pot pot = _potWith(3, _balancedRules(), 30 * USD);
        uint256 s = _propose(pot, 0, SpendKind.LINK, vm.addr(0xc1a1), 9 * USD, 0, _users(3), _ones(3));
        uint256 d = _openDispute(pot, 1, s, 2);
        _resolveDispute(pot, 0, d, DisputeOutcome.SpenderCovers, new address[](0), new uint32[](0));
        vm.warp(vm.getBlockTimestamp() + 7 days + 1);
        escrow.refund(1);
        assertEq(pot.netOf(users[0]), int256(30 * USD));
        assertEq(pot.netOf(users[1]), int256(30 * USD));
        _assertI1(pot);
    }

    function test_onEscrowRefund_reverts() public {
        Pot pot = _potWith(2, _balancedRules(), 30 * USD);
        uint256 pay = _proposeEqual(pot, 0, SpendKind.PAY, shop, 1 * USD, _users(2));
        vm.expectRevert(Pot.NotEscrow.selector);
        pot.onEscrowRefund(pay, 1);
        vm.startPrank(address(escrow));
        vm.expectRevert(Pot.InvalidRefund.selector);
        pot.onEscrowRefund(pay, 1); // not a LINK spend
        uint256 link = _proposeEqual(pot, 0, SpendKind.LINK, vm.addr(0xc1a1), 2 * USD, _users(2));
        vm.startPrank(address(escrow));
        vm.expectRevert(Pot.InvalidRefund.selector);
        pot.onEscrowRefund(link, 2 * USD + 1);
        vm.expectRevert(Pot.InvalidRefund.selector);
        pot.onEscrowRefund(link, 0);
        vm.stopPrank();
    }

    function test_onEscrowRefund_partialRefundReverts() public {
        Pot pot = _potWith(3, _balancedRules(), 30 * USD);
        uint256 link = _proposeEqual(pot, 0, SpendKind.LINK, vm.addr(0xc1a1), 10 * USD, _users(3));
        vm.startPrank(address(escrow));
        vm.expectRevert(Pot.InvalidRefund.selector);
        pot.onEscrowRefund(link, 10 * USD - 1);
        vm.expectRevert(Pot.InvalidRefund.selector);
        pot.onEscrowRefund(link, 1);
        pot.onEscrowRefund(link, 10 * USD); // full refund (money already returned by the escrow in reality)
        vm.expectRevert(Pot.InvalidRefund.selector); // a spend is refunded at most once
        pot.onEscrowRefund(link, 10 * USD);
        vm.stopPrank();
    }

    function test_claimedLinkStaysSpent() public {
        Pot pot = _potWith(2, _balancedRules(), 30 * USD);
        _proposeEqual(pot, 0, SpendKind.LINK, vm.addr(0xc1a1), 10 * USD, _users(2));
        bytes memory sig = PlansSigs.claim(0xc1a1, address(escrow), 1, users[7], "JP");
        escrow.claim(1, users[7], "JP", sig);
        assertEq(_balance(users[7]), 10 * USD);
        _assertI1(pot);
    }
}
