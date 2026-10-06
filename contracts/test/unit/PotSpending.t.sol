// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PlansBase} from "../utils/PlansBase.sol";
import {IPot} from "../../src/interfaces/IPot.sol";
import {IClaimEscrow} from "../../src/interfaces/IPlansPeriphery.sol";
import {ClaimEscrow} from "../../src/ClaimEscrow.sol";
import {Pot} from "../../src/Pot.sol";

contract PotSpendingTest is PlansBase {
    Pot internal pot;
    address internal shop = address(0x5b0b);

    function setUp() public override {
        super.setUp();
        pot = _potWith(4, _balancedRules(), 100 * USD);
    }

    function _all() internal view returns (address[] memory) {
        return _users(4);
    }

    function _expectBlocked(uint8 reason) internal {
        vm.expectRevert(abi.encodeWithSelector(Pot.SpendBlocked.selector, reason));
    }

    // ─────────────── instant execution ───────────────

    function test_instantPay_executesWithExactShares() public {
        uint256[] memory shares = new uint256[](3);
        (shares[0], shares[1], shares[2]) = (3_333_334, 3_333_333, 3_333_333);
        address[] memory split = _users(3);

        vm.expectEmit(address(pot));
        emit IPot.SpendProposed(
            1,
            users[0],
            SpendKind.PAY,
            shop,
            10 * USD,
            7,
            split,
            _ones(3),
            keccak256("receipt"),
            "memo",
            1,
            uint64(vm.getBlockTimestamp() + 24 hours)
        );
        vm.expectEmit(address(pot));
        emit IPot.SpendExecuted(1, 10 * USD, split, shares, 0);
        vm.expectEmit(address(pot));
        emit IPot.AcksReset(pot.ackEpoch() + 1);
        uint256 id = _proposeEqual(pot, 0, SpendKind.PAY, shop, 10 * USD, split);

        assertEq(id, 1);
        assertEq(_balance(shop), 10 * USD);
        assertEq(pot.netOf(users[0]), int256(100 * USD - 3_333_334));
        assertEq(pot.netOf(users[1]), int256(100 * USD - 3_333_333));
        assertEq(pot.netOf(users[3]), int256(100 * USD));
        (ProposalStatus status,,, uint256 amount,,,,) = pot.spendInfo(id);
        assertEq(uint8(status), uint8(ProposalStatus.Executed));
        assertEq(amount, 10 * USD);
        assertEq(pot.categorySpent(7), 10 * USD);
        _assertI1(pot);
    }

    function test_instantPersonal_creditsProposer() public {
        Pot p = _potWith(3, _balancedRules(), 0);
        _propose(p, 1, SpendKind.PERSONAL, shop, 9 * USD, 3, _users(3), _weights(1, 1, 1));
        assertEq(p.netOf(users[0]), -int256(3 * USD));
        assertEq(p.netOf(users[1]), int256(6 * USD));
        assertEq(p.netOf(users[2]), -int256(3 * USD));
        _assertI1(p);
    }

    function test_instantLink_createsClaim() public {
        address claimKey = vm.addr(0xc1a1);
        uint64 expiry = uint64(vm.getBlockTimestamp() + 7 days);
        vm.expectEmit(address(escrow));
        emit IClaimEscrow.ClaimCreated(1, address(pot), claimKey, 20 * USD, expiry, 1, bytes2(0));
        uint256 id = _proposeEqual(pot, 0, SpendKind.LINK, claimKey, 20 * USD, _all());
        (address source, address signer, uint256 amount, uint64 exp, uint256 spendId, ClaimEscrow.Status st) =
            escrow.claimInfo(1);
        assertEq(source, address(pot));
        assertEq(signer, claimKey);
        assertEq(amount, 20 * USD);
        assertEq(exp, expiry);
        assertEq(spendId, id);
        assertEq(uint8(st), uint8(ClaimEscrow.Status.Open));
        assertEq(_balance(address(escrow)), 20 * USD);
        _assertI1(pot);
    }

    function test_link_expiryCappedAtReviewEnd() public {
        vm.warp(pot.endTime() - 1 days);
        _proposeEqual(pot, 0, SpendKind.LINK, vm.addr(0xc1a1), 1 * USD, _all());
        (,,, uint64 exp,,) = escrow.claimInfo(1);
        assertEq(exp, pot.endTime() + pot.reviewWindow());
    }

    function test_weightedSplit_remainderToFirst() public {
        _propose(pot, 0, SpendKind.PAY, shop, 10, 0, _addrs(users[2], users[1], users[0]), _weights(1, 1, 1));
        assertEq(pot.netOf(users[2]), int256(100 * USD - 4));
        assertEq(pot.netOf(users[1]), int256(100 * USD - 3));
        assertEq(pot.netOf(users[0]), int256(100 * USD - 3));
    }

    // ─────────────── reason codes ───────────────

    function test_reason1_notActiveMember() public {
        _expectBlocked(1);
        _proposeEqual(pot, 5, SpendKind.PAY, shop, 1 * USD, _all());
        _exit(pot, 3);
        _expectBlocked(1);
        _proposeEqual(pot, 3, SpendKind.PAY, shop, 1 * USD, _users(3));
    }

    function test_reason2_notOpen() public {
        CreatePotParams memory p = _params(_balancedRules());
        p.startTime = uint64(vm.getBlockTimestamp() + 1 days);
        p.endTime = uint64(vm.getBlockTimestamp() + 2 days);
        Pot later = _createPot(5, p, 10 * USD);
        _expectBlocked(2);
        _proposeEqual(later, 5, SpendKind.PERSONAL, shop, 1 * USD, _addrs(users[5]));
        vm.warp(vm.getBlockTimestamp() + 1 days);
        _proposeEqual(later, 5, SpendKind.PERSONAL, shop, 1 * USD, _addrs(users[5]));
        vm.warp(later.endTime() + 1);
        _expectBlocked(2);
        _proposeEqual(later, 5, SpendKind.PERSONAL, shop, 1 * USD, _addrs(users[5]));
    }

    function test_reason2_settled() public {
        _ackAll(pot);
        pot.settle();
        _expectBlocked(2);
        _proposeEqual(pot, 0, SpendKind.PERSONAL, shop, 1 * USD, _all());
    }

    function test_reason3_frozen() public {
        _freeze(pot, 2);
        _expectBlocked(3);
        _proposeEqual(pot, 0, SpendKind.PAY, shop, 1 * USD, _all());
        vm.warp(vm.getBlockTimestamp() + 24 hours);
        _proposeEqual(pot, 0, SpendKind.PAY, shop, 1 * USD, _all());
    }

    function test_reason4_minContribution() public {
        Rules memory r = _balancedRules();
        r.minContribution = uint64(50 * USD);
        Pot p = _createPot(0, _params(r), 50 * USD);
        _join(p, 1, 20 * USD);
        _expectBlocked(4);
        _proposeEqual(p, 0, SpendKind.PAY, shop, 1 * USD, _users(2));
        _contribute(p, 1, 30 * USD);
        _proposeEqual(p, 0, SpendKind.PAY, shop, 1 * USD, _users(2));
    }

    function test_reason5_payeePolicy() public {
        Rules memory r = _balancedRules();
        r.payeePolicy = PayeePolicy.MEMBERS_ONLY;
        Pot p = _potWith(2, r, 50 * USD);
        _expectBlocked(5);
        _proposeEqual(p, 0, SpendKind.PAY, shop, 1 * USD, _users(2));
        _proposeEqual(p, 0, SpendKind.PAY, users[1], 1 * USD, _users(2));
        // LINK and PERSONAL are always allowed
        _proposeEqual(p, 0, SpendKind.LINK, shop, 1 * USD, _users(2));
        _proposeEqual(p, 0, SpendKind.PERSONAL, shop, 1 * USD, _users(2));
        // an exited member is no longer a member payee
        _exit(p, 1);
        _expectBlocked(5);
        _proposeEqual(p, 0, SpendKind.PAY, users[1], 1 * USD, _users(1));
    }

    function test_reason5_allowlist() public {
        Rules memory r = _balancedRules();
        r.payeePolicy = PayeePolicy.MEMBERS_AND_ALLOWLIST;
        Pot p = _potWith(1, r, 50 * USD);
        _expectBlocked(5);
        _proposeEqual(p, 0, SpendKind.PAY, shop, 1 * USD, _users(1));
        uint256 rc = _proposeRules(p, 0, r, _addrs(shop), new address[](0));
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        p.applyRules(rc);
        assertTrue(p.isAllowedPayee(shop));
        _proposeEqual(p, 0, SpendKind.PAY, shop, 1 * USD, _users(1));
    }

    function test_reason6_categoryBudget() public {
        Rules memory r = _balancedRules();
        r.categoryBudgets[3] = uint64(30 * USD);
        Pot p = _potWith(2, r, 100 * USD);
        _propose(p, 0, SpendKind.PAY, shop, 20 * USD, 3, _users(2), _ones(2));
        _expectBlocked(6);
        _propose(p, 0, SpendKind.PAY, shop, 11 * USD, 3, _users(2), _ones(2));
        _propose(p, 0, SpendKind.PAY, shop, 10 * USD, 3, _users(2), _ones(2));
        _propose(p, 0, SpendKind.PAY, shop, 20 * USD, 4, _users(2), _ones(2)); // other category: no budget
        assertEq(p.categorySpent(3), 30 * USD);
    }

    function test_reason7_dailyCapResetsNextUtcDay() public {
        vm.warp(10 days + 23 hours);
        Pot p = _potWith(2, _balancedRules(), 500 * USD); // daily cap 150
        for (uint256 k; k < 6; ++k) {
            _proposeEqual(p, 0, SpendKind.PAY, shop, 25 * USD, _users(2));
        }
        _expectBlocked(7);
        _proposeEqual(p, 0, SpendKind.PAY, shop, 1, _users(2));
        // another member has their own cap
        _proposeEqual(p, 1, SpendKind.PAY, shop, 25 * USD, _users(2));
        vm.warp(11 days);
        _proposeEqual(p, 0, SpendKind.PAY, shop, 25 * USD, _users(2));
    }

    function test_reason8_totalCap() public {
        Rules memory r = _balancedRules();
        r.memberDailyCap = 0;
        r.memberTotalCap = uint64(40 * USD);
        Pot p = _potWith(2, r, 100 * USD);
        _proposeEqual(p, 0, SpendKind.PERSONAL, shop, 25 * USD, _users(2));
        _expectBlocked(8);
        _proposeEqual(p, 0, SpendKind.PAY, shop, 16 * USD, _users(2));
        _proposeEqual(p, 0, SpendKind.LINK, shop, 15 * USD, _users(2));
        _expectBlocked(8);
        _proposeEqual(p, 0, SpendKind.PAY, shop, 1, _users(2));
    }

    function test_reason9_funds() public {
        Rules memory r = _balancedRules();
        r.memberDailyCap = 0;
        Pot p = _potWith(4, r, 100 * USD);
        _expectBlocked(9);
        _proposeEqual(p, 0, SpendKind.PAY, shop, 400 * USD + 1, _all());
        _expectBlocked(9);
        _proposeEqual(p, 0, SpendKind.LINK, shop, 400 * USD + 1, _all());
        _proposeEqual(p, 0, SpendKind.PERSONAL, shop, 400 * USD + 1, _all());
    }

    function test_reason10_invalidSplits() public {
        address[] memory none = new address[](0);
        _expectBlocked(10);
        _propose(pot, 0, SpendKind.PAY, shop, 1, 0, none, new uint32[](0));
        _expectBlocked(10);
        _propose(pot, 0, SpendKind.PAY, shop, 1, 0, _users(2), _ones(3));
        _expectBlocked(10);
        _propose(pot, 0, SpendKind.PAY, shop, 1, 0, _addrs(users[0], users[9]), _ones(2));
        _expectBlocked(10);
        _propose(pot, 0, SpendKind.PAY, shop, 1, 0, _addrs(users[0], users[1], users[0]), _ones(3));
        _expectBlocked(10);
        _propose(pot, 0, SpendKind.PAY, shop, 1, 0, _users(2), _weights(1, 0));
        _expectBlocked(10);
        _propose(pot, 0, SpendKind.PAY, shop, 1, 0, new address[](51), _ones(51));
        _exit(pot, 3);
        _expectBlocked(10);
        _propose(pot, 0, SpendKind.PAY, shop, 1, 0, _all(), _ones(4));
    }

    function test_reason11_amountOrCategory() public {
        _expectBlocked(11);
        _proposeEqual(pot, 0, SpendKind.PAY, shop, 0, _all());
        _expectBlocked(11);
        _propose(pot, 0, SpendKind.PAY, shop, 1, 8, _all(), _ones(4));
        Rules memory r = _balancedRules();
        r.memberDailyCap = 0;
        Pot p = _potWith(1, r, 0);
        _expectBlocked(11);
        _proposeEqual(p, 0, SpendKind.PERSONAL, shop, uint256(type(uint96).max) + 1, _users(1));
        // money-moving spends need a payee
        _expectBlocked(11);
        _proposeEqual(pot, 0, SpendKind.PAY, address(0), 1, _all());
        _expectBlocked(11);
        _proposeEqual(pot, 0, SpendKind.LINK, address(0), 1, _all());
        _proposeEqual(pot, 0, SpendKind.PERSONAL, address(0), 1, _all());
    }

    function test_reasonOrder_firstFailingCheckWins() public {
        Rules memory r = _balancedRules();
        r.memberDailyCap = 0;
        Pot p = _potWith(2, r, 10 * USD);
        _freeze(p, 1);
        _expectBlocked(3); // frozen beats funds, split and amount
        _propose(p, 0, SpendKind.PAY, shop, 1e30, 9, new address[](0), new uint32[](0));
        vm.warp(vm.getBlockTimestamp() + 1 days);
        _expectBlocked(9); // funds beats split
        _propose(p, 0, SpendKind.PAY, shop, 1e30, 9, new address[](0), new uint32[](0));
        _expectBlocked(10); // split beats amount/category
        _propose(p, 0, SpendKind.PAY, shop, 0, 9, new address[](0), new uint32[](0));
    }

    function test_memoTooLong() public {
        vm.expectRevert(Pot.DataTooLong.selector);
        pot.propose(users[0], SpendKind.PAY, shop, 1, 0, Split(_all(), _ones(4)), 0, new bytes(513), 1, _deadline(), "");
    }

    // ─────────────── previewSpend ───────────────

    function test_previewSpend() public view {
        (uint8 required, bool ok, uint8 reason) = pot.previewSpend(users[0], SpendKind.PAY, shop, 25 * USD, 0);
        assertEq(required, 1);
        assertTrue(ok);
        assertEq(reason, 0);
        (required, ok, reason) = pot.previewSpend(users[0], SpendKind.PAY, shop, 26 * USD, 0);
        assertEq(required, 2);
        (required, ok, reason) = pot.previewSpend(users[0], SpendKind.PAY, shop, 201 * USD, 0);
        assertEq(required, 3); // floor(4/2)+1
        assertFalse(ok);
        assertEq(reason, 7); // over the 150 daily cap
        (, ok, reason) = pot.previewSpend(users[9], SpendKind.PAY, shop, 1, 0);
        assertEq(reason, 1);
        (, ok, reason) = pot.previewSpend(users[0], SpendKind.PAY, shop, 0, 0);
        assertEq(reason, 11);
        (, ok, reason) = pot.previewSpend(users[0], SpendKind.PAY, shop, 1, 8);
        assertEq(reason, 11);
    }

    // ─────────────── tiers ───────────────

    function test_tiers_majorityAllAndCap() public {
        Rules memory r = _balancedRules();
        r.memberDailyCap = 0;
        (uint8 required,,) = pot.previewSpend(users[0], SpendKind.PERSONAL, shop, 1000 * USD, 0);
        assertEq(required, 3);
        r.highTier = HighTier.ALL;
        Pot p = _potWith(5, r, 0);
        (required,,) = p.previewSpend(users[0], SpendKind.PERSONAL, shop, 1000 * USD, 0);
        assertEq(required, 5);
        Pot solo = _potWith(1, r, 0);
        (required,,) = solo.previewSpend(users[0], SpendKind.PERSONAL, shop, 1000 * USD, 0);
        assertEq(required, 1); // capped at active
        (required,,) = solo.previewSpend(users[0], SpendKind.PERSONAL, shop, 100 * USD, 0);
        assertEq(required, 1); // one-approval tier capped too
        _proposeEqual(solo, 0, SpendKind.PERSONAL, shop, 1000 * USD, _users(1));
    }

    // ─────────────── voting ───────────────

    function test_pending_thenVoteExecutes() public {
        uint256 id = _proposeEqual(pot, 0, SpendKind.PAY, shop, 50 * USD, _all());
        (ProposalStatus status,,,, uint8 approvals, uint8 required, uint64 expiresAt,) = pot.spendInfo(id);
        assertEq(uint8(status), uint8(ProposalStatus.Pending));
        assertEq(approvals, 1);
        assertEq(required, 2);
        assertEq(expiresAt, vm.getBlockTimestamp() + 24 hours);
        assertEq(_balance(shop), 0);

        vm.expectEmit(address(pot));
        emit IPot.Voted(id, users[1], true);
        _vote(pot, 1, id, true);
        (status,,,,,,,) = pot.spendInfo(id);
        assertEq(uint8(status), uint8(ProposalStatus.Executed));
        assertEq(_balance(shop), 50 * USD);
        _assertI1(pot);
    }

    function test_vote_rejectCancelsWhenUnreachable() public {
        Rules memory r = _balancedRules();
        r.highTier = HighTier.ALL;
        r.memberDailyCap = 0;
        Pot p = _potWith(4, r, 100 * USD);
        uint256 id = _proposeEqual(p, 0, SpendKind.PAY, shop, 300 * USD, _users(4));
        _vote(p, 1, id, true);
        vm.expectEmit(address(p));
        emit IPot.SpendCancelled(id, 1);
        _vote(p, 2, id, false);
        (ProposalStatus status,,,,,,,) = p.spendInfo(id);
        assertEq(uint8(status), uint8(ProposalStatus.Cancelled));
    }

    function test_vote_rejectKeepsPendingWhileReachable() public {
        uint256 id = _proposeEqual(pot, 0, SpendKind.PAY, shop, 50 * USD, _all()); // needs 2 of 4
        _vote(pot, 1, id, false);
        _vote(pot, 2, id, false);
        (ProposalStatus status,,,,,,,) = pot.spendInfo(id);
        assertEq(uint8(status), uint8(ProposalStatus.Pending));
        _vote(pot, 3, id, true);
        (status,,,,,,,) = pot.spendInfo(id);
        assertEq(uint8(status), uint8(ProposalStatus.Executed));
    }

    function test_vote_reverts() public {
        uint256 id = _proposeEqual(pot, 0, SpendKind.PAY, shop, 50 * USD, _all());
        vm.expectRevert(Pot.AlreadyVoted.selector);
        _vote(pot, 0, id, true); // proposer's vote is implied
        _vote(pot, 1, id, false);
        vm.expectRevert(Pot.AlreadyVoted.selector);
        _vote(pot, 1, id, true);
        vm.expectRevert(Pot.NotActiveMember.selector);
        _vote(pot, 7, id, true);
        vm.expectRevert(Pot.InvalidStatus.selector);
        _vote(pot, 1, 99, true);
        vm.warp(vm.getBlockTimestamp() + 24 hours + 1);
        vm.expectRevert(Pot.ProposalExpired.selector);
        _vote(pot, 2, id, true);
    }

    function test_vote_thresholdWhileFrozenApprovesThenExecute() public {
        uint256 id = _proposeEqual(pot, 0, SpendKind.PAY, shop, 50 * USD, _all());
        _freeze(pot, 3);
        vm.expectEmit(address(pot));
        emit IPot.SpendApproved(id);
        _vote(pot, 1, id, true);
        (ProposalStatus status,,,,,,,) = pot.spendInfo(id);
        assertEq(uint8(status), uint8(ProposalStatus.Approved));

        _expectBlocked(3);
        pot.execute(id);
        _voteUnfreeze(pot, 0);
        _voteUnfreeze(pot, 1);
        _voteUnfreeze(pot, 2);
        pot.execute(id);
        (status,,,,,,,) = pot.spendInfo(id);
        assertEq(uint8(status), uint8(ProposalStatus.Executed));
        assertEq(_balance(shop), 50 * USD);
    }

    function test_execution_rechecksBudgetAndCaps() public {
        Rules memory r = _balancedRules();
        r.categoryBudgets[0] = uint64(80 * USD);
        Pot p = _potWith(3, r, 100 * USD);
        uint256 a = _propose(p, 0, SpendKind.PAY, shop, 50 * USD, 0, _users(3), _ones(3));
        uint256 b = _propose(p, 1, SpendKind.PAY, shop, 50 * USD, 0, _users(3), _ones(3));
        _vote(p, 2, a, true);
        _vote(p, 2, b, true); // budget now exhausted -> Approved, not executed
        (ProposalStatus status,,,,,,,) = p.spendInfo(b);
        assertEq(uint8(status), uint8(ProposalStatus.Approved));
        _expectBlocked(6);
        p.execute(b);
    }

    function test_execution_splitMemberExited() public {
        uint256 id = _proposeEqual(pot, 0, SpendKind.PAY, shop, 50 * USD, _all());
        _exit(pot, 3);
        _vote(pot, 1, id, true);
        (ProposalStatus status,,,,,,,) = pot.spendInfo(id);
        assertEq(uint8(status), uint8(ProposalStatus.Approved));
        _expectBlocked(10);
        pot.execute(id);
    }

    function test_execute_reverts() public {
        uint256 id = _proposeEqual(pot, 0, SpendKind.PAY, shop, 50 * USD, _all());
        vm.expectRevert(Pot.InvalidStatus.selector);
        pot.execute(id);
        _freeze(pot, 3);
        _vote(pot, 1, id, true);
        vm.warp(vm.getBlockTimestamp() + 24 hours + 1);
        vm.expectRevert(Pot.ProposalExpired.selector);
        pot.execute(id);
    }

    function test_rulesChangeDoesNotAlterOpenProposals() public {
        uint256 id = _proposeEqual(pot, 0, SpendKind.PAY, shop, 50 * USD, _all()); // needs 2
        Rules memory r = _balancedRules();
        r.oneApprovalMax = 0;
        r.highTier = HighTier.ALL;
        uint256 rc = _proposeRules(pot, 1, r, new address[](0), new address[](0));
        _voteRules(pot, 2, rc, true);
        _voteRules(pot, 3, rc, true);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        pot.applyRules(rc);
        (,,,,, uint8 required,,) = pot.spendInfo(id);
        assertEq(required, 2);
        _vote(pot, 1, id, true);
        (ProposalStatus status,,,,,,,) = pot.spendInfo(id);
        assertEq(uint8(status), uint8(ProposalStatus.Executed));
    }

    // ─────────────── cancel / expire ───────────────

    function test_cancelSpend() public {
        uint256 id = _proposeEqual(pot, 0, SpendKind.PAY, shop, 50 * USD, _all());
        vm.expectRevert(Pot.NotProposer.selector);
        _cancel(pot, 1, id);
        vm.expectEmit(address(pot));
        emit IPot.SpendCancelled(id, 0);
        _cancel(pot, 0, id);
        vm.expectRevert(Pot.InvalidStatus.selector);
        _cancel(pot, 0, id);
        _exit(pot, 0); // no open items left
    }

    function test_cancelSpend_approved() public {
        uint256 id = _proposeEqual(pot, 0, SpendKind.PAY, shop, 50 * USD, _all());
        _freeze(pot, 3);
        _vote(pot, 1, id, true);
        _cancel(pot, 0, id);
        (ProposalStatus status,,,,,,,) = pot.spendInfo(id);
        assertEq(uint8(status), uint8(ProposalStatus.Cancelled));
    }

    function test_expire() public {
        uint256 id = _proposeEqual(pot, 0, SpendKind.PAY, shop, 50 * USD, _all());
        vm.expectRevert(Pot.ProposalNotExpired.selector);
        pot.expire(id);
        vm.warp(vm.getBlockTimestamp() + 24 hours + 1);
        vm.expectEmit(address(pot));
        emit IPot.SpendCancelled(id, 2);
        pot.expire(id);
        vm.expectRevert(Pot.InvalidStatus.selector);
        pot.expire(id);
    }

    function test_openProposalBlocksExitAndSettle() public {
        uint256 id = _proposeEqual(pot, 0, SpendKind.PAY, shop, 50 * USD, _all());
        vm.expectRevert(Pot.HasOpenItems.selector);
        _exit(pot, 0);
        _ackAll(pot);
        assertFalse(pot.canSettle());
        vm.warp(vm.getBlockTimestamp() + 24 hours + 1);
        pot.expire(id);
        assertTrue(pot.canSettle());
        _exit(pot, 0);
    }
}
