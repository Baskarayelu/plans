// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPlansTypes} from "./IPlansTypes.sol";

/// @notice Deploys one Pot clone per plan (ERC-1167, CREATE2).
/// EIP-712 domain { name: "Plans Factory", version: "1" }.
/// CreatePot(address creator,bytes32 paramsHash,uint256 nonce,uint256 deadline)
/// paramsHash = keccak256(abi.encode(params))
interface IPlansFactory is IPlansTypes {
    event PotCreated(
        address indexed pot,
        address indexed creator,
        uint64 startTime,
        uint64 endTime,
        uint32 reviewWindow,
        bytes meta,
        bytes inviteKeyWrap
    );

    function createPot(
        address creator,
        CreatePotParams calldata params,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig,
        Auth3009 calldata deposit,
        Permit2612 calldata safetyNet,
        KeyReg calldata keyReg
    ) external returns (address pot);

    function predictPot(address creator, bytes32 salt) external view returns (address);
    function isPot(address pot) external view returns (bool);
    function ausd() external view returns (address);
    function keyRegistry() external view returns (address);
    function claimEscrow() external view returns (address);
}

/// @notice Address → X25519 public key used to seal group keys to a member.
/// EIP-712 domain { name: "Plans Keys", version: "1" }.
/// RegisterKey(address account,bytes32 pubKey,uint256 deadline)
interface IKeyRegistry {
    event KeyRegistered(address indexed account, bytes32 pubKey);

    function register(address account, bytes32 pubKey, uint256 deadline, bytes calldata sig) external;
    function keyOf(address account) external view returns (bytes32);
}

/// @notice Money held against a one-time claim key. Used by pots (LINK spends) and by Send-by-link.
interface IClaimEscrow is IPlansTypes {
    event ClaimCreated(
        uint256 indexed id,
        address indexed source,
        address indexed claimSigner,
        uint256 amount,
        uint64 expiry,
        uint256 sourceSpendId, // 0 when not from a pot
        bytes2 fromCountry
    );
    event Claimed(uint256 indexed id, address indexed recipient, bytes2 toCountry);
    event ClaimRefunded(uint256 indexed id, address indexed to, uint256 amount);

    /// @notice Pot only (factory-registered pots). Pulls `amount` from msg.sender.
    function createFromPot(address claimSigner, uint256 amount, uint64 expiry, uint256 spendId)
        external
        returns (uint256 id);

    /// @notice Send-by-link. Pulls AUSD from `from` with receiveWithAuthorization (to = this contract).
    /// The 3009 nonce must equal keccak256(abi.encode(claimSigner, expiry, fromCountry, salt)), which binds
    /// the claim terms to the sender's signature without a second signature.
    function createWithAuthorization(
        address from,
        address claimSigner,
        uint64 expiry,
        bytes2 fromCountry,
        bytes32 salt,
        Auth3009 calldata auth
    ) external returns (uint256 id);

    /// @notice EIP-712 domain { name: "Plans Claims", version: "1" }.
    /// Claim(uint256 id,address recipient,bytes2 toCountry) signed by the claim key.
    function claim(uint256 id, address recipient, bytes2 toCountry, bytes calldata claimSig) external;

    /// @notice After expiry, anyone may refund to the source.
    function refund(uint256 id) external;
}

/// @notice Person-to-person AUSD sends with an onchain receipt.
interface IPlansSend is IPlansTypes {
    struct SendMeta {
        address to;
        bytes2 fromCountry;
        bytes2 toCountry;
        bytes3 fromCurrency; // ISO 4217, e.g. "GBP"
        bytes3 toCurrency;
        uint64 fxRateE8; // reference units of toCurrency per 1 fromCurrency, 8 decimals
        uint64 fxTimestamp;
        bytes32 memoHash;
        bytes32 salt;
    }

    event Sent(
        address indexed from,
        address indexed to,
        uint256 amount,
        bytes2 fromCountry,
        bytes2 toCountry,
        bytes3 fromCurrency,
        bytes3 toCurrency,
        uint64 fxRateE8,
        uint64 fxTimestamp,
        bytes32 memoHash
    );

    /// @notice Pulls with receiveWithAuthorization (to = this contract) and forwards to meta.to.
    /// The 3009 nonce must equal keccak256(abi.encode(meta)), binding recipient and receipt fields.
    function send(address from, SendMeta calldata meta, Auth3009 calldata auth) external;
}

/// @notice Minimal AUSD surface used by Plans (ERC-20 + ERC-2612 + ERC-3009 bytes-signature variant).
interface IAUSD {
    function balanceOf(address) external view returns (uint256);
    function allowance(address, address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;
    function nonces(address) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}
