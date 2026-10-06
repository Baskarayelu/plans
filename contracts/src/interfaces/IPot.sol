// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPlansTypes} from "./IPlansTypes.sol";

/// @notice One plan's pot. Every member action is an EIP-712 message signed by the member,
/// submitted by anyone (normally the Plans relayer). There is no admin.
///
/// EIP-712 domain: { name: "Plans Pot", version: "1", chainId, verifyingContract: pot }.
/// Nonces are unordered: each (member, nonce) pair can be used once, so a member can have
/// several actions in flight at the same time.
///
/// Type strings (all amounts uint256, all hashes keccak256 of the ABI-encoded payload):
///   Invite(address member)                                          — signed by the invite key
///   Join(address member,bytes2 country,uint256 safetyNet,uint256 nonce,uint256 deadline)
///   Propose(address proposer,uint8 kind,address payee,uint256 amount,uint8 category,bytes32 splitHash,bytes32 receiptHash,bytes32 memoHash,uint256 nonce,uint256 deadline)
///   Vote(address member,uint256 id,bool approve,uint256 nonce,uint256 deadline)
///   CancelSpend(address member,uint256 id,uint256 nonce,uint256 deadline)
///   OpenDispute(address member,uint256 spendId,uint8 reason,bytes32 memoHash,uint256 nonce,uint256 deadline)
///   ResolveDispute(address member,uint256 disputeId,uint8 outcome,bytes32 splitHash,uint256 nonce,uint256 deadline)
///   DisputeVote(address member,uint256 disputeId,bool spenderCovers,uint256 nonce,uint256 deadline)
///   Freeze(address member,uint256 nonce,uint256 deadline)
///   UnfreezeVote(address member,uint256 nonce,uint256 deadline)
///   ProposeRules(address member,bytes32 rulesHash,bytes32 allowlistHash,uint256 nonce,uint256 deadline)
///   VoteRules(address member,uint256 id,bool approve,uint256 nonce,uint256 deadline)
///   Exit(address member,uint256 nonce,uint256 deadline)
///   Ack(address member,uint256 nonce,uint256 deadline)
///   RotateInvite(address member,address newSigner,uint256 nonce,uint256 deadline)
///   PostKeyWraps(address member,bytes32 wrapsHash,uint256 nonce,uint256 deadline)
/// splitHash   = keccak256(abi.encode(split.members, split.weights))
/// rulesHash   = keccak256(abi.encode(rules))
/// allowlistHash = keccak256(abi.encode(allowAdd, allowRemove))
/// wrapsHash   = keccak256(abi.encode(wraps))
/// memoHash    = keccak256(memo)
interface IPot is IPlansTypes {
    // ───────────────────────────── events ─────────────────────────────
    event RulesSet(uint256 indexed version, Rules rules);
    event AllowlistChanged(address indexed payee, bool allowed);
    event MemberJoined(address indexed member, bytes2 country, uint256 safetyNet, uint256 memberIndex);
    event InviteRotated(address indexed by, address newSigner);
    event KeyWrapped(address indexed member, address indexed by, bytes wrap);
    event Contributed(address indexed member, uint256 amount);

    event SpendProposed(
        uint256 indexed id,
        address indexed proposer,
        SpendKind kind,
        address payee,
        uint256 amount,
        uint8 category,
        address[] splitMembers,
        uint32[] splitWeights,
        bytes32 receiptHash,
        bytes memo,
        uint8 approvalsRequired,
        uint64 expiresAt
    );
    event Voted(uint256 indexed id, address indexed member, bool approve);
    event SpendApproved(uint256 indexed id); // threshold met, not yet executable
    /// @dev `shares` is the exact per-member cost assignment (sums to amount).
    event SpendExecuted(uint256 indexed id, uint256 amount, address[] members, uint256[] shares, uint256 claimId);
    /// @dev reason: 0 withdrawn by proposer, 1 rejected, 2 expired
    event SpendCancelled(uint256 indexed id, uint8 reason);

    event DisputeOpened(uint256 indexed disputeId, uint256 indexed spendId, address indexed by, uint8 reason, bytes memo);
    event DisputeVoted(uint256 indexed disputeId, address indexed member, bool spenderCovers);
    /// @dev `members`/`shares` is the new cost assignment for the spend after resolution.
    event DisputeResolved(uint256 indexed disputeId, DisputeOutcome outcome, address[] members, uint256[] shares);

    event Frozen(address indexed by, uint64 until);
    event Unfrozen(address indexed lastVoter);

    event RuleChangeProposed(
        uint256 indexed id, address indexed proposer, Rules rules, address[] allowAdd, address[] allowRemove, uint64 expiresAt
    );
    event RuleChangeVoted(uint256 indexed id, address indexed member, bool approve);
    event RuleChangeApproved(uint256 indexed id, uint64 eta);
    event RuleChangeApplied(uint256 indexed id, uint256 rulesVersion);

