// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "solady/utils/EIP712.sol";
import {SafeCastLib} from "solady/utils/SafeCastLib.sol";
import {IKeyRegistry} from "./interfaces/IPlansPeriphery.sol";
import {AuthLib} from "./libraries/AuthLib.sol";

/// @title KeyRegistry
/// @notice Maps an account to the X25519 public key that group keys are sealed to. Registration is
/// by the account's EIP-712 signature, submitted by anyone.
/// EIP-712 domain { name: "Plans Keys", version: "1", chainId, verifyingContract }.
/// RegisterKey(address account,bytes32 pubKey,uint256 deadline)
contract KeyRegistry is IKeyRegistry, EIP712 {
    bytes32 internal constant REGISTER_KEY_TYPEHASH =
        keccak256("RegisterKey(address account,bytes32 pubKey,uint256 deadline)");

    error SignatureExpired();
    error InvalidSignature();
    error ZeroKey();
    /// @dev The signature is not newer than the account's current registration.
    error StaleRegistration();

    /// @dev Both fields share one storage page.
    struct Registration {
        bytes32 pubKey;
        uint64 deadline;
    }

    mapping(address account => Registration) internal _registrations;

    /// @inheritdoc IKeyRegistry
    /// @dev RegisterKey has no nonce. Replay is prevented by requiring each registration's
    /// `deadline` to be later than the deadline of the account's current registration, so an older
    /// signature can never restore an older key. Apps sign with `deadline = now + validity`.
    function register(address account, bytes32 pubKey, uint256 deadline, bytes calldata sig) external {
        if (block.timestamp > deadline) revert SignatureExpired();
        if (pubKey == 0) revert ZeroKey();
        Registration storage r = _registrations[account];
        if (deadline <= r.deadline) revert StaleRegistration();
        bytes32 digest = _hashTypedData(keccak256(abi.encode(REGISTER_KEY_TYPEHASH, account, pubKey, deadline)));
        if (!AuthLib.isValidSignatureNowCalldata(account, digest, sig)) revert InvalidSignature();
        r.pubKey = pubKey;
        r.deadline = SafeCastLib.toUint64(deadline);
        emit KeyRegistered(account, pubKey);
    }

    /// @inheritdoc IKeyRegistry
    function keyOf(address account) external view returns (bytes32) {
        return _registrations[account].pubKey;
    }

    function _domainNameAndVersion() internal pure override returns (string memory, string memory) {
        return ("Plans Keys", "1");
    }
}
