// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PlansBase} from "./utils/PlansBase.sol";
import {Pot} from "../src/Pot.sol";

contract SmokeTest is PlansBase {
    function test_lifecycle() public {
        Pot pot = _potWith(3, _balancedRules(), 100 * USD);
        _assertI1(pot);
        uint256 id = _proposeEqual(pot, 0, SpendKind.PAY, users[9], 30 * USD, _users(3));
        _vote(pot, 1, id, true);
        _assertI1(pot);
        _ackAll(pot);
        pot.settle();
        _assertI1(pot);
        assertEq(_balance(address(pot)), 0);
    }
}
