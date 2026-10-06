// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {IPlansSend} from "./interfaces/IPlansPeriphery.sol";
import {AUSDLib} from "./libraries/AUSDLib.sol";

/// @title PlansSend
/// @notice Person-to-person AUSD sends with an onchain receipt. Holds no funds between calls.
contract PlansSend is IPlansSend {
    using SafeTransferLib for address;

    error NonceMismatch();
    error ZeroAddress();
    error ZeroAmount();

    address public immutable ausd;

    constructor(address ausd_) {
        ausd = ausd_;
    }

    /// @inheritdoc IPlansSend
    /// @dev `auth.nonce == keccak256(abi.encode(meta))` makes the sender's single ERC-3009
    /// signature cover the recipient and every receipt field, so a relayer cannot alter them.
    function send(address from, SendMeta calldata meta, Auth3009 calldata auth) external {
        if (auth.nonce != keccak256(abi.encode(meta))) revert NonceMismatch();
        if (meta.to == address(0)) revert ZeroAddress();
        if (auth.value == 0) revert ZeroAmount();
        AUSDLib.receiveFrom(ausd, from, auth);
        ausd.safeTransfer(meta.to, auth.value);
        emit Sent(
            from,
            meta.to,
            auth.value,
            meta.fromCountry,
            meta.toCountry,
            meta.fromCurrency,
            meta.toCurrency,
            meta.fxRateE8,
            meta.fxTimestamp,
            meta.memoHash
        );
    }
}
