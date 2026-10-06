// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "solady/utils/EIP712.sol";
import {SafeCastLib} from "solady/utils/SafeCastLib.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {IPot} from "./interfaces/IPot.sol";
import {IClaimEscrow, IPlansFactory} from "./interfaces/IPlansPeriphery.sol";
import {AuthLib} from "./libraries/AuthLib.sol";
import {AUSDLib} from "./libraries/AUSDLib.sol";

/// @title ClaimEscrow
/// @notice AUSD locked against a one-time claim key. The holder of the key claims by signing the
/// recipient; after expiry anyone may refund the money to its source. A claim is either claimable
/// (until `expiry`, inclusive) or refundable (after `expiry`), never both.
/// EIP-712 domain { name: "Plans Claims", version: "1", chainId, verifyingContract }.
/// Claim(uint256 id,address recipient,bytes2 toCountry)
contract ClaimEscrow is IClaimEscrow, EIP712 {
    using SafeTransferLib for address;

    bytes32 internal constant CLAIM_TYPEHASH = keccak256("Claim(uint256 id,address recipient,bytes2 toCountry)");

    enum Status {
        None,
        Open,
        Claimed,
        Refunded
    }

    error NotPot();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidExpiry();
    error NonceMismatch();
    error NotOpen();
    error ClaimExpired();
    error NotExpired();
    error InvalidSignature();

    /// @dev Two slots, in one storage page.
    struct ClaimData {
        address source; // pot or sender; receives refunds
        uint40 expiry;
        uint48 sourceSpendId; // 0 when not from a pot
        Status status;
        address claimSigner;
        uint96 amount;
    }

    /// @notice The PlansFactory whose pots may call `createFromPot`. It deploys this contract.
    address public immutable factory;
    address public immutable ausd;

    uint256 public claimCount;
    mapping(uint256 id => ClaimData) internal _claims;

    constructor(address ausd_) {
        factory = msg.sender;
        ausd = ausd_;
    }

    /// @inheritdoc IClaimEscrow
    function createFromPot(address claimSigner, uint256 amount, uint64 expiry, uint256 spendId)
        external
        returns (uint256 id)
    {
        if (!IPlansFactory(factory).isPot(msg.sender)) revert NotPot();
        ausd.safeTransferFrom(msg.sender, address(this), amount);
        id = _create(msg.sender, claimSigner, amount, expiry, spendId, bytes2(0));
    }

    /// @inheritdoc IClaimEscrow
    function createWithAuthorization(
        address from,
        address claimSigner,
        uint64 expiry,
        bytes2 fromCountry,
        bytes32 salt,
        Auth3009 calldata auth
    ) external returns (uint256 id) {
        if (auth.nonce != keccak256(abi.encode(claimSigner, expiry, fromCountry, salt))) {
            revert NonceMismatch();
        }
        if (expiry <= block.timestamp) revert InvalidExpiry();
        AUSDLib.receiveFrom(ausd, from, auth);
        id = _create(from, claimSigner, auth.value, expiry, 0, fromCountry);
    }

    /// @inheritdoc IClaimEscrow
    function claim(uint256 id, address recipient, bytes2 toCountry, bytes calldata claimSig) external {
        ClaimData storage c = _claims[id];
        if (c.status != Status.Open) revert NotOpen();
        if (block.timestamp > c.expiry) revert ClaimExpired();
        if (recipient == address(0)) revert ZeroAddress();
        bytes32 digest = _hashTypedData(keccak256(abi.encode(CLAIM_TYPEHASH, id, recipient, toCountry)));
        if (!AuthLib.isValidSignatureNowCalldata(c.claimSigner, digest, claimSig)) revert InvalidSignature();
        c.status = Status.Claimed;
        ausd.safeTransfer(recipient, c.amount);
        emit Claimed(id, recipient, toCountry);
    }

    /// @inheritdoc IClaimEscrow
    /// @dev For a pot's LINK spend the pot is told after the money is back, so it can reverse the
    /// spend's shares (or pay the refund out if it has settled).
    function refund(uint256 id) external {
        ClaimData storage c = _claims[id];
        if (c.status != Status.Open) revert NotOpen();
        if (block.timestamp <= c.expiry) revert NotExpired();
        c.status = Status.Refunded;
        address source = c.source;
        uint256 amount = c.amount;
        ausd.safeTransfer(source, amount);
        uint256 spendId = c.sourceSpendId;
        if (spendId != 0) IPot(source).onEscrowRefund(spendId, amount);
        emit ClaimRefunded(id, source, amount);
    }

    /// @notice A claim's terms and state.
    function claimInfo(uint256 id)
        external
        view
        returns (
            address source,
            address claimSigner,
            uint256 amount,
            uint64 expiry,
            uint256 sourceSpendId,
            Status status
        )
    {
        ClaimData storage c = _claims[id];
        return (c.source, c.claimSigner, c.amount, c.expiry, c.sourceSpendId, c.status);
    }

    function _create(
        address source,
        address claimSigner,
        uint256 amount,
        uint64 expiry,
        uint256 spendId,
        bytes2 fromCountry
    ) internal returns (uint256 id) {
        if (claimSigner == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        id = ++claimCount;
        _claims[id] = ClaimData({
            source: source,
            expiry: SafeCastLib.toUint40(expiry),
            sourceSpendId: SafeCastLib.toUint48(spendId),
            status: Status.Open,
            claimSigner: claimSigner,
            amount: SafeCastLib.toUint96(amount)
        });
        emit ClaimCreated(id, source, claimSigner, amount, expiry, spendId, fromCountry);
    }

    function _domainNameAndVersion() internal pure override returns (string memory, string memory) {
        return ("Plans Claims", "1");
    }
}
