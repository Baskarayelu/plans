// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IPlansTypes} from "../../src/interfaces/IPlansTypes.sol";
import {IAUSD} from "../../src/interfaces/IPlansPeriphery.sol";

/// @notice Signs every EIP-712 message used by Plans with `vm.sign`. Type strings are written out
/// here independently of the contracts, so tests also check the contracts against the documented
/// strings in IPot.sol / IPlansPeriphery.sol.
library PlansSigs {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    // ─────────────── generic ───────────────

    function domainSeparator(string memory name, address verifyingContract) internal view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), keccak256("1"), block.chainid, verifyingContract)
        );
    }

    function sign(uint256 pk, bytes32 separator, bytes32 structHash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", separator, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function signPot(uint256 pk, address pot, bytes32 structHash) internal view returns (bytes memory) {
        return sign(pk, domainSeparator("Plans Pot", pot), structHash);
    }

    // ─────────────── Pot ───────────────

    function invite(uint256 pk, address pot, address member) internal view returns (bytes memory) {
        return signPot(pk, pot, keccak256(abi.encode(keccak256("Invite(address member)"), member)));
    }

    function join(
        uint256 pk,
        address pot,
        address member,
        bytes2 country,
        uint256 safetyNet,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        return signPot(
            pk,
            pot,
            keccak256(
                abi.encode(
                    keccak256("Join(address member,bytes2 country,uint256 safetyNet,uint256 nonce,uint256 deadline)"),
                    member,
                    country,
                    safetyNet,
                    nonce,
                    deadline
                )
            )
        );
    }

    struct ProposeMsg {
        address proposer;
        uint8 kind;
        address payee;
        uint256 amount;
        uint8 category;
        address[] members;
        uint32[] weights;
        bytes32 receiptHash;
        bytes memo;
        uint256 nonce;
        uint256 deadline;
    }

    function propose(uint256 pk, address pot, ProposeMsg memory m) internal view returns (bytes memory) {
        return signPot(
            pk,
            pot,
            keccak256(
                abi.encode(
                    keccak256(
                        "Propose(address proposer,uint8 kind,address payee,uint256 amount,uint8 category,bytes32 splitHash,bytes32 receiptHash,bytes32 memoHash,uint256 nonce,uint256 deadline)"
                    ),
                    m.proposer,
                    m.kind,
                    m.payee,
                    m.amount,
                    m.category,
                    splitHash(m.members, m.weights),
                    m.receiptHash,
                    keccak256(m.memo),
                    m.nonce,
                    m.deadline
                )
            )
        );
    }

    function splitHash(address[] memory members, uint32[] memory weights) internal pure returns (bytes32) {
        return keccak256(abi.encode(members, weights));
    }

    function vote(uint256 pk, address pot, address member, uint256 id, bool approve, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return signPot(
            pk,
            pot,
            keccak256(
                abi.encode(
                    keccak256("Vote(address member,uint256 id,bool approve,uint256 nonce,uint256 deadline)"),
                    member,
                    id,
                    approve,
                    nonce,
                    deadline
                )
            )
        );
    }

    function cancelSpend(uint256 pk, address pot, address member, uint256 id, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return signPot(
            pk,
            pot,
            keccak256(
                abi.encode(
                    keccak256("CancelSpend(address member,uint256 id,uint256 nonce,uint256 deadline)"),
                    member,
                    id,
                    nonce,
                    deadline
                )
            )
        );
    }

    function openDispute(
        uint256 pk,
        address pot,
        address member,
        uint256 spendId,
        uint8 reason,
        bytes memory memo,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        return signPot(
            pk,
            pot,
            keccak256(
                abi.encode(
                    keccak256(
                        "OpenDispute(address member,uint256 spendId,uint8 reason,bytes32 memoHash,uint256 nonce,uint256 deadline)"
                    ),
                    member,
                    spendId,
                    reason,
                    keccak256(memo),
                    nonce,
                    deadline
                )
            )
        );
    }

    function resolveDispute(
        uint256 pk,
        address pot,
        address member,
        uint256 disputeId,
        uint8 outcome,
        address[] memory members,
        uint32[] memory weights,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        return signPot(
            pk,
            pot,
            keccak256(
                abi.encode(
                    keccak256(
                        "ResolveDispute(address member,uint256 disputeId,uint8 outcome,bytes32 splitHash,uint256 nonce,uint256 deadline)"
                    ),
                    member,
                    disputeId,
                    outcome,
                    splitHash(members, weights),
                    nonce,
                    deadline
                )
            )
        );
    }

    function disputeVote(
        uint256 pk,
        address pot,
        address member,
        uint256 disputeId,
        bool spenderCovers,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        return signPot(
            pk,
            pot,
            keccak256(
                abi.encode(
                    keccak256(
                        "DisputeVote(address member,uint256 disputeId,bool spenderCovers,uint256 nonce,uint256 deadline)"
                    ),
                    member,
                    disputeId,
                    spenderCovers,
                    nonce,
                    deadline
                )
            )
        );
    }

    /// @notice For the member-only actions Freeze, UnfreezeVote, Exit and Ack.
    function memberAction(
        uint256 pk,
        address pot,
        string memory typeName,
        address member,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 typehash = keccak256(abi.encodePacked(typeName, "(address member,uint256 nonce,uint256 deadline)"));
        return signPot(pk, pot, keccak256(abi.encode(typehash, member, nonce, deadline)));
    }

    function proposeRules(
        uint256 pk,
        address pot,
        address member,
        IPlansTypes.Rules memory rules,
        address[] memory allowAdd,
        address[] memory allowRemove,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        return signPot(
            pk,
            pot,
            keccak256(
                abi.encode(
                    keccak256(
                        "ProposeRules(address member,bytes32 rulesHash,bytes32 allowlistHash,uint256 nonce,uint256 deadline)"
                    ),
                    member,
                    keccak256(abi.encode(rules)),
                    keccak256(abi.encode(allowAdd, allowRemove)),
                    nonce,
                    deadline
                )
            )
        );
    }

    function voteRules(
        uint256 pk,
        address pot,
        address member,
        uint256 id,
        bool approve,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        return signPot(
            pk,
            pot,
            keccak256(
                abi.encode(
                    keccak256("VoteRules(address member,uint256 id,bool approve,uint256 nonce,uint256 deadline)"),
                    member,
                    id,
                    approve,
                    nonce,
                    deadline
                )
            )
        );
    }

    function rotateInvite(uint256 pk, address pot, address member, address newSigner, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return signPot(
            pk,
            pot,
            keccak256(
                abi.encode(
                    keccak256("RotateInvite(address member,address newSigner,uint256 nonce,uint256 deadline)"),
                    member,
                    newSigner,
                    nonce,
                    deadline
                )
            )
        );
    }

    function postKeyWraps(
        uint256 pk,
        address pot,
        address member,
        IPlansTypes.KeyWrap[] memory wraps,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        return signPot(
            pk,
            pot,
            keccak256(
                abi.encode(
                    keccak256("PostKeyWraps(address member,bytes32 wrapsHash,uint256 nonce,uint256 deadline)"),
                    member,
                    keccak256(abi.encode(wraps)),
                    nonce,
                    deadline
                )
            )
        );
    }

    // ─────────────── Factory, Keys, Claims ───────────────

    function createPot(
        uint256 pk,
        address factory,
        address creator,
        IPlansTypes.CreatePotParams memory params,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        return sign(
            pk,
            domainSeparator("Plans Factory", factory),
            keccak256(
                abi.encode(
                    keccak256("CreatePot(address creator,bytes32 paramsHash,uint256 nonce,uint256 deadline)"),
                    creator,
                    keccak256(abi.encode(params)),
                    nonce,
                    deadline
                )
            )
        );
    }

    function registerKey(uint256 pk, address registry, address account, bytes32 pubKey, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return sign(
            pk,
            domainSeparator("Plans Keys", registry),
            keccak256(
                abi.encode(
                    keccak256("RegisterKey(address account,bytes32 pubKey,uint256 deadline)"), account, pubKey, deadline
                )
            )
        );
    }

    function claim(uint256 pk, address escrow, uint256 id, address recipient, bytes2 toCountry)
        internal
        view
        returns (bytes memory)
    {
        return sign(
            pk,
            domainSeparator("Plans Claims", escrow),
            keccak256(
                abi.encode(keccak256("Claim(uint256 id,address recipient,bytes2 toCountry)"), id, recipient, toCountry)
            )
        );
    }

    // ─────────────── AUSD: ERC-3009 and ERC-2612 ───────────────

    /// @notice A ReceiveWithAuthorization from `vm.addr(pk)` to `to`, valid now for an hour.
    function receiveAuth(uint256 pk, address token, address to, uint256 value, bytes32 nonce)
        internal
        view
        returns (IPlansTypes.Auth3009 memory auth)
    {
        auth.value = value;
        auth.validAfter = vm.getBlockTimestamp() - 1;
        auth.validBefore = vm.getBlockTimestamp() + 1 hours;
        auth.nonce = nonce;
        auth.signature = sign(
            pk,
            IAUSD(token).DOMAIN_SEPARATOR(),
            keccak256(
                abi.encode(
                    keccak256(
                        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
                    ),
                    vm.addr(pk),
                    to,
                    value,
                    auth.validAfter,
                    auth.validBefore,
                    nonce
                )
            )
        );
    }

    /// @notice An ERC-2612 permit from `vm.addr(pk)` using the token's current nonce.
    function permit(uint256 pk, address token, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (IPlansTypes.Permit2612 memory p)
    {
        address owner = vm.addr(pk);
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                IAUSD(token).DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                        owner,
                        spender,
                        value,
                        IAUSD(token).nonces(owner),
                        deadline
                    )
                )
            )
        );
        (p.v, p.r, p.s) = vm.sign(pk, digest);
        p.value = value;
        p.deadline = deadline;
    }
}
