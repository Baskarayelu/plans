// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "solady/utils/EIP712.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {IPot} from "./interfaces/IPot.sol";
import {IKeyRegistry, IPlansFactory} from "./interfaces/IPlansPeriphery.sol";
import {AuthLib} from "./libraries/AuthLib.sol";
import {AUSDLib} from "./libraries/AUSDLib.sol";
import {ClaimEscrow} from "./ClaimEscrow.sol";
import {Pot} from "./Pot.sol";

/// @title PlansFactory
/// @notice Deploys one Pot clone (ERC-1167, CREATE2) per plan and registers it.
/// EIP-712 domain { name: "Plans Factory", version: "1", chainId, verifyingContract }.
/// CreatePot(address creator,bytes32 paramsHash,uint256 nonce,uint256 deadline)
///
/// @dev The constructor deploys the ClaimEscrow and the Pot implementation with CREATE. This breaks
/// the factory <-> escrow cycle deterministically: the escrow (nonce 1) and the implementation
/// (nonce 2) addresses follow from the factory address, and each learns the factory as its deployer.
contract PlansFactory is IPlansFactory, EIP712 {
    bytes32 internal constant CREATE_POT_TYPEHASH =
        keccak256("CreatePot(address creator,bytes32 paramsHash,uint256 nonce,uint256 deadline)");

    error SignatureExpired();
    error NonceAlreadyUsed();
    error InvalidSignature();
    error SafetyNetMismatch();
    error PermitFailed();

    /// @inheritdoc IPlansFactory
    address public immutable ausd;
    /// @inheritdoc IPlansFactory
    address public immutable keyRegistry;
    /// @inheritdoc IPlansFactory
    address public immutable claimEscrow;
    /// @notice The Pot implementation every clone delegates to.
    address public immutable potImplementation;

    /// @inheritdoc IPlansFactory
    mapping(address pot => bool) public isPot;
    mapping(address account => mapping(uint256 word => uint256 bits)) internal _nonces;

    constructor(address ausd_, address keyRegistry_) {
        ausd = ausd_;
        keyRegistry = keyRegistry_;
        claimEscrow = address(new ClaimEscrow(ausd_));
        potImplementation = address(new Pot(ausd_, keyRegistry_, claimEscrow));
    }

    /// @inheritdoc IPlansFactory
    /// @dev The creator's join happens in `Pot.initialize`. The optional extras then go through
    /// paths that need no further pot signature: the deposit through `Pot.contribute` (the pot is
    /// the ERC-3009 recipient), the permit directly on AUSD and the key through KeyRegistry.
    /// `safetyNet.value` must equal `params.creatorSafetyNet`, mirroring how `join` signs it.
    /// The extras are not covered by the CreatePot signature; a front-runner who resubmits the
    /// signed request without them only creates the same pot, and the deposit can follow through
    /// `contribute`. A creator reusing `params.salt` hits a CREATE2 collision and the call reverts.
    function createPot(
        address creator,
        CreatePotParams calldata params,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig,
        Auth3009 calldata deposit,
        Permit2612 calldata safetyNet,
        KeyReg calldata keyReg
    ) external returns (address pot) {
        if (block.timestamp > deadline) revert SignatureExpired();
        if (!AuthLib.useNonce(_nonces, creator, nonce)) revert NonceAlreadyUsed();
        bytes32 digest = _hashTypedData(
            keccak256(abi.encode(CREATE_POT_TYPEHASH, creator, keccak256(abi.encode(params)), nonce, deadline))
        );
        if (!AuthLib.isValidSignatureNowCalldata(creator, digest, sig)) revert InvalidSignature();
        if (safetyNet.value != params.creatorSafetyNet) revert SafetyNetMismatch();

        pot = LibClone.cloneDeterministic(potImplementation, _salt(creator, params.salt));
        isPot[pot] = true;
        emit PotCreated(
            pot,
            creator,
            params.startTime < block.timestamp ? uint64(block.timestamp) : params.startTime,
            params.endTime,
            params.reviewWindow,
            params.meta,
            params.inviteKeyWrap
        );
        IPot(pot).initialize(creator, params);

        if (deposit.value != 0) IPot(pot).contribute(creator, deposit);
        if (safetyNet.value != 0 && !AUSDLib.permitOrAllowance(ausd, creator, pot, safetyNet)) revert PermitFailed();
        if (keyReg.pubKey != 0 && IKeyRegistry(keyRegistry).keyOf(creator) != keyReg.pubKey) {
            IKeyRegistry(keyRegistry).register(creator, keyReg.pubKey, keyReg.deadline, keyReg.signature);
        }
    }

    /// @inheritdoc IPlansFactory
    function predictPot(address creator, bytes32 salt) external view returns (address) {
        return LibClone.predictDeterministicAddress(potImplementation, _salt(creator, salt), address(this));
    }

    /// @notice Whether `creator` has used `nonce` for CreatePot.
    function usedNonce(address creator, uint256 nonce) external view returns (bool) {
        return AuthLib.isNonceUsed(_nonces, creator, nonce);
    }

    /// @dev CREATE2 salt: keccak256(abi.encode(creator, salt)).
    function _salt(address creator, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(creator, salt));
    }

    function _domainNameAndVersion() internal pure override returns (string memory, string memory) {
        return ("Plans Factory", "1");
    }
}
