// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PlansBase} from "../utils/PlansBase.sol";
import {MockAUSD} from "../mocks/MockAUSD.sol";
import {IPot} from "../../src/interfaces/IPot.sol";
import {Pot} from "../../src/Pot.sol";

/// @notice `Pot.collect`: the retry path for a payout that settlement (or a later distribution)
/// skipped, Stage A finding F1. Covers a frozen-then-unfrozen creditor, a recipient the token always
/// refuses, a token that returns false, pro-rata when the pot is short, who gets paid, and the
/// gas-starvation guard.
contract PotCollectTest is PlansBase {
    address internal shop = address(0x5b0b);

    function _token() internal view returns (MockAUSD) {
        return MockAUSD(token);
    }

    /// @dev Three members deposit 30/20/10; nobody spends. Settled with user 1 frozen, so users 0
    /// and 2 are paid and user 1's 20 stays as a claim in the pot.
    function _settledWithFrozenCreditor() internal returns (Pot pot) {
        pot = _createPot(0, _params(_balancedRules()), 30 * USD);
        _join(pot, 1, 20 * USD);
        _join(pot, 2, 10 * USD);
        _token().setFrozen(users[1], true);
        _ackAll(pot);
        pot.settle();
        assertEq(_balance(users[0]), 30 * USD, "u0 paid");
        assertEq(_balance(users[2]), 10 * USD, "u2 paid");
        assertEq(pot.netOf(users[1]), int256(20 * USD), "u1 claim kept");
        assertEq(_balance(address(pot)), 20 * USD);
        _assertI1(pot);
    }

    // ─────────────── F1: frozen, then unfrozen ───────────────

    function test_collect_frozenThenUnfrozenRecipient() public {
        Pot pot = _settledWithFrozenCreditor();

        // Still frozen: the transfer is refused, the claim stays, nothing moves.
        vm.expectRevert(Pot.PayoutRefused.selector);
        pot.collect(users[1]);
        assertEq(pot.netOf(users[1]), int256(20 * USD));
        assertEq(_balance(address(pot)), 20 * USD);

        // Unfrozen: anyone may collect for the member; only the member is paid.
        _token().setFrozen(users[1], false);
        address stranger = makeAddr("stranger");
        vm.expectEmit(address(pot));
        emit IPot.Payout(users[1], 20 * USD);
        vm.expectEmit(address(pot));
        emit IPot.Collected(users[1], stranger, 20 * USD);
        vm.prank(stranger);
        pot.collect(users[1]);

        assertEq(_balance(users[1]), 20 * USD, "member paid");
        assertEq(_balance(stranger), 0, "caller gets nothing");
        assertEq(_balance(users[0]), 30 * USD, "others unchanged");
        assertEq(_balance(users[2]), 10 * USD, "others unchanged");
        assertEq(pot.netOf(users[1]), 0);
        assertEq(_balance(address(pot)), 0, "pot drained");
        _assertI1(pot);

        // Nothing left to collect.
        vm.expectRevert(Pot.NothingToCollect.selector);
        pot.collect(users[1]);
    }

    // ─────────────── a recipient the token always refuses ───────────────

    /// @dev One member whose transfers always revert cannot block another member's collect, and
    /// its own claim is kept (never lost, never paid to anyone else).
    function test_collect_alwaysRevertingRecipient_doesNotBlockOthers() public {
        Pot pot = _createPot(0, _params(_balancedRules()), 30 * USD);
        _join(pot, 1, 20 * USD);
        _join(pot, 2, 10 * USD);
        _token().setAlwaysReverts(users[1], true);
        _token().setFrozen(users[2], true);
        _ackAll(pot);
        pot.settle(); // u0 paid; u1 and u2 skipped
        assertEq(pot.netOf(users[1]), int256(20 * USD));
        assertEq(pot.netOf(users[2]), int256(10 * USD));

        for (uint256 k; k < 3; ++k) {
            vm.expectRevert(Pot.PayoutRefused.selector);
            pot.collect(users[1]);
        }
        _token().setFrozen(users[2], false);
        pot.collect(users[2]);
        assertEq(_balance(users[2]), 10 * USD);
        assertEq(pot.netOf(users[1]), int256(20 * USD), "refused claim kept");
        assertEq(_balance(address(pot)), 20 * USD);
        _assertI1(pot);
    }

    function test_collect_tokenReturningFalse_reverts() public {
        Pot pot = _createPot(0, _params(_balancedRules()), 30 * USD);
        _join(pot, 1, 20 * USD);
        _token().setReturnsFalse(users[1], true);
        _ackAll(pot);
        pot.settle();
        assertEq(pot.netOf(users[1]), int256(20 * USD), "false return skipped at settle");
        vm.expectRevert(Pot.PayoutRefused.selector);
        pot.collect(users[1]);
        _token().setReturnsFalse(users[1], false);
        pot.collect(users[1]);
        assertEq(_balance(users[1]), 20 * USD);
        _assertI1(pot);
    }

    // ─────────────── reverts ───────────────

    function test_collect_revertsBeforeSettlement() public {
        Pot pot = _potWith(2, _balancedRules(), 10 * USD);
        vm.expectRevert(Pot.NotSettled.selector);
        pot.collect(users[0]);
    }

    function test_collect_revertsForNonMemberAndNothingOwed() public {
        Rules memory r = _balancedRules();
        r.instantMax = uint64(100 * USD);
        Pot pot = _potWith(2, r, 0);
        _propose(pot, 1, SpendKind.PERSONAL, shop, 20 * USD, 0, _addrs(users[0]), _ones(1));
        _ackAll(pot);
        pot.settle(); // u0 owes 20 (debt recorded), u1 owed 20, pot empty
        vm.expectRevert(Pot.NotMember.selector);
        pot.collect(users[5]);
        vm.expectRevert(Pot.NothingToCollect.selector);
        pot.collect(users[0]); // a debtor
        vm.expectRevert(Pot.NothingToCollect.selector);
        pot.collect(users[1]); // owed, but the pot holds nothing
        assertEq(pot.netOf(users[1]), int256(20 * USD));
    }

    // ─────────────── pro rata ───────────────

    /// @dev Short pot: creditors A (+60) and B (+40, frozen at settlement); a debtor owes 50 and
    /// pays nothing. Balance 50 < credit 100: settle pays A 30, skips B. Then B collects pro rata
    /// of what is left: 40 * 20 / (30 + 40) = 11 (floored, in USD units below).
    function test_collect_proRataWhenPotShort() public {
        Rules memory r = _balancedRules();
        r.instantMax = uint64(200 * USD);
        r.memberDailyCap = 0;
        Pot pot = _createPot(0, _params(r), 60 * USD);
        _join(pot, 1, 40 * USD);
        _join(pot, 2, 0);
        // u2 takes on 50 of a PAY 50 to the shop: nets u0 +60, u1 +40, u2 -50, balance 50.
        _propose(pot, 0, SpendKind.PAY, shop, 50 * USD, 0, _addrs(users[2]), _ones(1));
        assertEq(_balance(address(pot)), 50 * USD);
        _token().setFrozen(users[1], true);
        _ackAll(pot);
        pot.settle();
        assertEq(_balance(users[0]), 30 * USD, "u0 pro rata 60*50/100");
        assertEq(pot.netOf(users[0]), int256(30 * USD));
        assertEq(pot.netOf(users[1]), int256(40 * USD));
        assertEq(_balance(address(pot)), 20 * USD);

        _token().setFrozen(users[1], false);
        uint256 expected = uint256(40 * USD) * (20 * USD) / (70 * USD);
        vm.expectEmit(address(pot));
        emit IPot.Collected(users[1], address(this), expected);
        pot.collect(users[1]);
        assertEq(_balance(users[1]), expected);
        assertLe(expected, 40 * USD, "never more than net");
        assertEq(pot.netOf(users[0]), int256(30 * USD), "other creditor's claim untouched");
        _assertI1(pot);

        // A later debt payment is distributed pro rata to both remaining claims.
        _fund(users[2], 50 * USD);
        pot.payDebt(users[2], _auth(pks[2], address(pot), 50 * USD));
        _assertI1(pot);
    }

    /// @dev Unsolicited AUSD on top: the pot holds more than the positive nets; collect pays the
    /// net exactly, never the surplus.
    function test_collect_neverMoreThanNet() public {
        Pot pot = _settledWithFrozenCreditor();
        _fund(address(pot), 1_000 * USD); // a stray transfer
        _token().setFrozen(users[1], false);
        pot.collect(users[1]);
        assertEq(_balance(users[1]), 20 * USD);
        assertEq(pot.netOf(users[1]), 0);
        assertEq(_balance(address(pot)), 1_000 * USD, "surplus stays");
    }

    /// @dev An exited member whose exit payout was capped by the balance can collect after settlement.
    function test_collect_exitedMember() public {
        Rules memory r = _balancedRules();
        r.instantMax = uint64(100 * USD);
        Pot pot = _createPot(0, _params(r), 10 * USD);
        _join(pot, 1, 0);
        // u1 paid 40 personally, split to u0: u0 10-40=-30, u1 +40, balance 10.
        _propose(pot, 1, SpendKind.PERSONAL, shop, 40 * USD, 0, _addrs(users[0]), _ones(1));
        _exit(pot, 1); // paid min(40, 10) = 10, still owed 30
        assertEq(pot.netOf(users[1]), int256(30 * USD));
        _ackAll(pot);
        pot.settle();
        // u0 pays its debt later; it is distributed to u1 (the only creditor).
        _fund(users[0], 30 * USD);
        _token().setFrozen(users[1], true);
        pot.payDebt(users[0], _auth(pks[0], address(pot), 30 * USD)); // u1 frozen: skipped
        assertEq(pot.netOf(users[1]), int256(30 * USD));
        _token().setFrozen(users[1], false);
        pot.collect(users[1]);
        assertEq(_balance(users[1]), 40 * USD);
        assertEq(pot.netOf(users[1]), 0);
        _assertI1(pot);
    }

    // ─────────────── gas starvation ───────────────

    /// @dev Every gas limit either reverts or pays the member; none succeeds with the payout skipped.
    function test_collect_gasLimitCannotSkipPayout() public {
        Pot pot = _settledWithFrozenCreditor();
        _token().setFrozen(users[1], false);
        bytes memory data = abi.encodeCall(pot.collect, (users[1]));
        uint256 paid;
        uint256 starved;
        uint256 skipped;
        for (uint256 g = 20_000; g <= 150_000; g += 250) {
            uint256 snap = vm.snapshotState();
            (bool ok, bytes memory ret) = address(pot).call{gas: g}(data);
            if (ok) {
                if (_balance(users[1]) == 20 * USD) ++paid;
                else ++skipped;
            } else if (keccak256(ret) == keccak256(abi.encodeWithSelector(Pot.InsufficientGas.selector))) {
                ++starved;
            }
            vm.revertToState(snap);
        }
        assertEq(skipped, 0, "collect succeeded without paying");
        assertGt(paid, 0, "collect never succeeded in the scanned range");
        assertGt(starved, 0, "the starved window reverts InsufficientGas");
    }

    /// @dev A real refusal is reported as PayoutRefused, not InsufficientGas, with ordinary gas.
    function test_collect_refusalIsNotMistakenForStarvation() public {
        Pot pot = _settledWithFrozenCreditor();
        vm.expectRevert(Pot.PayoutRefused.selector);
        pot.collect{gas: 200_000}(users[1]);
    }
}
