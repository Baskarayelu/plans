// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Shared types for the Plans protocol. Amounts are AUSD base units (6 decimals).
interface IPlansTypes {
    /// @dev Spend kinds.
    ///  PAY      — the pot pays `payee` (a member being reimbursed, or a business).
    ///  LINK     — the pot locks the amount in ClaimEscrow against claim key `payee`.
    ///  PERSONAL — no money moves; the proposer paid out of pocket and the cost is shared.
    enum SpendKind {
        PAY,
        LINK,
        PERSONAL
    }

    enum ProposalStatus {
        None,
        Pending, // waiting for approvals
        Approved, // threshold met but not yet executable (e.g. pot short of funds); anyone may execute()
        Executed,
        Cancelled // rejected, expired or withdrawn by proposer
    }

    enum HighTier {
        MAJORITY,
        ALL
    }

    enum PayeePolicy {
        ANYONE,
        MEMBERS_ONLY,
        MEMBERS_AND_ALLOWLIST
    }

    enum DisputeOutcome {
        None,
        Keep, // spend stands as is
        Resplit, // spender accepted a new split
        SpenderCovers // whole cost reassigned to the proposer
    }

    /// @notice A plan's rules. A zero cap or budget means "no limit".
    /// Tiers: amount <= instantMax executes with the proposer's signature alone;
    /// amount <= oneApprovalMax needs one other member; above that, highTier.
    struct Rules {
        uint64 instantMax;
        uint64 oneApprovalMax;
        HighTier highTier;
        uint64 memberDailyCap; // per UTC day, on amounts a member initiates (PAY, LINK, PERSONAL)
        uint64 memberTotalCap;
        PayeePolicy payeePolicy;
        uint64 minContribution; // if > 0, spending opens only when every active member has contributed this much
        uint32 proposalTtl; // seconds a proposal stays open
        uint32 ruleTimelock; // seconds between a rule change being approved and taking effect
        uint64[8] categoryBudgets; // category ids 0..7, see docs/protocol.md
    }

    struct CreatePotParams {
        Rules rules;
        uint64 startTime;
        uint64 endTime;
        uint32 reviewWindow; // seconds after endTime before settle() opens without unanimous acks
        address inviteSigner; // address of the key held in invite links
        bytes2 creatorCountry; // ISO 3166-1 alpha-2, e.g. "GB"
        uint256 creatorSafetyNet; // allowance the creator grants the pot via permit (0 = none)
        bytes meta; // group-key ciphertext of the plan's name, emoji, cover (<= 512 bytes)
        bytes creatorKeyWrap; // group key sealed to the creator's X25519 key
        bytes inviteKeyWrap; // group key sealed to the invite key (lets joiners read before re-wrap)
        bytes32 salt; // CREATE2 salt chosen by the creator's app
    }

    /// @notice ERC-3009 receiveWithAuthorization parameters. `value == 0` means "absent".
    struct Auth3009 {
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        bytes signature; // 65-byte r,s,v or ERC-1271 bytes
    }

    /// @notice ERC-2612 permit parameters for the settlement safety net. `value == 0` means "absent".
    struct Permit2612 {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// @notice Optional KeyRegistry registration bundled into join/create. `pubKey == 0` means "absent".
    struct KeyReg {
        bytes32 pubKey;
        uint256 deadline;
        bytes signature;
    }

    struct Split {
        address[] members;
        uint32[] weights; // shares are amount * w / sum(w); rounding remainder goes to members[0]
    }

    struct KeyWrap {
        address member;
        bytes wrap;
    }
}
