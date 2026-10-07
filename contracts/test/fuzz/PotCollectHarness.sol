// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Pot} from "../../src/Pot.sol";

/// @notice A settled Pot with arbitrary member nets, for fuzzing `collect`'s pro-rata math
/// directly against the formula (real flows only reach a subset of net/balance combinations).
contract PotCollectHarness is Pot {
    constructor(address ausd_) Pot(ausd_, address(0), address(0), address(0)) {}

    function seed(address[] calldata accounts, int96[] calldata nets) external {
        uint256 n = accounts.length;
        for (uint256 i; i < n; ++i) {
            _members[i] = Member(accounts[i], nets[i]);
            _activeMask |= uint64(1 << i);
        }
        memberCount = uint8(n);
        settled = true;
    }
}
