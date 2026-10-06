// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PlansBase} from "../utils/PlansBase.sol";
import {MockAUSD} from "../mocks/MockAUSD.sol";
import {Pot} from "../../src/Pot.sol";

/// @notice Regression tests for the EIP-150 (63/64 gas) griefing found while triaging the static
/// analysis results (contracts/STATIC-ANALYSIS.md). Payouts and pulls run inside try/catch so that
/// one refusing account cannot block the others. Without a gas check, whoever submits the
/// transaction could pick a gas limit that makes the AUSD call run out of gas, be swallowed by the
/// catch, and still leave enough gas (1/64) to finish. After settlement there is no way to pay out
/// a skipped claim again, so the creditor's money would sit in the pot.
contract PotGasGriefingTest is PlansBase {
    address internal shop = address(0x5b0b);

    /// @dev Two members, nobody deposits. User 1 pays 20 out of pocket for user 0
    /// (PERSONAL), so user 0 owes 20 and user 1 (the last member index) is owed 20. Settled with
    /// nothing collected. User 1 holds no AUSD, so the payout writes a fresh balance slot.
    function _settledWithDebt() internal returns (Pot pot) {
        Rules memory r = _balancedRules();
        r.instantMax = uint64(100 * USD);
        pot = _potWith(2, r, 0);
        _propose(pot, 1, SpendKind.PERSONAL, shop, 20 * USD, 0, _addrs(users[0]), _ones(1));
        _ackAll(pot);
        pot.settle();
        assertEq(pot.netOf(users[0]), -int256(20 * USD));
        assertEq(pot.netOf(users[1]), int256(20 * USD));
        assertEq(_balance(users[1]), 0);
    }

    /// @dev Submits payDebt with every gas limit in a range. Each attempt must either revert as a
    /// whole or pay the creditor; it must never succeed with the creditor's payout skipped.
    function test_payDebt_gasLimitCannotSkipCreditorPayout() public {
        Pot pot = _settledWithDebt();
        _fund(users[0], 20 * USD);
        Auth3009 memory auth = _auth(pks[0], address(pot), 20 * USD);
        bytes memory data = abi.encodeCall(pot.payDebt, (users[0], auth));

        uint256 skipped;
        uint256 paid;
        uint256 starved;
        for (uint256 g = 20_000; g <= 200_000; g += 250) {
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
        assertEq(skipped, 0, "a gas limit made payDebt skip the creditor's payout");
        assertGt(paid, 0, "payDebt never succeeded in the scanned range");
        assertGt(starved, 0, "the griefing window should now revert with InsufficientGas");
    }

    /// @dev The same check for an escrow refund that arrives after settlement (anyone may call
    /// ClaimEscrow.refund once the claim has expired).
    function test_escrowRefund_gasLimitCannotSkipCreditorPayout() public {
        Rules memory r = _balancedRules();
        Pot pot = _createPot(0, _params(r), 0);
        _join(pot, 1, 30 * USD);
        // User 1 sends 10 by link, charged to user 0: u0 -10, u1 +30, pot balance 20.
        _propose(pot, 1, SpendKind.LINK, vm.addr(0xc1a1), 10 * USD, 0, _addrs(users[0]), _ones(1));
        _ackAll(pot);
        pot.settle(); // pays user 1 its 20 pro rata; u1 still owed 10
        vm.prank(users[1]);
        assertTrue(MockAUSD(token).transfer(shop, 20 * USD)); // user 1's balance slot is empty again
        vm.warp(vm.getBlockTimestamp() + 7 days + 1);
        bytes memory data = abi.encodeCall(escrow.refund, (1));

        uint256 skipped;
        uint256 paid;
        for (uint256 g = 20_000; g <= 300_000; g += 250) {
            uint256 snap = vm.snapshotState();
            (bool ok,) = address(escrow).call{gas: g}(data);
            if (ok) {
                if (_balance(users[1]) == 10 * USD) ++paid;
                else ++skipped;
            }
            vm.revertToState(snap);
        }
        assertEq(skipped, 0, "a gas limit made the refund skip the creditor's payout");
        assertGt(paid, 0, "refund never succeeded in the scanned range");
    }

    /// @dev A payout that fails for a real reason (a frozen recipient) is still skipped and kept as
    /// a claim, with the gas an ordinary relayer would send; the gas check must not turn it into a
    /// revert.
    function test_payDebt_frozenCreditorStillSkipped() public {
        Pot pot = _settledWithDebt();
        MockAUSD(token).setFrozen(users[1], true);
        _fund(users[0], 20 * USD);
        pot.payDebt{gas: 300_000}(users[0], _auth(pks[0], address(pot), 20 * USD));
        assertEq(pot.netOf(users[0]), 0);
        assertEq(pot.netOf(users[1]), int256(20 * USD));
        assertEq(_balance(address(pot)), 20 * USD);
        _assertI1(pot);
    }

    /// @dev A pull that fails for a real reason (a frozen debtor) is still skipped and recorded as
    /// debt on exit.
    function test_exit_frozenDebtorPullStillSkipped() public {
        Rules memory r = _balancedRules();
        r.instantMax = uint64(100 * USD);
        Pot pot = _potWith(2, r, 0);
        _propose(pot, 1, SpendKind.PERSONAL, shop, 20 * USD, 0, _addrs(users[0]), _ones(1));
        _fund(users[0], 20 * USD);
        _approveSafetyNet(pot, 0, 20 * USD);
        MockAUSD(token).setFrozen(users[0], true);
        uint256 nonce = _nonce();
        bytes memory sig = _memberSig(pot, 0, "Exit", nonce);
        pot.exit{gas: 300_000}(users[0], nonce, _deadline(), sig);
        assertEq(pot.netOf(users[0]), -int256(20 * USD));
        assertEq(_balance(users[0]), 20 * USD);
        _assertI1(pot);
    }
}
