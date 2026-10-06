// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "solady/tokens/ERC20.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

/// @notice Test double for AUSD: 6 decimals, ERC-2612 permit and the bytes-signature ERC-3009
/// variants, with AUSD's EIP-712 domain { name: "Agora Dollar", version: "1" }.
/// `setFrozen` mimics an issuer freeze so tests can exercise failed transfers.
contract MockAUSD is ERC20 {
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    error AuthorizationNotYetValid();
    error AuthorizationExpired();
    error AuthorizationAlreadyUsed();
    error CallerMustBePayee();
    error InvalidAuthorizationSignature();
    error AccountFrozen();

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    mapping(address => mapping(bytes32 => bool)) public authorizationState;
    mapping(address => bool) public frozen;

    function name() public pure override returns (string memory) {
        return "AUSD";
    }

    function symbol() public pure override returns (string memory) {
        return "AUSD";
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFrozen(address account, bool isFrozen) external {
        frozen[account] = isFrozen;
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        _useAuthorization(
            TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce, signature
        );
        _transfer(from, to, value);
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        if (to != msg.sender) revert CallerMustBePayee();
        _useAuthorization(
            RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce, signature
        );
        _transfer(from, to, value);
    }

    function _useAuthorization(
        bytes32 typehash,
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) internal {
        if (block.timestamp <= validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= validBefore) revert AuthorizationExpired();
        if (authorizationState[from][nonce]) revert AuthorizationAlreadyUsed();
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR(),
                keccak256(abi.encode(typehash, from, to, value, validAfter, validBefore, nonce))
            )
        );
        if (!SignatureCheckerLib.isValidSignatureNowCalldata(from, digest, signature)) {
            revert InvalidAuthorizationSignature();
        }
        authorizationState[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
    }

    function _constantNameHash() internal pure override returns (bytes32) {
        return keccak256("Agora Dollar");
    }

    function _givePermit2InfiniteAllowance() internal pure override returns (bool) {
        return false;
    }

    function _beforeTokenTransfer(address from, address to, uint256) internal view override {
        if (frozen[from] || frozen[to]) revert AccountFrozen();
    }
}
