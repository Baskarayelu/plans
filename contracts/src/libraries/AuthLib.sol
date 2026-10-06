// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "solady/utils/ECDSA.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

/// @title AuthLib
/// @notice Signature checks and unordered nonces shared by the Plans contracts.
library AuthLib {
    /// @notice Returns whether `signature` is `signer`'s signature over `digest`.
    /// @dev Tries `ecrecover` first and falls back to ERC-1271. This accepts the same signers as
    /// Solady's `SignatureCheckerLib.isValidSignatureNowCalldata` (EOAs, EIP-7702 accounts and
    /// ERC-1271 contracts) but skips its up-front `EXTCODESIZE`, a cold account access that costs
    /// 10,100 gas on Monad, for the common EOA case. A contract account cannot produce an
    /// `ecrecover` match because no private key maps to its address.
    function isValidSignatureNowCalldata(address signer, bytes32 digest, bytes calldata signature)
        internal
        view
        returns (bool)
    {
        if (signer == address(0)) return false;
        if (ECDSA.tryRecoverCalldata(digest, signature) == signer) return true;
        return SignatureCheckerLib.isValidERC1271SignatureNowCalldata(signer, digest, signature);
    }

    /// @notice Marks `nonce` as used for `account`. Returns false if it was already used.
    /// @dev Nonces are stored as a bitmap: nonces that share their upper 248 bits share one storage
    /// word, so an app that counts up in the low byte pays for a new slot once per 256 actions.
    function useNonce(mapping(address => mapping(uint256 => uint256)) storage words, address account, uint256 nonce)
        internal
        returns (bool)
    {
        uint256 bit = 1 << (nonce & 0xff);
        uint256 word = words[account][nonce >> 8];
        if (word & bit != 0) return false;
        words[account][nonce >> 8] = word | bit;
        return true;
    }

    /// @notice Returns whether `nonce` has been used for `account`.
    function isNonceUsed(mapping(address => mapping(uint256 => uint256)) storage words, address account, uint256 nonce)
        internal
        view
        returns (bool)
    {
        return words[account][nonce >> 8] & (1 << (nonce & 0xff)) != 0;
    }
}
