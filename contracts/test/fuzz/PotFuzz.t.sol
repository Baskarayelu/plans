// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PlansBase} from "../utils/PlansBase.sol";
import {Pot} from "../../src/Pot.sol";
import {PotHarness} from "./PotHarness.sol";

contract PotFuzzTest is PlansBase {
    address internal shop = address(0x5b0b);
    PotHarness internal harness;

    function setUp() public override {
        super.setUp();
        harness = new PotHarness();
    }

    function _open(uint64 instantMax) internal pure returns (Rules memory r) {
        r.instantMax = instantMax;
        r.oneApprovalMax = type(uint64).max;
        r.proposalTtl = 1 days;
        r.ruleTimelock = 1 hours;
    }

    function _reasonOf(bytes memory revertData) internal pure returns (uint8) {
        assertEq(bytes4(revertData), Pot.SpendBlocked.selector, "expected SpendBlocked");
        return uint8(uint256(bytes32(_slice4(revertData))));
    }

    function _slice4(bytes memory data) internal pure returns (bytes memory out) {
        out = new bytes(data.length - 4);
        for (uint256 i; i < out.length; ++i) {
            out[i] = data[i + 4];
        }
    }

    // ─────────────── share computation ───────────────

    /// @dev Exact: parts sum to amount, part_k = floor(amount * w_k / Σw) for k >= 1,
    /// part_0 takes the remainder, which is below the number of members.
    function testFuzz_parts_exactWithRemainderToFirst(uint96 amount, uint256 seed, uint8 nRaw) public view {
        uint256 n = bound(nRaw, 1, 50);
        uint256[] memory w = new uint256[](n);
        uint256 total;
        for (uint256 k; k < n; ++k) {
            w[k] = bound(uint256(keccak256(abi.encode(seed, k))), 1, type(uint32).max);
            total += w[k];
        }
        uint256[] memory parts = harness.parts(amount, w);
        uint256 sum;
        for (uint256 k; k < n; ++k) {
            sum += parts[k];
            if (k != 0) assertEq(parts[k], uint256(amount) * w[k] / total);
        }
        assertEq(sum, amount);
        uint256 ideal0 = uint256(amount) * w[0] / total;
        assertGe(parts[0], ideal0);
        assertLt(parts[0] - ideal0, n);
    }

    function testFuzz_splitPacking_roundTrips(uint256 seed, uint8 nRaw) public {
        uint256 n = bound(nRaw, 1, 50);
        uint256[] memory idx = new uint256[](n);
        uint256[] memory w = new uint256[](n);
        uint256 expectedMask;
        for (uint256 k; k < n; ++k) {
            idx[k] = (uint256(keccak256(abi.encode(seed, "i", k))) % 50);
            w[k] = bound(uint256(keccak256(abi.encode(seed, "w", k))), 1, type(uint32).max);
            expectedMask |= 1 << idx[k];
        }
        (uint256[] memory idx2, uint256[] memory w2, uint256 mask) = harness.storeAndLoadSplit(idx, w);
        assertEq(idx2, idx);
        assertEq(w2, w);
        assertEq(mask, expectedMask);
    }

    /// @dev End to end through propose: the ledger moves by exactly the computed shares.
    function testFuzz_propose_sharesMatchLedger(uint64 amount, uint32 w0, uint32 w1, uint32 w2) public {
        amount = uint64(bound(amount, 1, 1e15));
        w0 = uint32(bound(w0, 1, type(uint32).max));
        w1 = uint32(bound(w1, 1, type(uint32).max));
        w2 = uint32(bound(w2, 1, type(uint32).max));
        Pot pot = _potWith(3, _open(type(uint64).max), 0);
        _propose(pot, 1, SpendKind.PERSONAL, shop, amount, 0, _users(3), _weights(w0, w1, w2));
        uint256 total = uint256(w0) + w1 + w2;
        uint256 p1 = uint256(amount) * w1 / total;
        uint256 p2 = uint256(amount) * w2 / total;
        assertEq(pot.netOf(users[0]), -int256(uint256(amount) - p1 - p2));
        assertEq(pot.netOf(users[1]), int256(uint256(amount) - p1));
        assertEq(pot.netOf(users[2]), -int256(p2));
        _assertI1(pot);
    }

    // ─────────────── approval tiers ───────────────

    function testFuzz_tiers(uint64 instantMax, uint64 oneApprovalMax, bool all, uint8 activeRaw, uint64 amount) public {
        uint256 active = bound(activeRaw, 1, N_USERS);
        Rules memory r = _open(instantMax);
        r.oneApprovalMax = oneApprovalMax;
        r.highTier = all ? HighTier.ALL : HighTier.MAJORITY;
        Pot pot = _potWith(active, r, 0);

        uint256 expected;
        if (amount <= instantMax) expected = 1;
        else if (amount <= oneApprovalMax) expected = 2;
        else expected = all ? active : active / 2 + 1;
        if (expected > active) expected = active;

        (uint8 required,,) = pot.previewSpend(users[0], SpendKind.PERSONAL, shop, amount, 0);
        assertEq(required, expected);
        if (amount == 0) return;
        uint256 id = _proposeEqual(pot, 0, SpendKind.PERSONAL, shop, amount, _users(1));
        (ProposalStatus status,,,,, uint8 storedRequired,,) = pot.spendInfo(id);
        assertEq(storedRequired, expected);
        assertEq(uint8(status), uint8(expected == 1 ? ProposalStatus.Executed : ProposalStatus.Pending));
        // approvals from other members execute it exactly at the threshold
        for (uint256 v = 1; v < expected; ++v) {
            (status,,,,,,,) = pot.spendInfo(id);
            assertEq(uint8(status), uint8(ProposalStatus.Pending));
            _vote(pot, v, id, true);
        }
        (status,,,,,,,) = pot.spendInfo(id);
        assertEq(uint8(status), uint8(ProposalStatus.Executed));
    }

    // ─────────────── caps and budgets ───────────────

    /// @dev Random spends across random warps; each must succeed exactly when the model says the
    /// daily (UTC day) and total caps allow it, otherwise revert with the right reason.
    function testFuzz_dailyAndTotalCaps(uint64 dailyCap, uint64 totalCap, uint256 seed) public {
        dailyCap = uint64(bound(dailyCap, 1, 1000 * USD));
        totalCap = uint64(bound(totalCap, 1, 5000 * USD));
        Rules memory r = _open(type(uint64).max);
        r.memberDailyCap = dailyCap;
        r.memberTotalCap = totalCap;
        CreatePotParams memory p = _params(r);
        p.endTime = uint64(vm.getBlockTimestamp() + 300 days);
        Pot pot = _createPot(0, p, 0);

        uint256 day = vm.getBlockTimestamp() / 1 days;
        uint256 spentToday;
        uint256 spentTotal;
        for (uint256 k; k < 25; ++k) {
            uint256 rnd = uint256(keccak256(abi.encode(seed, k)));
            vm.warp(vm.getBlockTimestamp() + rnd % 30 hours);
            uint256 amount = bound(rnd >> 64, 1, dailyCap + dailyCap / 2);
            uint256 today = vm.getBlockTimestamp() / 1 days;
            if (today != day) (day, spentToday) = (today, 0);

            uint8 expected;
            if (spentToday + amount > dailyCap) expected = 7;
            else if (spentTotal + amount > totalCap) expected = 8;
            if (expected != 0) {
                vm.expectRevert(abi.encodeWithSelector(Pot.SpendBlocked.selector, expected));
                _proposeEqual(pot, 0, SpendKind.PERSONAL, shop, amount, _users(1));
            } else {
                _proposeEqual(pot, 0, SpendKind.PERSONAL, shop, amount, _users(1));
                spentToday += amount;
                spentTotal += amount;
            }
            (,, uint8 reason) = pot.previewSpend(users[0], SpendKind.PERSONAL, shop, 1, 0);
            uint8 next = spentToday + 1 > dailyCap ? 7 : (spentTotal + 1 > totalCap ? 8 : 0);
            assertEq(reason, next);
        }
    }

    function testFuzz_categoryBudget(uint64 budget, uint64[6] memory amounts, uint8 category) public {
        category = uint8(bound(category, 0, 7));
        budget = uint64(bound(budget, 1, 1000 * USD));
        Rules memory r = _open(type(uint64).max);
        r.categoryBudgets[category] = budget;
        Pot pot = _potWith(1, r, 0);
        uint256 spent;
        for (uint256 k; k < amounts.length; ++k) {
            uint256 amount = bound(amounts[k], 1, budget);
            if (spent + amount > budget) {
                vm.expectRevert(abi.encodeWithSelector(Pot.SpendBlocked.selector, 6));
                _propose(pot, 0, SpendKind.PERSONAL, shop, amount, category, _users(1), _ones(1));
                // another category is unaffected
                _propose(pot, 0, SpendKind.PERSONAL, shop, amount, (category + 1) % 8, _users(1), _ones(1));
            } else {
                _propose(pot, 0, SpendKind.PERSONAL, shop, amount, category, _users(1), _ones(1));
                spent += amount;
            }
            assertEq(pot.categorySpent(category), spent);
        }
    }

    // ─────────────── settlement ───────────────

    /// @dev Builds a pot where `debtor` (user 2) owes; creditors 0 and 1 are owed.
    function _settlementPot(uint256 d0, uint256 d1, uint256 owed) internal returns (Pot pot) {
        pot = _createPot(0, _params(_open(type(uint64).max)), d0);
        _join(pot, 1, d1);
        _join(pot, 2, 0);
        // user 0 pays d0 + d1 from the pot, all on user 2's account; user 1 also covers `owed`
        // personally for user 2
        if (d0 + d1 != 0) _propose(pot, 0, SpendKind.PAY, shop, d0 + d1, 0, _addrs(users[2]), _ones(1));
        if (owed != 0) _propose(pot, 1, SpendKind.PERSONAL, shop, owed, 0, _addrs(users[2]), _ones(1));
    }

    function testFuzz_settle_fullOrPartial(uint64 d0, uint64 d1, uint64 owed, uint64 allowance, uint64 balance) public {
        d0 = uint64(bound(d0, 0, 1e12));
        d1 = uint64(bound(d1, 0, 1e12));
        owed = uint64(bound(owed, 0, 1e12));
        Pot pot = _settlementPot(d0, d1, owed);
        uint256 debt = uint256(d0) + d1 + owed;
        _fund(users[2], balance);
        _approveSafetyNet(pot, 2, allowance);
        _ackAll(pot);
        pot.settle();

        uint256 pulled = _min3(debt, allowance, balance);
        uint256 credit = uint256(d0) + d1 + owed; // nets: u0 = d0, u1 = d1 + owed
        uint256 pay0;
        uint256 pay1;
        if (pulled >= credit) {
            (pay0, pay1) = (d0, uint256(d1) + owed);
        } else if (credit != 0) {
            pay0 = uint256(d0) * pulled / credit;
            pay1 = (uint256(d1) + owed) * pulled / credit;
        }
        assertEq(_balance(users[0]), pay0);
        assertEq(_balance(users[1]), pay1);
        assertEq(pot.netOf(users[2]), -int256(debt - pulled));
        assertEq(_balance(address(pot)), pulled - pay0 - pay1);
        assertLe(_balance(address(pot)), 2); // floor dust only
        _assertI1(pot);
        if (pulled == debt) {
            assertEq(_balance(address(pot)), 0);
            assertEq(pot.netOf(users[0]), 0);
            assertEq(pot.netOf(users[1]), 0);
        }
    }

    function testFuzz_payDebt_distribution(uint64 d0, uint64 owed, uint64 payment) public {
        d0 = uint64(bound(d0, 1, 1e12));
        owed = uint64(bound(owed, 1, 1e12));
        Pot pot = _settlementPot(d0, 0, owed);
        _ackAll(pot);
        pot.settle(); // no allowance: everything stays owed
        uint256 debt = uint256(d0) + owed;
        payment = uint64(bound(payment, 1, debt));
        _fund(users[2], payment);
        pot.payDebt(users[2], _auth(pks[2], address(pot), payment));
        uint256 pay0 = uint256(payment) * d0 / debt;
        uint256 pay1 = uint256(payment) * owed / debt;
        assertEq(_balance(users[0]), pay0);
        assertEq(_balance(users[1]), pay1);
        assertEq(pot.netOf(users[2]), -int256(debt - payment));
        assertEq(pot.netOf(users[0]), int256(uint256(d0) - pay0));
        _assertI1(pot);
    }

    function testFuzz_exit(uint64 deposit, uint64 spend, uint64 allowance, uint64 balance, bool creditor) public {
        deposit = uint64(bound(deposit, 1, 1e12));
        spend = uint64(bound(spend, 1, deposit));
        Pot pot = _potWith(2, _open(type(uint64).max), 0);
        _contribute(pot, 0, deposit);
        // user 0 pays `spend` for user 1: u0 = deposit, u1 = -spend; pot holds deposit - spend
        _propose(pot, 0, SpendKind.PAY, shop, spend, 0, _addrs(users[1]), _ones(1));
        uint256 potBalance = uint256(deposit) - spend;
        if (creditor) {
            _exit(pot, 0);
            uint256 paid = deposit < potBalance ? deposit : potBalance;
            assertEq(_balance(users[0]), paid);
            assertEq(pot.netOf(users[0]), int256(uint256(deposit) - paid));
        } else {
            _fund(users[1], balance);
            _approveSafetyNet(pot, 1, allowance);
            _exit(pot, 1);
            uint256 pulled = _min3(spend, allowance, balance);
            assertEq(pot.netOf(users[1]), -int256(uint256(spend) - pulled));
            assertEq(_balance(address(pot)), potBalance + pulled);
        }
        assertFalse(pot.isMember(users[creditor ? 0 : 1]));
        _assertI1(pot);
    }

    // ─────────────── escrow refunds ───────────────

    function testFuzz_escrowRefund_reversesShares(uint64 amount, uint32 w0, uint32 w1, uint32 w2, bool settleFirst)
        public
    {
        amount = uint64(bound(amount, 1, 300 * USD));
        w0 = uint32(bound(w0, 1, 1e6));
        w1 = uint32(bound(w1, 1, 1e6));
        w2 = uint32(bound(w2, 1, 1e6));
        Pot pot = _potWith(3, _open(type(uint64).max), 100 * USD);
        int256[3] memory before = [pot.netOf(users[0]), pot.netOf(users[1]), pot.netOf(users[2])];
        _propose(pot, 0, SpendKind.LINK, vm.addr(0xc1a1), amount, 0, _users(3), _weights(w0, w1, w2));
        _assertI1(pot);
        if (settleFirst) {
            _ackAll(pot);
            pot.settle();
        }
        vm.warp(vm.getBlockTimestamp() + 7 days + 1);
        escrow.refund(1);
        _assertI1(pot);
        if (settleFirst) {
            // The refund was paid out at once: everyone got their deposit back, up to flooring.
            // Settlement (if the pot was short) and the refund each floor n = 3 pro-rata
            // payouts, so at most 2 * (n - 1) base units stay in the pot as claims.
            for (uint256 i; i < 3; ++i) {
                assertApproxEqAbs(_balance(users[i]), 100 * USD, 4);
            }
            assertLe(_balance(address(pot)), 4);
        } else {
            for (uint256 i; i < 3; ++i) {
                assertEq(pot.netOf(users[i]), before[i]);
            }
        }
    }

    function _min3(uint256 a, uint256 b, uint256 c) internal pure returns (uint256 m) {
        m = a < b ? a : b;
        if (c < m) m = c;
    }
}
