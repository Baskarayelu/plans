// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ClaimEscrow} from "../../src/ClaimEscrow.sol";
import {Pot} from "../../src/Pot.sol";
import {PlansBase} from "../utils/PlansBase.sol";
import {PlansSigs} from "../utils/PlansSigs.sol";
import {MockAUSD} from "../mocks/MockAUSD.sol";
import {PotHandler} from "./PotHandler.sol";

/// @notice Deterministic versions of the trickier sequences the invariant handler explores.
contract PotRegressionsTest is PlansBase {
    address internal claimKey;
    uint256 internal claimPk;

    function setUp() public override {
        super.setUp();
        (claimKey, claimPk) = makeAddrAndKey("claimKey");
    }

    function _allNetsZero(Pot pot) internal view {
        address[] memory all = pot.members();
        for (uint256 i; i < all.length; ++i) {
            assertEq(pot.netOf(all[i]), 0, "net");
        }
    }

    /// A LINK claim still open when the plan settles early (acks). Its later refund reverses the
    /// shares and pays them straight out; after a clean settle that is exact, with no dust.
    function test_linkRefundAfterCleanSettle_isExact() public {
        Pot pot = _potWith(3, _balancedRules(), 100 * USD);
        _propose(pot, 0, SpendKind.LINK, claimKey, 10 * USD + 1, 7, _users(3), _weights(1, 2, 4));
        uint256 claimId = escrow.claimCount();
        _ackAll(pot);
        pot.settle();
        assertEq(_balance(address(pot)), 0);
        _allNetsZero(pot);

        (,,, uint64 expiry,,) = escrow.claimInfo(claimId);
        vm.warp(uint256(expiry) + 1);
        escrow.refund(claimId);

        _assertI1(pot);
        assertEq(_balance(address(pot)), 0, "no dust");
        _allNetsZero(pot);
        for (uint256 i; i < 3; ++i) {
            assertEq(_balance(users[i]), 100 * USD, "everyone whole");
        }
    }

    /// A debtor whose safety net covers the debt is pulled in full; the pot ends at exactly 0.
    function test_cleanSettle_withDebtorSafetyNet_drainsPot() public {
        Pot pot = _potWith(3, _balancedRules(), 10 * USD);
        // user 2 paid 24 out of pocket for users 0 and 1: each now owes 2 (10 - 12).
        _propose(pot, 2, SpendKind.PERSONAL, address(0), 24 * USD, 3, _addrs(users[0], users[1]), _weights(1, 1));
        assertEq(pot.netOf(users[0]), -2 * int256(USD));
        _fund(users[0], 2 * USD);
        _approveSafetyNet(pot, 0, 2 * USD);
        _fund(users[1], 2 * USD);
        _approveSafetyNet(pot, 1, 2 * USD);
        _ackAll(pot);
        pot.settle();
        assertEq(_balance(address(pot)), 0);
        _allNetsZero(pot);
        assertEq(_balance(users[2]), 34 * USD, "creditor repaid");
    }

    /// Replaying a signed vote reverts on the consumed nonce, and the nonce reads as used.
    function test_replayedVote_reverts() public {
        Pot pot = _potWith(4, _balancedRules(), 100 * USD);
        uint256 id = _proposeEqual(pot, 0, SpendKind.PAY, users[9], 50 * USD, _users(4));
        uint256 nonce = 777;
        bytes memory sig = PlansSigs.vote(pks[1], address(pot), users[1], id, true, nonce, _deadline());
        pot.vote(users[1], id, true, nonce, _deadline(), sig);
        assertTrue(pot.usedNonce(users[1], nonce));
        vm.expectRevert(Pot.NonceAlreadyUsed.selector);
        pot.vote(users[1], id, true, nonce, _deadline(), sig);
    }

    function test_claimThenRefund_reverts() public {
        Pot pot = _potWith(3, _balancedRules(), 100 * USD);
        _proposeEqual(pot, 0, SpendKind.LINK, claimKey, 20 * USD, _users(3));
        uint256 claimId = escrow.claimCount();
        escrow.claim(claimId, users[9], "US", PlansSigs.claim(claimPk, address(escrow), claimId, users[9], "US"));
        assertEq(_balance(users[9]), 20 * USD);
        (,,, uint64 expiry,,) = escrow.claimInfo(claimId);
        vm.warp(uint256(expiry) + 1);
        vm.expectRevert(ClaimEscrow.NotOpen.selector);
        escrow.refund(claimId);
        _assertI1(pot);
    }

    function test_refundThenClaim_reverts() public {
        Pot pot = _potWith(3, _balancedRules(), 100 * USD);
        _proposeEqual(pot, 0, SpendKind.LINK, claimKey, 20 * USD, _users(3));
        uint256 claimId = escrow.claimCount();
        (,,, uint64 expiry,,) = escrow.claimInfo(claimId);
        bytes memory sig = PlansSigs.claim(claimPk, address(escrow), claimId, users[9], "US");
        vm.warp(uint256(expiry) + 1);
        escrow.refund(claimId);
        vm.expectRevert(ClaimEscrow.NotOpen.selector);
        escrow.claim(claimId, users[9], "US", sig);
        _assertI1(pot);
        assertEq(_balance(address(pot)), 300 * USD, "shares reversed before settlement");
        assertEq(_balance(address(escrow)), 0);
    }

    /// A split member exiting while a spend waits blocks it: the threshold is met but the spend
    /// becomes Approved, and execute() reverts with reason 10 (invalid split).
    function test_pendingSpend_splitMemberExits_isBlocked() public {
        Pot pot = _potWith(4, _balancedRules(), 100 * USD);
        uint256 id = _proposeEqual(pot, 0, SpendKind.PAY, users[9], 50 * USD, _users(4));
        _exit(pot, 3);
        _vote(pot, 1, id, true);
        (ProposalStatus st,,,,,,,) = pot.spendInfo(id);
        assertEq(uint8(st), uint8(ProposalStatus.Approved));
        vm.expectRevert(abi.encodeWithSelector(Pot.SpendBlocked.selector, uint8(10)));
        pot.execute(id);
        _assertI1(pot);
    }

    /// The proposer exits after an instant spend; the dispute then moves the whole cost onto the
    /// exited member, who pays the debt before settlement. Exited members cannot rejoin.
    function test_disputeSpenderCovers_onExitedProposer() public {
        Pot pot = _potWith(3, _balancedRules(), 100 * USD);
        uint256 spendId =
            _propose(pot, 2, SpendKind.PAY, users[9], 20 * USD, 1, _addrs(users[0], users[1]), _weights(1, 1));
        _exit(pot, 2);
        assertEq(_balance(users[2]), 100 * USD);

        uint256 did = _openDispute(pot, 0, spendId, 2);
        _voteDispute(pot, 1, did, true); // the only eligible voter
        pot.finalizeDispute(did);
        (, DisputeOutcome outcome,,,) = pot.disputeInfo(did);
        assertEq(uint8(outcome), uint8(DisputeOutcome.SpenderCovers));
        assertEq(pot.netOf(users[2]), -20 * int256(USD));
        _assertI1(pot);

        _fund(users[2], 20 * USD);
        pot.payDebt(users[2], _auth(pks[2], address(pot), 20 * USD));
        _assertI1(pot);

        uint256 nonce = _nonce();
        vm.expectRevert(Pot.AlreadyMember.selector);
        pot.join(
            users[2],
            "FR",
            nonce,
            _deadline(),
            PlansSigs.join(pks[2], address(pot), users[2], "FR", 0, nonce, _deadline()),
            PlansSigs.invite(invitePk, address(pot), users[2]),
            _noDeposit(),
            _noPermit(),
            _noKey()
        );

        _ackAll(pot);
        pot.settle();
        assertEq(_balance(address(pot)), 0);
        _allNetsZero(pot);
    }

    /// approvalsRequired is fixed when the spend is proposed, even if members join afterwards.
    function test_approvalsRequired_fixedAtProposal() public {
        Rules memory r = _balancedRules();
        r.memberDailyCap = 0;
        Pot pot = _potWith(3, r, 200 * USD);
        uint256 id = _proposeEqual(pot, 0, SpendKind.PERSONAL, address(0), 300 * USD, _users(3));
        (,,,,, uint8 required,,) = pot.spendInfo(id);
        assertEq(required, 2, "MAJORITY of 3");
        for (uint256 u = 3; u < 8; ++u) {
            _join(pot, u, 0);
        }
        assertEq(pot.activeMemberCount(), 8);
        _vote(pot, 1, id, true);
        (ProposalStatus st,,,, uint8 approvals,,,) = pot.spendInfo(id);
        assertEq(uint8(st), uint8(ProposalStatus.Executed));
        assertEq(approvals, 2);
        _assertI1(pot);
    }

    /// The refund after a clean settle that reaches a frozen creditor: the payout is skipped (the
    /// money stays as that member's claim, no dust), and `collect` pays it once AUSD unfreezes.
    function test_linkRefundAfterCleanSettle_frozenCreditorCollects() public {
        Pot pot = _potWith(3, _balancedRules(), 100 * USD);
        _propose(pot, 0, SpendKind.LINK, claimKey, 24 * USD, 7, _users(3), _ones(3));
        uint256 claimId = escrow.claimCount();
        _ackAll(pot);
        pot.settle();
        _allNetsZero(pot);
        MockAUSD(token).setFrozen(users[1], true);
        (,,, uint64 expiry,,) = escrow.claimInfo(claimId);
        vm.warp(uint256(expiry) + 1);
        escrow.refund(claimId);
        assertEq(pot.netOf(users[1]), int256(8 * USD), "frozen creditor's refund share kept");
        assertEq(_balance(address(pot)), 8 * USD);
        _assertI1(pot);
        MockAUSD(token).setFrozen(users[1], false);
        pot.collect(users[1]);
        assertEq(_balance(address(pot)), 0);
        _allNetsZero(pot);
        assertEq(_balance(users[1]), 100 * USD);
    }

    /// The invariant handler's collect action is really exercised: driving it through settlements
    /// with frozen creditors produces successful collects and no violations.
    function test_handler_collectIsExercised() public {
        PotHandler h = new PotHandler();
        uint256 collects;
        for (uint256 run; run < 40 && collects == 0; ++run) {
            uint256 seed = uint256(keccak256(abi.encode("collect-coverage", run)));
            for (uint256 k; k < 60; ++k) {
                uint256 x = uint256(keccak256(abi.encode(seed, k)));
                uint256 pick = x % 10;
                // Like the invariant runner, a reverting action (e.g. minting to a frozen account) is skipped.
                if (pick < 2) try h.proposeSmall(x, x >> 1) {} catch {}
                else if (pick < 3) try h.contribute(x) {} catch {}
                else if (pick < 5) try h.freezeAusd(x) {} catch {}
                else if (pick < 7) try h.settlePot(x) {} catch {}
                else if (pick < 8) try h.refundLink(x) {} catch {}
                else if (pick < 9) try h.payDebt(x) {} catch {}
                else try h.collectPayout(x) {} catch {}
            }
            collects = h.ghostCollects();
        }
        assertGt(collects, 0, "no collect succeeded");
        assertEq(h.ghostCollectViolations(), 0, h.lastCollectViolation());
    }
}
