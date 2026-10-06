// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PlansBase} from "../utils/PlansBase.sol";
import {IPot} from "../../src/interfaces/IPot.sol";
import {Pot} from "../../src/Pot.sol";

/// @notice Disputes, freezes and rule changes.
contract PotGovernanceTest is PlansBase {
    Pot internal pot;
    address internal shop = address(0x5b0b);
    uint256 internal spendId;

    function setUp() public override {
        super.setUp();
        pot = _potWith(5, _balancedRules(), 100 * USD);
        // user 0 pays 12 for users 0,1,2 (4 each)
        spendId = _propose(pot, 0, SpendKind.PAY, shop, 12 * USD, 3, _users(3), _ones(3));
    }

    function _shares(uint256 a, uint256 b) internal pure returns (uint256[] memory s) {
        s = new uint256[](2);
        (s[0], s[1]) = (a, b);
    }

    // ─────────────── open ───────────────

    function test_openDispute() public {
        uint256 epoch = pot.ackEpoch();
        vm.expectEmit(address(pot));
        emit IPot.DisputeOpened(1, spendId, users[1], 1, "why");
        vm.expectEmit(address(pot));
        emit IPot.AcksReset(epoch + 1);
        uint256 id = _openDispute(pot, 1, spendId, 1);
        assertEq(id, 1);
        (uint256 sId, DisputeOutcome outcome, uint64 openedAt,,) = pot.disputeInfo(id);
        assertEq(sId, spendId);
        assertEq(uint8(outcome), uint8(DisputeOutcome.None));
        assertEq(openedAt, vm.getBlockTimestamp());
        (,,,,,,, bool open) = pot.spendInfo(spendId);
        assertTrue(open);
        assertFalse(pot.canSettle());
        // opener and subject cannot exit
        vm.expectRevert(Pot.HasOpenItems.selector);
        _exit(pot, 1);
        vm.expectRevert(Pot.HasOpenItems.selector);
        _exit(pot, 0);
    }

    function test_openDispute_reverts() public {
        vm.expectRevert(Pot.NotInSplit.selector);
        _openDispute(pot, 3, spendId, 0);
        vm.expectRevert(Pot.InvalidDisputeReason.selector);
        _openDispute(pot, 1, spendId, 3);
        vm.expectRevert(Pot.NothingToDispute.selector);
        _openDispute(pot, 1, 99, 0);
        vm.expectRevert(Pot.NotActiveMember.selector);
        _openDispute(pot, 9, spendId, 0);
        _openDispute(pot, 1, spendId, 0);
        vm.expectRevert(Pot.DisputeAlreadyOpen.selector);
        _openDispute(pot, 2, spendId, 0);

        uint256 pending = _proposeEqual(pot, 0, SpendKind.PAY, shop, 100 * USD, _users(3));
        vm.expectRevert(Pot.NothingToDispute.selector);
        _openDispute(pot, 1, pending, 0);
    }

    function test_openDispute_afterSettleReverts() public {
        Pot p = _potWith(2, _balancedRules(), 10 * USD);
        uint256 s = _proposeEqual(p, 0, SpendKind.PAY, shop, 2 * USD, _users(2));
        _ackAll(p);
        p.settle();
        vm.expectRevert(Pot.PotSettled.selector);
        _openDispute(p, 1, s, 0);
    }

    // ─────────────── resolve by proposer ───────────────

    function test_resolve_spenderCovers() public {
        uint256 id = _openDispute(pot, 1, spendId, 2);
        uint256[] memory shares = new uint256[](1);
        shares[0] = 12 * USD;
        vm.expectEmit(address(pot));
        emit IPot.DisputeResolved(id, DisputeOutcome.SpenderCovers, _addrs(users[0]), shares);
        _resolveDispute(pot, 0, id, DisputeOutcome.SpenderCovers, new address[](0), new uint32[](0));
        assertEq(pot.netOf(users[0]), int256(88 * USD));
        assertEq(pot.netOf(users[1]), int256(100 * USD));
        assertEq(pot.netOf(users[2]), int256(100 * USD));
        _assertI1(pot);
        (, DisputeOutcome outcome,,,) = pot.disputeInfo(id);
        assertEq(uint8(outcome), uint8(DisputeOutcome.SpenderCovers));
        _exit(pot, 1); // open items cleared
    }

    function test_resolve_resplit() public {
        uint256 id = _openDispute(pot, 1, spendId, 1);
        vm.expectEmit(address(pot));
        emit IPot.DisputeResolved(id, DisputeOutcome.Resplit, _addrs(users[0], users[3]), _shares(4 * USD, 8 * USD));
        _resolveDispute(pot, 0, id, DisputeOutcome.Resplit, _addrs(users[0], users[3]), _weights(1, 2));
        assertEq(pot.netOf(users[0]), int256(96 * USD));
        assertEq(pot.netOf(users[1]), int256(100 * USD));
        assertEq(pot.netOf(users[2]), int256(100 * USD));
        assertEq(pot.netOf(users[3]), int256(92 * USD));
        _assertI1(pot);
        // the new split is what a later dispute works from
        uint256 id2 = _openDispute(pot, 3, spendId, 1);
        _resolveDispute(pot, 0, id2, DisputeOutcome.SpenderCovers, new address[](0), new uint32[](0));
        assertEq(pot.netOf(users[3]), int256(100 * USD));
        assertEq(pot.netOf(users[0]), int256(88 * USD));
    }

    function test_resolve_reverts() public {
        uint256 id = _openDispute(pot, 1, spendId, 1);
        vm.expectRevert(Pot.NotProposer.selector);
        _resolveDispute(pot, 1, id, DisputeOutcome.SpenderCovers, new address[](0), new uint32[](0));
        vm.expectRevert(Pot.InvalidOutcome.selector);
        _resolveDispute(pot, 0, id, DisputeOutcome.Keep, new address[](0), new uint32[](0));
        vm.expectRevert(Pot.InvalidSplit.selector);
        _resolveDispute(pot, 0, id, DisputeOutcome.Resplit, _addrs(users[0], users[9]), _ones(2));
        vm.expectRevert(Pot.InvalidStatus.selector);
        _resolveDispute(pot, 0, 42, DisputeOutcome.SpenderCovers, new address[](0), new uint32[](0));
        _resolveDispute(pot, 0, id, DisputeOutcome.SpenderCovers, new address[](0), new uint32[](0));
        vm.expectRevert(Pot.InvalidStatus.selector);
        _resolveDispute(pot, 0, id, DisputeOutcome.SpenderCovers, new address[](0), new uint32[](0));
    }

    // ─────────────── votes and finalize ───────────────

    function test_vote_majorityForSpenderCovers() public {
        uint256 id = _openDispute(pot, 1, spendId, 2);
        vm.expectEmit(address(pot));
        emit IPot.DisputeVoted(id, users[2], true);
        _voteDispute(pot, 2, id, true);
        _voteDispute(pot, 3, id, true);
        _voteDispute(pot, 4, id, false);
        (,,, uint8 votesFor, uint8 votesAgainst) = pot.disputeInfo(id);
        assertEq(votesFor, 2);
        assertEq(votesAgainst, 1);
        // every eligible voter (2, 3, 4) has voted: finalize early
        pot.finalizeDispute(id);
        (, DisputeOutcome outcome,,,) = pot.disputeInfo(id);
        assertEq(uint8(outcome), uint8(DisputeOutcome.SpenderCovers));
        assertEq(pot.netOf(users[0]), int256(88 * USD));
    }

    function test_vote_tieKeeps() public {
        uint256 id = _openDispute(pot, 1, spendId, 2);
        _voteDispute(pot, 2, id, true);
        _voteDispute(pot, 3, id, false);
        vm.expectRevert(Pot.TooEarly.selector);
        pot.finalizeDispute(id);
        vm.warp(vm.getBlockTimestamp() + 48 hours);
        vm.expectEmit(address(pot));
        emit IPot.DisputeResolved(id, DisputeOutcome.Keep, _users(3), _threeFours());
        pot.finalizeDispute(id);
        assertEq(pot.netOf(users[0]), int256(96 * USD));
    }

    function _threeFours() internal pure returns (uint256[] memory s) {
        s = new uint256[](3);
        (s[0], s[1], s[2]) = (4 * USD, 4 * USD, 4 * USD);
    }

    function test_vote_reverts() public {
        uint256 id = _openDispute(pot, 1, spendId, 2);
        vm.expectRevert(Pot.NotEligibleVoter.selector);
        _voteDispute(pot, 1, id, true);
        vm.expectRevert(Pot.NotEligibleVoter.selector);
        _voteDispute(pot, 0, id, true);
        _voteDispute(pot, 2, id, true);
        vm.expectRevert(Pot.AlreadyVoted.selector);
        _voteDispute(pot, 2, id, false);
        vm.expectRevert(Pot.NotActiveMember.selector);
        _voteDispute(pot, 9, id, false);
        vm.warp(vm.getBlockTimestamp() + 48 hours);
        vm.expectRevert(Pot.VotingClosed.selector);
        _voteDispute(pot, 3, id, true);
    }

    function test_finalize_noEligibleVotersKeepsAfterPeriod() public {
        Pot p = _potWith(2, _balancedRules(), 10 * USD);
        uint256 s = _proposeEqual(p, 0, SpendKind.PAY, shop, 2 * USD, _users(2));
        uint256 id = _openDispute(p, 1, s, 0);
        vm.expectRevert(Pot.TooEarly.selector);
        p.finalizeDispute(id);
        vm.warp(vm.getBlockTimestamp() + 48 hours);
        p.finalizeDispute(id);
        (, DisputeOutcome outcome,,,) = p.disputeInfo(id);
        assertEq(uint8(outcome), uint8(DisputeOutcome.Keep));
        vm.expectRevert(Pot.InvalidStatus.selector);
        p.finalizeDispute(id);
    }

    function test_dispute_onPersonalSpend() public {
        uint256 s = _propose(pot, 2, SpendKind.PERSONAL, shop, 10 * USD, 0, _addrs(users[2], users[4]), _ones(2));
        assertEq(pot.netOf(users[2]), int256(101 * USD)); // 100 - 4 + 10 - 5
        uint256 id = _openDispute(pot, 4, s, 2);
        _resolveDispute(pot, 2, id, DisputeOutcome.SpenderCovers, new address[](0), new uint32[](0));
        assertEq(pot.netOf(users[2]), int256(96 * USD));
        assertEq(pot.netOf(users[4]), int256(100 * USD));
        _assertI1(pot);
    }

    // ─────────────── freeze ───────────────

    function test_freeze() public {
        vm.expectEmit(address(pot));
        emit IPot.Frozen(users[1], uint64(vm.getBlockTimestamp() + 24 hours));
        _freeze(pot, 1);
        assertEq(pot.frozenUntil(), vm.getBlockTimestamp() + 24 hours);
        vm.expectRevert(Pot.FreezeCooldown.selector);
        _freeze(pot, 1);
        vm.warp(vm.getBlockTimestamp() + 10 hours);
        _freeze(pot, 2); // extends
        assertEq(pot.frozenUntil(), vm.getBlockTimestamp() + 24 hours);
        vm.warp(vm.getBlockTimestamp() + 14 hours);
        _freeze(pot, 1); // cooldown over
    }

    function test_freeze_secondFreezeNeverShortens() public {
        _freeze(pot, 1);
        uint256 until = pot.frozenUntil();
        _freeze(pot, 2);
        assertEq(pot.frozenUntil(), until);
    }

    function test_unfreeze_majority() public {
        _freeze(pot, 1);
        _voteUnfreeze(pot, 0);
        _voteUnfreeze(pot, 1);
        vm.expectRevert(Pot.AlreadyVoted.selector);
        _voteUnfreeze(pot, 1);
        vm.expectEmit(address(pot));
        emit IPot.Unfrozen(users[2]);
        _voteUnfreeze(pot, 2); // 3 of 5
        assertEq(pot.frozenUntil(), vm.getBlockTimestamp());
        vm.expectRevert(Pot.NotFrozen.selector);
        _voteUnfreeze(pot, 3);
        _proposeEqual(pot, 0, SpendKind.PAY, shop, 1 * USD, _users(3));
    }

    function test_unfreeze_votesResetOnNewFreeze() public {
        _freeze(pot, 1);
        _voteUnfreeze(pot, 0);
        _voteUnfreeze(pot, 1);
        vm.warp(vm.getBlockTimestamp() + 24 hours); // lapses
        _freeze(pot, 2);
        _voteUnfreeze(pot, 0); // allowed again: a new freeze
        _voteUnfreeze(pot, 1);
        assertGt(pot.frozenUntil(), vm.getBlockTimestamp());
    }

    function test_freeze_reverts() public {
        vm.expectRevert(Pot.NotActiveMember.selector);
        _freeze(pot, 9);
        vm.expectRevert(Pot.NotFrozen.selector);
        _voteUnfreeze(pot, 0);
        _ackAll(pot);
        pot.settle();
        vm.expectRevert(Pot.PotSettled.selector);
        _freeze(pot, 1);
    }

    // ─────────────── rule changes ───────────────

    function test_rules_proposeVoteApply() public {
        Rules memory r = _balancedRules();
        r.instantMax = uint64(50 * USD);
        r.minContribution = uint64(100 * USD);
        address[] memory add = _addrs(shop);
        address[] memory none = new address[](0);

        vm.expectEmit(address(pot));
        emit IPot.RuleChangeProposed(1, users[0], r, add, none, uint64(vm.getBlockTimestamp() + 24 hours));
        uint256 id = _proposeRules(pot, 0, r, add, none);
        (ProposalStatus status, uint8 approvals, uint8 required,,) = pot.ruleChangeInfo(id);
        assertEq(uint8(status), uint8(ProposalStatus.Pending));
        assertEq(approvals, 1);
        assertEq(required, 3);

        vm.expectEmit(address(pot));
        emit IPot.RuleChangeVoted(id, users[1], false);
        _voteRules(pot, 1, id, false);
        _voteRules(pot, 2, id, true);
        vm.expectEmit(address(pot));
        emit IPot.RuleChangeApproved(id, uint64(vm.getBlockTimestamp() + 1 hours));
        _voteRules(pot, 3, id, true);

        vm.expectRevert(Pot.TooEarly.selector);
        pot.applyRules(id);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        uint256 epoch = pot.ackEpoch();
        vm.expectEmit(address(pot));
        emit IPot.AllowlistChanged(shop, true);
        vm.expectEmit(address(pot));
        emit IPot.RulesSet(1, r);
        vm.expectEmit(address(pot));
        emit IPot.RuleChangeApplied(id, 1);
        vm.expectEmit(address(pot));
        emit IPot.AcksReset(epoch + 1);
        pot.applyRules(id);
        assertEq(pot.getRules().instantMax, 50 * USD);
        assertEq(pot.rulesVersion(), 1);
        // minContribution 100 is met by everyone (each deposited 100)
        _proposeEqual(pot, 0, SpendKind.PAY, shop, 1 * USD, _users(2));

        vm.expectRevert(Pot.InvalidStatus.selector);
        pot.applyRules(id);
    }

    function test_rules_minContributionRecomputed() public {
        Rules memory r = _balancedRules();
        r.minContribution = uint64(100 * USD + 1);
        uint256 id = _proposeRules(pot, 0, r, new address[](0), new address[](0));
        _voteRules(pot, 1, id, true);
        _voteRules(pot, 2, id, true);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        pot.applyRules(id);
        vm.expectRevert(abi.encodeWithSelector(Pot.SpendBlocked.selector, 4));
        _proposeEqual(pot, 0, SpendKind.PAY, shop, 1 * USD, _users(2));
    }

    function test_rules_allowlistRemoveThenAdd() public {
        address other = address(0x07e4);
        uint256 id = _proposeRules(pot, 0, _balancedRules(), _addrs(shop, other), new address[](0));
        _voteRules(pot, 1, id, true);
        _voteRules(pot, 2, id, true);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        pot.applyRules(id);
        id = _proposeRules(pot, 0, _balancedRules(), _addrs(shop), _addrs(shop, other));
        _voteRules(pot, 1, id, true);
        _voteRules(pot, 2, id, true);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        pot.applyRules(id);
        assertTrue(pot.isAllowedPayee(shop));
        assertFalse(pot.isAllowedPayee(other));
    }

    function test_rules_soloApprovesImmediately() public {
        Pot p = _potWith(1, _balancedRules(), 0);
        uint256 id = _proposeRules(p, 0, _balancedRules(), new address[](0), new address[](0));
        (ProposalStatus status,,,, uint64 eta) = p.ruleChangeInfo(id);
        assertEq(uint8(status), uint8(ProposalStatus.Approved));
        assertEq(eta, vm.getBlockTimestamp() + 1 hours);
    }

    function test_rules_reverts() public {
        Rules memory bad = _balancedRules();
        bad.proposalTtl = 0;
        vm.expectRevert(Pot.InvalidRules.selector);
        _proposeRules(pot, 0, bad, new address[](0), new address[](0));
        vm.expectRevert(Pot.TooManyEntries.selector);
        _proposeRules(pot, 0, _balancedRules(), new address[](51), new address[](0));
        vm.expectRevert(Pot.NotActiveMember.selector);
        _proposeRules(pot, 9, _balancedRules(), new address[](0), new address[](0));

        uint256 id = _proposeRules(pot, 0, _balancedRules(), new address[](0), new address[](0));
        vm.expectRevert(Pot.AlreadyVoted.selector);
        _voteRules(pot, 0, id, true);
        vm.expectRevert(Pot.InvalidStatus.selector);
        _voteRules(pot, 1, 77, true);
        vm.expectRevert(Pot.InvalidStatus.selector);
        pot.applyRules(id);
        vm.warp(vm.getBlockTimestamp() + 24 hours + 1);
        vm.expectRevert(Pot.ProposalExpired.selector);
        _voteRules(pot, 1, id, true);
    }

    function test_rules_settledReverts() public {
        uint256 id = _proposeRules(pot, 0, _balancedRules(), new address[](0), new address[](0));
        _voteRules(pot, 1, id, true);
        _voteRules(pot, 2, id, true);
        _ackAll(pot);
        pot.settle();
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        vm.expectRevert(Pot.PotSettled.selector);
        pot.applyRules(id);
        vm.expectRevert(Pot.PotSettled.selector);
        _proposeRules(pot, 0, _balancedRules(), new address[](0), new address[](0));
    }
}
