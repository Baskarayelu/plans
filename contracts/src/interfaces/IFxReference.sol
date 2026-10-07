// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice ERC-165.
interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

/// @notice Chainlink CRE report receiver. The KeystoneForwarder (or, in simulation, the
/// MockKeystoneForwarder) calls `onReport` after the DON's report has been delivered. Receivers must
/// answer ERC-165 for this interface (`onReport.selector`).
interface IReceiver is IERC165 {
    /// @param metadata abi.encodePacked(bytes32 workflowId, bytes10 workflowName, address workflowOwner, bytes2 reportId)
    /// @param report the workflow's ABI-encoded payload
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @notice Reference FX rates written by a Chainlink CRE workflow, in numbered rounds.
///
/// Every rate is USD per one unit of the currency, with 8 decimals (AUSD is treated as USD, so
/// `rateOf(id, "USD") == 1e8` for every round). The currency list is fixed at deployment.
/// The rates are reference data for display and receipts. Plans never uses them to compute an
/// amount of money that moves, and this contract never holds or moves funds.
///
/// Report payload (the `report` argument of `onReport`):
///   abi.encode(uint64 chainSelector, uint64 scheduledTime, uint32 rateDate,
///              bytes3[] currencies, uint64[] usdPerUnitE8, uint8[] sourceMasks)
/// - chainSelector: the CCIP chain selector of the chain this contract is on (cross-chain replay).
/// - scheduledTime: the cron trigger's scheduled execution time (unix seconds); strictly increasing.
/// - rateDate: the newest source reference date, yyyymmdd (informational).
/// - currencies: exactly `currencies()`, in order.
/// - usdPerUnitE8[i]: USD per 1 currencies[i], 8 decimals; 0 = not in this round.
/// - sourceMasks[i]: which sources agreed on usdPerUnitE8[i] (bit 0 Frankfurter/ECB, bit 1
///   fawazahmed0 currency-api, bit 2 Frankfurter central-bank blend); at least 2 bits for a present
///   rate, 0 for an absent one.
interface IFxReference is IReceiver {
    struct Round {
        uint64 roundId;
        uint64 scheduledTime; // the workflow's cron scheduled time; staleness is measured from this
        uint64 writtenAt; // block timestamp of the write
        uint32 rateDate; // yyyymmdd
        uint8 sourceMask; // OR of sourceMasks
        bytes3[] currencies;
        uint64[] usdPerUnitE8; // 0 = absent in this round
        uint8[] sourceMasks;
    }

    event RoundWritten(
        uint64 indexed roundId,
        uint64 scheduledTime,
        uint32 rateDate,
        uint8 sourceMask,
        uint64[] usdPerUnitE8,
        uint8[] sourceMasks
    );
    /// @dev Simulation mode: forwarder = the chain's MockKeystoneForwarder, tx.origin must be `simTransmitter`.
    event SimulationModeSet(address indexed forwarder, address indexed simTransmitter);
    /// @dev Production mode: forwarder = a KeystoneForwarder, metadata must carry this workflow id and owner.
    event ProductionModeSet(address indexed forwarder, bytes32 indexed workflowId, address indexed workflowOwner);
    event MaxMoveSet(uint16 maxMoveBps);

    /// @notice The latest round (roundId 0 and empty arrays when none has been written).
    function latestRound() external view returns (Round memory);
    /// @notice Round `id` (roundId 0 and empty arrays when it does not exist).
    function round(uint64 id) external view returns (Round memory);
    /// @notice USD per 1 `ccy` in round `id`, 8 decimals. 0 when the round does not exist or does
    /// not have that currency. "USD" is 1e8 in every round that exists.
    function rateOf(uint64 id, bytes3 ccy) external view returns (uint64);
    /// @notice The latest round id and its scheduled time (0, 0 when none). Cheap, fixed-size.
    function latestRoundTime() external view returns (uint64 roundId, uint64 scheduledTime);
    /// @notice Round `id`'s scheduled time, 0 when the round does not exist.
    function roundTime(uint64 id) external view returns (uint64 scheduledTime);
    function latestRoundId() external view returns (uint64);
    /// @notice The fixed currency list, in report order.
    function currencies() external view returns (bytes3[] memory);

    function forwarder() external view returns (address);
    function simTransmitter() external view returns (address);
    function expectedWorkflowId() external view returns (bytes32);
    function expectedWorkflowOwner() external view returns (address);
    function maxMoveBps() external view returns (uint16);
}
