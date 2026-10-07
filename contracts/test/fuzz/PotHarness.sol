// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Pot} from "../../src/Pot.sol";

/// @notice Exposes Pot's internal split math and packing for fuzzing.
contract PotHarness is Pot {
    constructor() Pot(address(0), address(0), address(0), address(0)) {}

    function parts(uint256 amount, uint256[] memory w) external pure returns (uint256[] memory) {
        return _parts(amount, w);
    }

    function storeAndLoadSplit(uint256[] memory idx, uint256[] memory w)
        external
        returns (uint256[] memory, uint256[] memory, uint256)
    {
        Spend storage s = _spends[type(uint256).max];
        _storeSplit(s, idx, w);
        return _loadSplit(s);
    }
}
