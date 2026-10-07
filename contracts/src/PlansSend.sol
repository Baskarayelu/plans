// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {IPlansSend} from "./interfaces/IPlansPeriphery.sol";
import {IFxReference} from "./interfaces/IFxReference.sol";
import {AUSDLib} from "./libraries/AUSDLib.sol";

/// @title PlansSend
/// @notice Person-to-person AUSD sends with an onchain receipt. Holds no funds between calls.
/// A send can name the FxReference round its displayed rate came from; the receipt then also
/// carries that round's reference rate and how far the applied rate is from it. FX is display and
/// transparency only: it never changes the AUSD amount that moves.
contract PlansSend is IPlansSend {
    using SafeTransferLib for address;

    /// @notice A send that names an FX round older than this (by its scheduled time) is refused.
    uint256 public constant MAX_FX_AGE = 6 hours;
    uint256 internal constant E8 = 1e8;
    int256 internal constant BPS = 10_000;

    error NonceMismatch();
    error ZeroAddress();
    error ZeroAmount();
    error FxRoundUnknown(uint64 roundId);
    error FxRoundStale(uint64 roundId, uint64 scheduledTime);
    error FxPairUnavailable(uint64 roundId, bytes3 fromCurrency, bytes3 toCurrency);

    /// @inheritdoc IPlansSend
    address public immutable ausd;
    /// @inheritdoc IPlansSend
    address public immutable fxReference;

    /// @param fxReference_ The FxReference that `meta.fxRoundId` refers to (address(0) disables FX rounds).
    constructor(address ausd_, address fxReference_) {
        ausd = ausd_;
        fxReference = fxReference_;
    }

    /// @inheritdoc IPlansSend
    /// @dev `auth.nonce == keccak256(abi.encode(meta))` makes the sender's single ERC-3009
    /// signature cover the recipient and every receipt field, including the applied rate and the FX
    /// round, so a relayer cannot alter them.
    function send(address from, SendMeta calldata meta, Auth3009 calldata auth) external {
        if (auth.nonce != keccak256(abi.encode(meta))) revert NonceMismatch();
        if (meta.to == address(0)) revert ZeroAddress();
        if (auth.value == 0) revert ZeroAmount();
        (uint256 refRateE8, int256 diffBps) = meta.fxRoundId == 0 ? (uint256(0), int256(0)) : _reference(meta);
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
            meta.memoHash,
            meta.fxRoundId,
            refRateE8,
            diffBps
        );
    }

    /// @notice What `send` would record for `meta`'s FX fields: the reference rate (toCurrency per
    /// 1 fromCurrency, 8 decimals) and the applied rate's difference from it in basis points.
    /// Reverts exactly as `send` would for an unknown, stale or incomplete round.
    function previewReference(SendMeta calldata meta) external view returns (uint256 refRateE8, int256 diffBps) {
        if (meta.fxRoundId == 0) return (0, 0);
        return _reference(meta);
    }

    /// @dev Rates in FxReference are USD per unit (AUSD = USD), so
    /// toCurrency per 1 fromCurrency = usdPer(from) / usdPer(to), kept at 8 decimals and floored.
    function _reference(SendMeta calldata meta) internal view returns (uint256 refRateE8, int256 diffBps) {
        uint64 id = meta.fxRoundId;
        IFxReference fx = IFxReference(fxReference);
        if (address(fx) == address(0)) revert FxRoundUnknown(id);
        uint64 scheduledTime = fx.roundTime(id);
        if (scheduledTime == 0) revert FxRoundUnknown(id);
        if (block.timestamp > uint256(scheduledTime) + MAX_FX_AGE) revert FxRoundStale(id, scheduledTime);
        uint256 fromUsd = fx.rateOf(id, meta.fromCurrency);
        uint256 toUsd = fx.rateOf(id, meta.toCurrency);
        if (fromUsd == 0 || toUsd == 0) revert FxPairUnavailable(id, meta.fromCurrency, meta.toCurrency);
        refRateE8 = fromUsd * E8 / toUsd;
        if (refRateE8 == 0) revert FxPairUnavailable(id, meta.fromCurrency, meta.toCurrency);
        diffBps = (int256(uint256(meta.fxRateE8)) - int256(refRateE8)) * BPS / int256(refRateE8);
    }
}
