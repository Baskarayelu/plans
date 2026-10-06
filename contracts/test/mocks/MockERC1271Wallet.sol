// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "solady/utils/ECDSA.sol";

/// @notice Minimal smart-contract wallet that accepts its owner's ECDSA signature (ERC-1271).
contract MockERC1271Wallet {
    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        return ECDSA.recoverCalldata(hash, signature) == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}
