// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Pot} from "../../src/Pot.sol";
import {PlansBase} from "../utils/PlansBase.sol";

/// @notice Regressions for a bug the invariant suite found: a PAY spend could name the pot itself
/// or its ClaimEscrow as payee (policy ANYONE). Paying the pot charged shares without moving
/// money, breaking I1 and stranding the amount after settlement; paying the escrow left AUSD that
/// backed no claim. Both payees are now rejected with reason 5 under every payee policy.
contract PotBugReproTest is PlansBase {
    function _expectPayee() internal {
        vm.expectRevert(abi.encodeWithSelector(Pot.SpendBlocked.selector, uint8(5)));
    }

    function test_regression_payToPotItselfRejected() public {
        Pot pot = _potWith(3, _balancedRules(), 100 * USD);
        _expectPayee();
        _proposeEqual(pot, 0, SpendKind.PAY, address(pot), 20 * USD, _users(3));
        (, bool ok, uint8 reason) = pot.previewSpend(users[0], SpendKind.PAY, address(pot), 20 * USD, 0);
        assertFalse(ok);
        assertEq(reason, 5);
        _assertI1(pot);
    }

    function test_regression_payToPotItselfRejectedAtExecution() public {
        // a pending PAY to the pot can no longer be created, so check the execution path through
        // the allowlist policy too: even an allowlisted pot address is refused
        Rules memory r = _balancedRules();
        r.payeePolicy = PayeePolicy.MEMBERS_AND_ALLOWLIST;
        Pot pot = _potWith(3, r, 100 * USD);
        uint256 rc = _proposeRules(pot, 0, r, _addrs(address(pot)), new address[](0));
        _voteRules(pot, 1, rc, true);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        pot.applyRules(rc);
        assertTrue(pot.isAllowedPayee(address(pot)));
        _expectPayee();
        _proposeEqual(pot, 0, SpendKind.PAY, address(pot), 20 * USD, _users(3));
        _ackAll(pot);
        pot.settle();
        assertEq(_balance(address(pot)), 0, "nothing stranded in a settled pot");
    }

    function test_regression_payToEscrowRejected() public {
        Pot pot = _potWith(3, _balancedRules(), 100 * USD);
        _expectPayee();
        _proposeEqual(pot, 0, SpendKind.PAY, address(escrow), 20 * USD, _users(3));
        (, bool ok, uint8 reason) = pot.previewSpend(users[0], SpendKind.PAY, address(escrow), 20 * USD, 0);
        assertFalse(ok);
        assertEq(reason, 5);
        assertEq(_balance(address(escrow)), 0);
    }
}
