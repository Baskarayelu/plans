// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPlansTypes} from "../interfaces/IPlansTypes.sol";
import {IAUSD} from "../interfaces/IPlansPeriphery.sol";

/// @title AUSDLib
/// @notice The two AUSD authorisation flows Plans uses: ERC-3009 deposits and ERC-2612 permits.
library AUSDLib {
    /// @notice Pulls `auth.value` from `from` into this contract with `receiveWithAuthorization`.
    /// @dev The authorisation names this contract as `to`, and AUSD requires `msg.sender == to`,
    /// so a third party cannot front-run the deposit into a different call.
    function receiveFrom(address ausd, address from, IPlansTypes.Auth3009 calldata auth) internal {
        IAUSD(ausd)
            .receiveWithAuthorization(
                from, address(this), auth.value, auth.validAfter, auth.validBefore, auth.nonce, auth.signature
            );
    }

    /// @notice Submits `owner`'s permit for `spender`. Returns false only if the permit failed and
    /// the allowance is below `p.value`.
    /// @dev A permit that was already submitted (for example by a front-runner, or on a replayed
    /// transaction) reverts inside AUSD; that must not make the surrounding action fail.
    function permitOrAllowance(address ausd, address owner, address spender, IPlansTypes.Permit2612 calldata p)
        internal
        returns (bool)
    {
        try IAUSD(ausd).permit(owner, spender, p.value, p.deadline, p.v, p.r, p.s) {
            return true;
        } catch {
            return IAUSD(ausd).allowance(owner, spender) >= p.value;
        }
    }
}