    event Acked(address indexed member, uint256 ackEpoch);
    event AcksReset(uint256 newAckEpoch);
    event Pulled(address indexed member, uint256 amount); // collected through the safety-net allowance
    event Payout(address indexed member, uint256 amount); // exit, settlement or debt distribution
    event DebtRecorded(address indexed member, uint256 amount);
    event DebtPaid(address indexed member, uint256 amount);
    event MemberExited(address indexed member, int256 netAtExit, uint256 paidOut, uint256 pulledIn);
    event Settled(address indexed by, uint256 paidOut, uint256 pulledIn, uint256 unpaidClaims);
    /// @dev A LINK spend's claim expired and its money came back. Before settlement the spend's
    /// shares are reversed pro rata; after settlement the refund is distributed to positive nets.
    event EscrowRefunded(uint256 indexed spendId, uint256 amount);

    // ───────────────────────────── setup ─────────────────────────────
    function initialize(address creator, CreatePotParams calldata p) external; // factory only, once

    // ─────────────────────────── membership ───────────────────────────
    function join(
        address member,
        bytes2 country,
        uint256 nonce,
        uint256 deadline,
        bytes calldata memberSig,
        bytes calldata inviteSig,
        Auth3009 calldata deposit,
        Permit2612 calldata safetyNet,
        KeyReg calldata keyReg
    ) external;

    function contribute(address member, Auth3009 calldata auth) external;

    function rotateInvite(address member, address newSigner, uint256 nonce, uint256 deadline, bytes calldata sig) external;

    function postKeyWraps(address member, KeyWrap[] calldata wraps, uint256 nonce, uint256 deadline, bytes calldata sig)
        external;

    // ───────────────────────────── spending ─────────────────────────────
    function propose(
        address proposer,
        SpendKind kind,
        address payee,
        uint256 amount,
        uint8 category,
        Split calldata split,
        bytes32 receiptHash,
        bytes calldata memo,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig
    ) external returns (uint256 id);

    function vote(address member, uint256 id, bool approve, uint256 nonce, uint256 deadline, bytes calldata sig) external;

    function cancelSpend(address member, uint256 id, uint256 nonce, uint256 deadline, bytes calldata sig) external;

    /// @notice Executes an Approved proposal once it is executable. Anyone may call.
    function execute(uint256 id) external;

    /// @notice Marks an expired Pending/Approved proposal Cancelled. Anyone may call.
    function expire(uint256 id) external;

    // ───────────────────────────── disputes ─────────────────────────────
    function openDispute(
        address member,
        uint256 spendId,
        uint8 reason,
        bytes calldata memo,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig
    ) external returns (uint256 disputeId);

    /// @notice Proposer of the disputed spend accepts: Resplit (with `split`) or SpenderCovers.
    function resolveDispute(
        address member,
        uint256 disputeId,
        DisputeOutcome outcome,
        Split calldata split,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig
    ) external;

    function voteDispute(address member, uint256 disputeId, bool spenderCovers, uint256 nonce, uint256 deadline, bytes calldata sig)
        external;

    /// @notice Closes a dispute after its voting period, or once every eligible member voted. Anyone may call.
    function finalizeDispute(uint256 disputeId) external;

    // ─────────────────────────── safety controls ───────────────────────────
    function freeze(address member, uint256 nonce, uint256 deadline, bytes calldata sig) external;

    function voteUnfreeze(address member, uint256 nonce, uint256 deadline, bytes calldata sig) external;

    function proposeRules(
        address member,
        Rules calldata rules,
        address[] calldata allowAdd,
        address[] calldata allowRemove,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig
    ) external returns (uint256 id);

    function voteRules(address member, uint256 id, bool approve, uint256 nonce, uint256 deadline, bytes calldata sig) external;

    /// @notice Applies an approved rule change after its timelock. Anyone may call.
    function applyRules(uint256 id) external;

    // ───────────────────────────── ending ─────────────────────────────
    function exit(address member, uint256 nonce, uint256 deadline, bytes calldata sig) external;

    function ack(address member, uint256 nonce, uint256 deadline, bytes calldata sig) external;

    /// @notice One-transaction settlement. Anyone may call when allowed (see docs/protocol.md).
    function settle() external;

    /// @notice Pays some or all of a recorded debt and distributes it to members still owed.
    function payDebt(address member, Auth3009 calldata auth) external;

    /// @notice Called by ClaimEscrow when a LINK spend's claim is refunded to this pot.
    function onEscrowRefund(uint256 spendId, uint256 amount) external;

    // ───────────────────────────── views ─────────────────────────────
    /// @notice What would happen if `proposer` proposed this spend now.
    /// @return approvalsRequired total approvals incl. the proposer (1 = instant)
    /// @return ok whether it could execute once approved
    /// @return reason 0 ok; see docs/protocol.md for codes
    function previewSpend(address proposer, SpendKind kind, address payee, uint256 amount, uint8 category)
        external
        view
        returns (uint8 approvalsRequired, bool ok, uint8 reason);

    /// @notice net = contributed + personalPaid - share - withdrawn (can be negative).
    function netOf(address member) external view returns (int256);

    function isMember(address account) external view returns (bool);
    function activeMemberCount() external view returns (uint256);
    function canSettle() external view returns (bool);
    function settled() external view returns (bool);
    function usedNonce(address member, uint256 nonce) external view returns (bool);
}
