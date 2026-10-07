// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {LibBit} from "solady/utils/LibBit.sol";
import {IERC165, IFxReference, IReceiver} from "./interfaces/IFxReference.sol";

/// @title FxReference
/// @notice Reference FX rates delivered by a Chainlink CRE workflow (cre/fx-workflow), stored as
/// numbered rounds. Rates are USD per one unit of each currency in a fixed list, 8 decimals. They are
/// for display and receipts only: nothing in Plans prices a transfer with them, and this contract
/// never holds, moves or approves funds. The report format is documented in {IFxReference}.
///
/// Who can write a round:
/// - **Simulation mode** (`simTransmitter != 0`, the deploy-time mode). `msg.sender` must be the
///   chain's Chainlink MockKeystoneForwarder (`SIM_FORWARDER`, fixed at deployment) and `tx.origin`
///   must be `simTransmitter`, the wallet that runs `cre workflow simulate --broadcast`. The mock
///   forwarder is permissionless and verifies no DON signatures, and the metadata it passes is a
///   placeholder, so the `tx.origin` check is the only thing that stops a stranger. THIS IS A DEMO
///   GUARD, not oracle security: a round written in simulation mode is as trustworthy as the
///   `simTransmitter` key and the single machine that ran the simulation.
/// - **Production mode** (`simTransmitter == 0`). `msg.sender` must be the configured
///   KeystoneForwarder (which checks f+1 DON signatures), and the report metadata must carry the
///   expected workflow id and workflow owner. Production mode can never use the mock forwarder.
///
/// Every report must also name this chain's CCIP chain selector (the DON's signatures do not
/// commit to a chain), carry a `scheduledTime` later than the last accepted one (replay
/// protection: the forwarder does not mark reverted deliveries as used) and no more than
/// `MAX_FUTURE_SKEW` ahead of the block, have at least 2 agreeing sources for every rate it
/// carries, and keep every rate within `maxMoveBps` of the last accepted rate for that currency.
///
/// The owner's powers are limited to: switching between simulation mode (choosing the
/// `simTransmitter`) and production mode (choosing the KeystoneForwarder, workflow id and workflow
/// owner), setting `maxMoveBps` (1..10,000), and handing over ownership. The owner cannot edit or
/// delete a round, cannot write rates except through a forwarder like anyone in that role, and
/// cannot touch any funds. A malicious or compromised owner could therefore make future rounds
/// (and the receipts that reference them) show wrong reference rates; it could never move money.
contract FxReference is IFxReference {
    // ───────────────────────────── constants ─────────────────────────────

    uint256 public constant N_CURRENCIES = 8;
    /// @notice A present rate needs at least this many agreeing sources.
    uint256 public constant MIN_SOURCES = 2;
    /// @notice Bits a source mask may use: 0 Frankfurter/ECB, 1 fawazahmed0 currency-api,
    /// 2 Frankfurter central-bank blend.
    uint8 public constant KNOWN_SOURCES = 0x07;
    /// @notice How far a report's scheduled time may be ahead of the block (clock skew).
    uint256 public constant MAX_FUTURE_SKEW = 5 minutes;
    uint16 public constant DEFAULT_MAX_MOVE_BPS = 1_000; // 10 %
    /// @dev Report metadata: workflowId (bytes 0-31) | workflowName (32-41) | workflowOwner (42-61) | reportId (62-63).
    uint256 internal constant METADATA_ID_END = 32;
    uint256 internal constant METADATA_OWNER_START = 42;
    uint256 internal constant METADATA_OWNER_END = 62;
    uint256 internal constant BPS = 10_000;
    uint64 internal constant USD_E8 = 1e8;

    // ───────────────────────────── errors ─────────────────────────────

    error Unauthorized();
    error ZeroAddress();
    error InvalidConfig();
    error InvalidSender(address sender);
    error InvalidTransmitter(address origin);
    error InvalidMetadata();
    error InvalidWorkflowId(bytes32 workflowId);
    error InvalidWorkflowOwner(address workflowOwner);
    error WrongChain(uint64 chainSelector);
    error StaleReport(uint64 scheduledTime, uint64 lastScheduledTime);
    error FutureReport(uint64 scheduledTime);
    error InvalidRateDate(uint32 rateDate);
    error InvalidLength();
    error CurrencyMismatch(uint256 index);
    error MissingSources(bytes3 currency, uint8 sourceMask);
    error RateMoveTooLarge(bytes3 currency, uint64 previousE8, uint64 newE8);
    error EmptyReport();

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ───────────────────────────── immutables ─────────────────────────────

    /// @notice The CCIP chain selector of this chain (Monad testnet 2183018362218727504, mainnet
    /// 8481857512324358265). Reports must name it.
    uint64 public immutable CHAIN_SELECTOR;
    /// @notice Chainlink's MockKeystoneForwarder on this chain, the forwarder of simulation mode.
    address public immutable SIM_FORWARDER;

    // ───────────────────────────── storage ─────────────────────────────

    /// @dev One round: header (1 slot) and 8 rates (2 slots). `masks` packs the 8 per-currency
    /// source masks, one byte each, currency 0 in the low byte.
    struct RoundData {
        uint64 scheduledTime;
        uint64 writtenAt;
        uint32 rateDate;
        uint8 sourceMask;
        uint64 masks;
        uint64[N_CURRENCIES] rates;
    }

    address public owner;
    address public pendingOwner;

    /// @inheritdoc IFxReference
    address public forwarder;
    /// @inheritdoc IFxReference
    address public simTransmitter;
    /// @inheritdoc IFxReference
    bytes32 public expectedWorkflowId;
    /// @inheritdoc IFxReference
    address public expectedWorkflowOwner;
    /// @inheritdoc IFxReference
    uint16 public maxMoveBps;

    /// @inheritdoc IFxReference
    uint64 public latestRoundId;
    /// @notice The scheduled time of the latest accepted report.
    uint64 public lastScheduledTime;
    /// @dev The last accepted rate per currency index (the reference for `maxMoveBps`).
    uint64[N_CURRENCIES] internal _lastRate;

    mapping(uint64 roundId => RoundData) internal _rounds;

    // ───────────────────────────── setup ─────────────────────────────

    /// @param owner_ Can switch modes, set the move limit and hand over ownership; nothing else.
    /// @param simForwarder Chainlink's MockKeystoneForwarder on this chain (simulation mode).
    /// @param simTransmitter_ The wallet allowed to deliver reports in simulation mode.
    /// @param chainSelector This chain's CCIP chain selector.
    /// @dev Starts in simulation mode. The owner is explicit because this contract is deployed
    /// through the CREATE2 deployer, which would otherwise be `msg.sender`.
    constructor(address owner_, address simForwarder, address simTransmitter_, uint64 chainSelector) {
        if (owner_ == address(0) || simForwarder == address(0) || simTransmitter_ == address(0)) revert ZeroAddress();
        if (chainSelector == 0) revert InvalidConfig();
        CHAIN_SELECTOR = chainSelector;
        SIM_FORWARDER = simForwarder;
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
        forwarder = simForwarder;
        simTransmitter = simTransmitter_;
        emit SimulationModeSet(simForwarder, simTransmitter_);
        maxMoveBps = DEFAULT_MAX_MOVE_BPS;
        emit MaxMoveSet(DEFAULT_MAX_MOVE_BPS);
    }

    // ───────────────────────────── CRE receiver ─────────────────────────────

    /// @inheritdoc IReceiver
    /// @dev A revert here is recorded by the forwarder as a failed delivery; the round is not written.
    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != forwarder) revert InvalidSender(msg.sender);
        address transmitter = simTransmitter;
        if (transmitter != address(0)) {
            // Simulation mode (demo guard): the mock forwarder is permissionless, so only the
            // configured transmitter's own transactions may deliver.
            // solhint-disable-next-line avoid-tx-origin
            if (tx.origin != transmitter) revert InvalidTransmitter(tx.origin);
        } else {
            // Production mode: metadata = workflowId (32) | workflowName (10) | workflowOwner (20) | reportId (2).
            if (metadata.length < METADATA_OWNER_END) revert InvalidMetadata();
            bytes32 workflowId = bytes32(metadata[0:METADATA_ID_END]);
            address workflowOwner = address(bytes20(metadata[METADATA_OWNER_START:METADATA_OWNER_END]));
            bytes32 wantId = expectedWorkflowId;
            address wantOwner = expectedWorkflowOwner;
            if (wantId == 0 || wantOwner == address(0)) revert InvalidConfig();
            if (workflowId != wantId) revert InvalidWorkflowId(workflowId);
            if (workflowOwner != wantOwner) revert InvalidWorkflowOwner(workflowOwner);
        }
        _processReport(report);
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function _processReport(bytes calldata report) internal {
        (
            uint64 chainSelector,
            uint64 scheduledTime,
            uint32 rateDate,
            bytes3[] memory ccys,
            uint64[] memory rates,
            uint8[] memory masks
        ) = abi.decode(report, (uint64, uint64, uint32, bytes3[], uint64[], uint8[]));

        if (chainSelector != CHAIN_SELECTOR) revert WrongChain(chainSelector);
        uint64 last = lastScheduledTime;
        if (scheduledTime <= last) revert StaleReport(scheduledTime, last);
        if (scheduledTime > block.timestamp + MAX_FUTURE_SKEW) revert FutureReport(scheduledTime);
        if (rateDate < 19700101 || rateDate > 99991231) revert InvalidRateDate(rateDate);
        if (ccys.length != N_CURRENCIES || rates.length != N_CURRENCIES || masks.length != N_CURRENCIES) {
            revert InvalidLength();
        }

        uint64 id = latestRoundId + 1;
        RoundData storage r = _rounds[id];
        uint256 maxMove = maxMoveBps;
        uint8 roundMask;
        uint64 packedMasks;
        bool any;
        for (uint256 i; i < N_CURRENCIES; ++i) {
            bytes3 ccy = _currency(i);
            if (ccys[i] != ccy) revert CurrencyMismatch(i);
            uint64 rate = rates[i];
            uint8 mask = masks[i];
            if (rate == 0) {
                if (mask != 0) revert MissingSources(ccy, mask);
                continue;
            }
            if (mask & ~KNOWN_SOURCES != 0 || LibBit.popCount(mask) < MIN_SOURCES) revert MissingSources(ccy, mask);
            uint64 prev = _lastRate[i];
            if (prev != 0) {
                uint256 diff = rate > prev ? rate - prev : prev - rate;
                if (diff * BPS > uint256(prev) * maxMove) revert RateMoveTooLarge(ccy, prev, rate);
            }
            _lastRate[i] = rate;
            r.rates[i] = rate;
            roundMask |= mask;
            packedMasks |= uint64(uint256(mask) << (8 * i));
            any = true;
        }
        if (!any) revert EmptyReport();

        r.scheduledTime = scheduledTime;
        r.writtenAt = uint64(block.timestamp);
        r.rateDate = rateDate;
        r.sourceMask = roundMask;
        r.masks = packedMasks;
        latestRoundId = id;
        lastScheduledTime = scheduledTime;
        emit RoundWritten(id, scheduledTime, rateDate, roundMask, rates, masks);
    }

    // ───────────────────────────── views ─────────────────────────────

    /// @inheritdoc IFxReference
    function latestRound() external view returns (Round memory) {
        return _round(latestRoundId);
    }

    /// @inheritdoc IFxReference
    function round(uint64 id) external view returns (Round memory) {
        return _round(id);
    }

    /// @inheritdoc IFxReference
    function rateOf(uint64 id, bytes3 ccy) external view returns (uint64) {
        RoundData storage r = _rounds[id];
        if (r.scheduledTime == 0) return 0;
        if (ccy == "USD") return USD_E8;
        for (uint256 i; i < N_CURRENCIES; ++i) {
            if (_currency(i) == ccy) return r.rates[i];
        }
        return 0;
    }

    /// @inheritdoc IFxReference
    function latestRoundTime() external view returns (uint64 roundId, uint64 scheduledTime) {
        roundId = latestRoundId;
        scheduledTime = _rounds[roundId].scheduledTime;
    }

    /// @inheritdoc IFxReference
    function roundTime(uint64 id) external view returns (uint64) {
        return _rounds[id].scheduledTime;
    }

    /// @inheritdoc IFxReference
    function currencies() public pure returns (bytes3[] memory list) {
        list = new bytes3[](N_CURRENCIES);
        for (uint256 i; i < N_CURRENCIES; ++i) {
            list[i] = _currency(i);
        }
    }

    /// @notice The last accepted rate for each currency (the reference for the move limit).
    function lastRates() external view returns (uint64[N_CURRENCIES] memory) {
        return _lastRate;
    }

    // ───────────────────────────── owner ─────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    /// @notice Simulation mode: reports arrive through this chain's MockKeystoneForwarder and must
    /// be sent by `transmitter` (checked against tx.origin). A demo guard only; see the contract notes.
    function setSimulationMode(address transmitter) external onlyOwner {
        if (transmitter == address(0)) revert ZeroAddress();
        forwarder = SIM_FORWARDER;
        simTransmitter = transmitter;
        expectedWorkflowId = 0;
        expectedWorkflowOwner = address(0);
        emit SimulationModeSet(SIM_FORWARDER, transmitter);
    }

    /// @notice Production mode: reports arrive through `keystoneForwarder` (DON signatures checked
    /// there) and their metadata must carry `workflowId` and `workflowOwner`.
    function setProductionMode(address keystoneForwarder, bytes32 workflowId, address workflowOwner)
        external
        onlyOwner
    {
        if (keystoneForwarder == address(0) || workflowOwner == address(0)) revert ZeroAddress();
        if (keystoneForwarder == SIM_FORWARDER || workflowId == 0) revert InvalidConfig();
        forwarder = keystoneForwarder;
        simTransmitter = address(0);
        expectedWorkflowId = workflowId;
        expectedWorkflowOwner = workflowOwner;
        emit ProductionModeSet(keystoneForwarder, workflowId, workflowOwner);
    }

    /// @notice The largest accepted move of a currency's rate against its last accepted rate, in bps.
    function setMaxMoveBps(uint16 bps) external onlyOwner {
        if (bps == 0 || bps > BPS) revert InvalidConfig();
        maxMoveBps = bps;
        emit MaxMoveSet(bps);
    }

    /// @notice Starts a two-step ownership handover; `newOwner` must call `acceptOwnership`.
    /// Passing address(0) cancels a pending handover.
    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ───────────────────────────── internal ─────────────────────────────

    /// @dev The fixed currency list: GBP, EUR, INR, NGN, JPY, CHF, AED, SGD.
    function _currency(uint256 i) internal pure returns (bytes3) {
        if (i == 0) return "GBP";
        if (i == 1) return "EUR";
        if (i == 2) return "INR";
        if (i == 3) return "NGN";
        if (i == 4) return "JPY";
        if (i == 5) return "CHF";
        if (i == 6) return "AED";
        return "SGD";
    }

    function _round(uint64 id) internal view returns (Round memory out) {
        RoundData storage r = _rounds[id];
        if (r.scheduledTime == 0) return out;
        out.roundId = id;
        out.scheduledTime = r.scheduledTime;
        out.writtenAt = r.writtenAt;
        out.rateDate = r.rateDate;
        out.sourceMask = r.sourceMask;
        out.currencies = currencies();
        out.usdPerUnitE8 = new uint64[](N_CURRENCIES);
        out.sourceMasks = new uint8[](N_CURRENCIES);
        uint64 masks = r.masks;
        for (uint256 i; i < N_CURRENCIES; ++i) {
            out.usdPerUnitE8[i] = r.rates[i];
            out.sourceMasks[i] = uint8(masks >> (8 * i));
        }
    }
}
