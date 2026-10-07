// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "solady/utils/EIP712.sol";
import {LibBit} from "solady/utils/LibBit.sol";
import {SafeCastLib} from "solady/utils/SafeCastLib.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {IPot} from "./interfaces/IPot.sol";
import {IAUSD, IClaimEscrow, IKeyRegistry} from "./interfaces/IPlansPeriphery.sol";
import {IFxReference} from "./interfaces/IFxReference.sol";
import {AuthLib} from "./libraries/AuthLib.sol";
import {AUSDLib} from "./libraries/AUSDLib.sol";

/// @title Pot
/// @notice One plan's shared pot: members, money, spending rules, proposals, disputes and settlement.
/// Deployed as ERC-1167 clones by `PlansFactory`; there is no admin and nothing is upgradeable.
/// Behaviour is specified in docs/protocol.md; the EIP-712 type strings are listed in {IPot}.
///
/// @dev Storage is laid out for Monad's paged storage (MIP-8): slots are priced per 128-slot page,
/// so every piece of state that ordinary actions touch (schedule, rules, counters, bitmaps and the
/// full ledger of up to 50 members) is declared before any mapping and fits in slots 0-127. One
/// cold page load (8,100 gas) then covers the whole pot, and loops over members cost 100 gas per
/// read. Members are found by scanning that page instead of an address-keyed mapping, which would
/// cost a cold page per lookup.
///
/// Member indices are positions in `_members` and never change; exited members keep their slot.
/// `_activeMask`, `_metMinMask`, `_ackedMask` and `_unfreezeMask` are bitmaps over those indices.
///
/// The pot only calls AUSD, its own ClaimEscrow and KeyRegistry, ERC-1271 signers (by
/// staticcall) and FxReference (by staticcall, at settlement), none of which can call back into
/// it, so it needs no reentrancy guard.
contract Pot is IPot, EIP712 {
    using SafeTransferLib for address;

    // ───────────────────────────── constants ─────────────────────────────

    uint256 public constant MAX_MEMBERS = 50;
    uint256 public constant MAX_DATA_BYTES = 512;
    uint256 public constant MAX_DURATION = 365 days;
    uint256 public constant DISPUTE_PERIOD = 48 hours;
    uint256 public constant FREEZE_DURATION = 24 hours;
    uint256 public constant LINK_EXPIRY = 7 days;
    /// @notice An FxReference round older than this (by its scheduled time) is not recorded at settlement.
    uint256 public constant MAX_FX_AGE = 6 hours;
    /// @dev Gas forwarded to the FxReference read in `settle`. The read is two storage loads (about
    /// 17k on Monad when cold); the cap keeps a misbehaving callee from consuming the settlement's gas.
    uint256 internal constant FX_READ_GAS = 100_000;

    /// @dev `SpendBlocked` reason codes, in the order `propose` checks them (docs/protocol.md).
    uint8 internal constant OK = 0;
    uint8 internal constant R_NOT_MEMBER = 1;
    uint8 internal constant R_NOT_OPEN = 2;
    uint8 internal constant R_FROZEN = 3;
    uint8 internal constant R_MIN_CONTRIBUTION = 4;
    uint8 internal constant R_PAYEE = 5;
    uint8 internal constant R_BUDGET = 6;
    uint8 internal constant R_DAILY_CAP = 7;
    uint8 internal constant R_TOTAL_CAP = 8;
    uint8 internal constant R_FUNDS = 9;
    uint8 internal constant R_SPLIT = 10;
    uint8 internal constant R_REQUEST = 11;

    /// @dev `SpendCancelled` reasons.
    uint8 internal constant CANCEL_WITHDRAWN = 0;
    uint8 internal constant CANCEL_REJECTED = 1;
    uint8 internal constant CANCEL_EXPIRED = 2;

    uint256 internal constant SPLIT_ENTRY_BITS = 40; // uint8 member index | uint32 weight << 8
    uint256 internal constant SPLIT_ENTRIES_PER_WORD = 6;

    bytes32 internal constant INVITE_TYPEHASH = keccak256("Invite(address member)");
    bytes32 internal constant JOIN_TYPEHASH =
        keccak256("Join(address member,bytes2 country,uint256 safetyNet,uint256 nonce,uint256 deadline)");
    bytes32 internal constant PROPOSE_TYPEHASH = keccak256(
        "Propose(address proposer,uint8 kind,address payee,uint256 amount,uint8 category,bytes32 splitHash,bytes32 receiptHash,bytes32 memoHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 internal constant VOTE_TYPEHASH =
        keccak256("Vote(address member,uint256 id,bool approve,uint256 nonce,uint256 deadline)");
    bytes32 internal constant CANCEL_SPEND_TYPEHASH =
        keccak256("CancelSpend(address member,uint256 id,uint256 nonce,uint256 deadline)");
    bytes32 internal constant OPEN_DISPUTE_TYPEHASH = keccak256(
        "OpenDispute(address member,uint256 spendId,uint8 reason,bytes32 memoHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 internal constant RESOLVE_DISPUTE_TYPEHASH = keccak256(
        "ResolveDispute(address member,uint256 disputeId,uint8 outcome,bytes32 splitHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 internal constant DISPUTE_VOTE_TYPEHASH =
        keccak256("DisputeVote(address member,uint256 disputeId,bool spenderCovers,uint256 nonce,uint256 deadline)");
    bytes32 internal constant FREEZE_TYPEHASH = keccak256("Freeze(address member,uint256 nonce,uint256 deadline)");
    bytes32 internal constant UNFREEZE_VOTE_TYPEHASH =
        keccak256("UnfreezeVote(address member,uint256 nonce,uint256 deadline)");
    bytes32 internal constant PROPOSE_RULES_TYPEHASH = keccak256(
        "ProposeRules(address member,bytes32 rulesHash,bytes32 allowlistHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 internal constant VOTE_RULES_TYPEHASH =
        keccak256("VoteRules(address member,uint256 id,bool approve,uint256 nonce,uint256 deadline)");
    bytes32 internal constant EXIT_TYPEHASH = keccak256("Exit(address member,uint256 nonce,uint256 deadline)");
    bytes32 internal constant ACK_TYPEHASH = keccak256("Ack(address member,uint256 nonce,uint256 deadline)");
    bytes32 internal constant ROTATE_INVITE_TYPEHASH =
        keccak256("RotateInvite(address member,address newSigner,uint256 nonce,uint256 deadline)");
    bytes32 internal constant POST_KEY_WRAPS_TYPEHASH =
        keccak256("PostKeyWraps(address member,bytes32 wrapsHash,uint256 nonce,uint256 deadline)");

    // ───────────────────────────── errors ─────────────────────────────

    error NotFactory();
    error NotEscrow();
    error AlreadyInitialized();
    error InvalidSchedule();
    error InvalidRules();
    error ZeroAddress();
    error DataTooLong();
    error TooManyEntries();
    error SignatureExpired();
    error NonceAlreadyUsed();
    error InvalidSignature();
    error InvalidInvite();
    error PotSettled();
    error AlreadyMember();
    error PotFull();
    error NotMember();
    error NotActiveMember();
    error PermitFailed();
    error InvalidAmount();
    error SpendBlocked(uint8 reason);
    error InvalidStatus();
    error ProposalExpired();
    error ProposalNotExpired();
    error AlreadyVoted();
    error NotProposer();
    error NothingToDispute();
    error NotInSplit();
    error DisputeAlreadyOpen();
    error InvalidDisputeReason();
    error NotEligibleVoter();
    error VotingClosed();
    error TooEarly();
    error InvalidSplit();
    error InvalidOutcome();
    error FreezeCooldown();
    error NotFrozen();
    error HasOpenItems();
    error AlreadyAcked();
    error CannotSettle();
    error DebtNotDue();
    error InvalidRefund();
    error InsufficientGas();
    error NotSettled();
    error NothingToCollect();
    error PayoutRefused();

    // ───────────────────────────── storage types ─────────────────────────────

    /// @dev Slot A of a member: identity and the whole money ledger.
    /// net = contributed + personalPaid - share - withdrawn, kept as one signed number.
    struct Member {
        address account;
        int96 net;
    }

    /// @dev Slot B of a member: counters used by spending rules and exit. Amounts saturate at
    /// uint64 max, which keeps every comparison against a uint64 rule exact.
    struct MemberState {
        uint64 contributed; // compared with Rules.minContribution
        uint64 daySpent; // spent on `day`, compared with Rules.memberDailyCap
        uint64 totalSpent; // compared with Rules.memberTotalCap
        uint16 day; // UTC day number of `daySpent`
        uint16 openItems; // Pending/Approved proposals as proposer + open disputes as opener or subject
    }

    struct Spend {
        uint96 amount; // cost assigned by the split; zero once an escrow refund reversed it
        uint8 proposer; // member index
        SpendKind kind;
        ProposalStatus status;
        uint8 category;
        uint8 approvalsRequired;
        uint8 approvals;
        uint8 splitLength;
        bool disputeOpen;
        uint40 expiresAt;
        uint56 voted; // member bitmap, proposer included
        address payee; // stored only while a PAY or LINK proposal waits for approvals
        uint256[9] split; // SPLIT_ENTRIES_PER_WORD entries per word, see _storeSplit
    }

    struct Dispute {
        uint32 spendId;
        uint8 opener; // member index
        uint8 subject; // member index of the spend's proposer
        DisputeOutcome outcome; // None while open
        uint40 openedAt;
        uint8 votesFor; // spenderCovers = true
        uint8 votesAgainst;
        uint64 voted; // member bitmap
    }

    struct RuleChange {
        ProposalStatus status;
        uint8 approvals;
        uint8 approvalsRequired;
        uint40 expiresAt;
        uint40 eta;
        uint64 voted; // member bitmap, proposer included
        Rules rules;
        address[] allowAdd;
        address[] allowRemove;
    }

    // ───────────────────────────── immutables ─────────────────────────────

    /// @notice The factory that deployed the implementation; the only caller of `initialize`.
    address public immutable factory;
    address public immutable ausd;
    IKeyRegistry public immutable keyRegistry;
    IClaimEscrow public immutable claimEscrow;
    /// @notice Reference FX rounds; read once at settlement to label it. address(0) = none.
    IFxReference public immutable fxReference;

    // ───────────── storage page 0 (slots 0-127): everything ordinary actions touch ─────────────

    mapping(address account => mapping(uint256 word => uint256 bits)) internal _nonces; // slot 0, data hashed

    uint40 public startTime;
    uint40 public endTime;
    uint32 public reviewWindow;
    uint40 public frozenUntil;
    uint8 public memberCount; // active and exited
    bool public settled;
    bool internal _initialized;
    uint16 public rulesVersion;
    uint64 internal _activeMask;

    uint64 internal _metMinMask; // members whose contribution meets Rules.minContribution
    uint64 internal _ackedMask; // members who acked in the current epoch
    uint64 internal _unfreezeMask; // members who voted to lift the current freeze
    uint32 public ackEpoch;
    uint16 internal _openProposals; // Pending + Approved spends
    uint16 internal _openDisputes;

    address public inviteSigner;
    uint32 public spendCount;
    uint32 public disputeCount;
    uint32 public ruleChangeCount;

    Rules internal _rules;
    uint64[8] internal _categorySpent;
    Member[MAX_MEMBERS] internal _members;
    MemberState[MAX_MEMBERS] internal _memberStates;
    uint40[MAX_MEMBERS] internal _lastFreezeAt;

    // ───────────── hashed storage: one page per entry ─────────────

    mapping(uint256 id => Spend) internal _spends;
    mapping(uint256 id => Dispute) internal _disputes;
    mapping(uint256 id => RuleChange) internal _ruleChanges;
    /// @notice Payees allowed under `PayeePolicy.MEMBERS_AND_ALLOWLIST` besides active members.
    mapping(address payee => bool) public isAllowedPayee;

    // ───────────────────────────── setup ─────────────────────────────

    /// @param ausd_ The AUSD token.
    /// @param keyRegistry_ The KeyRegistry used for bundled key registrations.
    /// @param claimEscrow_ The ClaimEscrow that holds LINK spends.
    /// @param fxReference_ The FxReference read at settlement (address(0) for none).
    /// @dev Deployed by the factory's constructor, so `factory = msg.sender`. The implementation
    /// itself is marked initialised and can never hold a plan.
    constructor(address ausd_, address keyRegistry_, address claimEscrow_, address fxReference_) {
        factory = msg.sender;
        ausd = ausd_;
        keyRegistry = IKeyRegistry(keyRegistry_);
        claimEscrow = IClaimEscrow(claimEscrow_);
        fxReference = IFxReference(fxReference_);
        _initialized = true;
    }

    /// @inheritdoc IPot
    /// @dev This is the creator's join: the factory has verified the creator's CreatePot signature,
    /// which covers every field of `p`, so no Join or Invite signature is needed. The factory then
    /// processes the creator's optional deposit (through `contribute`), permit and key registration
    /// in the same transaction. A `startTime` in the past is treated as now.
    function initialize(address creator, CreatePotParams calldata p) external {
        if (msg.sender != factory) revert NotFactory();
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;

        uint256 start = p.startTime < block.timestamp ? block.timestamp : p.startTime;
        if (p.endTime < start || p.endTime - start > MAX_DURATION) revert InvalidSchedule();
        if (p.inviteSigner == address(0)) revert ZeroAddress();
        if (
            p.meta.length > MAX_DATA_BYTES || p.creatorKeyWrap.length > MAX_DATA_BYTES
                || p.inviteKeyWrap.length > MAX_DATA_BYTES
        ) revert DataTooLong();
        _validateRules(p.rules);

        startTime = SafeCastLib.toUint40(start);
        endTime = SafeCastLib.toUint40(p.endTime);
        reviewWindow = p.reviewWindow;
        inviteSigner = p.inviteSigner;
        _rules = p.rules;
        emit RulesSet(0, p.rules);

        _addMember(creator, p.creatorCountry, p.creatorSafetyNet);
        if (p.creatorKeyWrap.length != 0) emit KeyWrapped(creator, creator, p.creatorKeyWrap);
    }

    // ─────────────────────────── membership ───────────────────────────

    /// @inheritdoc IPot
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
    ) external {
        _useSignature(
            member,
            keccak256(abi.encode(JOIN_TYPEHASH, member, country, safetyNet.value, nonce, deadline)),
            nonce,
            deadline,
            memberSig
        );
        bytes32 invite = _hashTypedData(keccak256(abi.encode(INVITE_TYPEHASH, member)));
        if (!AuthLib.isValidSignatureNowCalldata(inviteSigner, invite, inviteSig)) revert InvalidInvite();
        if (settled) revert PotSettled();
        (, bool found) = _indexOf(member);
        if (found) revert AlreadyMember();

        uint256 i = _addMember(member, country, safetyNet.value);
        _resetAcks();

        if (deposit.value != 0) _deposit(i, member, deposit);
        if (safetyNet.value != 0 && !AUSDLib.permitOrAllowance(ausd, member, address(this), safetyNet)) {
            revert PermitFailed();
        }
        if (keyReg.pubKey != 0 && keyRegistry.keyOf(member) != keyReg.pubKey) {
            keyRegistry.register(member, keyReg.pubKey, keyReg.deadline, keyReg.signature);
        }
    }

    /// @inheritdoc IPot
    /// @dev Anyone may submit: the ERC-3009 authorisation is the member's consent, and it names
    /// this pot as recipient.
    function contribute(address member, Auth3009 calldata auth) external {
        if (settled) revert PotSettled();
        uint256 i = _activeIndexOf(member);
        if (auth.value == 0) revert InvalidAmount();
        _deposit(i, member, auth);
    }

    /// @inheritdoc IPot
    function rotateInvite(address member, address newSigner, uint256 nonce, uint256 deadline, bytes calldata sig)
        external
    {
        _useSignature(
            member,
            keccak256(abi.encode(ROTATE_INVITE_TYPEHASH, member, newSigner, nonce, deadline)),
            nonce,
            deadline,
            sig
        );
        _activeIndexOf(member);
        if (newSigner == address(0)) revert ZeroAddress();
        inviteSigner = newSigner;
        emit InviteRotated(member, newSigner);
    }

    /// @inheritdoc IPot
    function postKeyWraps(address member, KeyWrap[] calldata wraps, uint256 nonce, uint256 deadline, bytes calldata sig)
        external
    {
        _useSignature(
            member,
            keccak256(abi.encode(POST_KEY_WRAPS_TYPEHASH, member, keccak256(abi.encode(wraps)), nonce, deadline)),
            nonce,
            deadline,
            sig
        );
        _activeIndexOf(member);
        if (wraps.length > MAX_MEMBERS) revert TooManyEntries();
        for (uint256 k; k < wraps.length; ++k) {
            if (wraps[k].wrap.length > MAX_DATA_BYTES) revert DataTooLong();
            emit KeyWrapped(wraps[k].member, member, wraps[k].wrap);
        }
    }

    // ───────────────────────────── spending ─────────────────────────────

    /// @inheritdoc IPot
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
    ) external returns (uint256 id) {
        if (memo.length > MAX_DATA_BYTES) revert DataTooLong();
        _useSignature(
            proposer,
            _proposeStructHash(proposer, kind, payee, amount, category, split, receiptHash, memo, nonce, deadline),
            nonce,
            deadline,
            sig
        );

        (uint256 p, bool found) = _indexOf(proposer);
        uint8 reason = _spendCheck(found && _isActive(p), p, kind, payee, amount, category);
        (uint256[] memory idx, uint256[] memory w, bool splitOk) = _readSplit(split);
        if (reason == OK && !splitOk) reason = R_SPLIT;
        if (reason == OK) reason = _requestCheck(kind, payee, amount, category);
        if (reason != OK) revert SpendBlocked(reason);

        id = ++spendCount;
        uint8 required = _approvalsRequired(amount);
        uint40 expiresAt = uint40(block.timestamp + _rules.proposalTtl);
        Spend storage s = _spends[id];
        s.amount = uint96(amount);
        s.proposer = uint8(p);
        s.kind = kind;
        s.category = category;
        s.approvalsRequired = required;
        s.approvals = 1;
        s.expiresAt = expiresAt;
        s.voted = uint56(1 << p);
        _storeSplit(s, idx, w);

        emit SpendProposed(
            id,
            proposer,
            kind,
            payee,
            amount,
            category,
            split.members,
            split.weights,
            receiptHash,
            memo,
            required,
            expiresAt
        );

        if (required <= 1) {
            _execute(id, s, payee, idx, w);
        } else {
            s.status = ProposalStatus.Pending;
            if (kind != SpendKind.PERSONAL) s.payee = payee;
            ++_memberStates[p].openItems;
            ++_openProposals;
        }
    }

    /// @inheritdoc IPot
    function vote(address member, uint256 id, bool approve, uint256 nonce, uint256 deadline, bytes calldata sig)
        external
    {
        _useSignature(
            member, keccak256(abi.encode(VOTE_TYPEHASH, member, id, approve, nonce, deadline)), nonce, deadline, sig
        );
        uint256 i = _activeIndexOf(member);
        Spend storage s = _spends[id];
        if (s.status != ProposalStatus.Pending) revert InvalidStatus();
        if (block.timestamp > s.expiresAt) revert ProposalExpired();
        uint56 voted = s.voted;
        if (voted & (1 << i) != 0) revert AlreadyVoted();
        voted |= uint56(1 << i);
        s.voted = voted;
        emit Voted(id, member, approve);

        if (approve) {
            uint8 approvals = s.approvals + 1;
            s.approvals = approvals;
            if (approvals >= s.approvalsRequired) _onThresholdMet(id, s);
        } else if (s.approvals + LibBit.popCount(_activeMask & ~uint256(voted)) < s.approvalsRequired) {
            _cancel(id, s, CANCEL_REJECTED);
        }
    }

    /// @inheritdoc IPot
    function cancelSpend(address member, uint256 id, uint256 nonce, uint256 deadline, bytes calldata sig) external {
        _useSignature(
            member, keccak256(abi.encode(CANCEL_SPEND_TYPEHASH, member, id, nonce, deadline)), nonce, deadline, sig
        );
        Spend storage s = _spends[id];
        if (!_isOpen(s.status)) revert InvalidStatus();
        if (_members[s.proposer].account != member) revert NotProposer();
        _cancel(id, s, CANCEL_WITHDRAWN);
    }

    /// @inheritdoc IPot
    function execute(uint256 id) external {
        Spend storage s = _spends[id];
        if (s.status != ProposalStatus.Approved) revert InvalidStatus();
        if (block.timestamp > s.expiresAt) revert ProposalExpired();
        (uint256[] memory idx, uint256[] memory w,) = _loadSplit(s);
        uint8 reason = _executionCheck(s, idx);
        if (reason != OK) revert SpendBlocked(reason);
        _closeProposal(s.proposer);
        _execute(id, s, s.payee, idx, w);
    }

    /// @inheritdoc IPot
    function expire(uint256 id) external {
        Spend storage s = _spends[id];
        if (!_isOpen(s.status)) revert InvalidStatus();
        if (block.timestamp <= s.expiresAt) revert ProposalNotExpired();
        _cancel(id, s, CANCEL_EXPIRED);
    }

    // ───────────────────────────── disputes ─────────────────────────────

    /// @inheritdoc IPot
    function openDispute(
        address member,
        uint256 spendId,
        uint8 reason,
        bytes calldata memo,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig
    ) external returns (uint256 disputeId) {
        if (memo.length > MAX_DATA_BYTES) revert DataTooLong();
        _useSignature(
            member,
            keccak256(abi.encode(OPEN_DISPUTE_TYPEHASH, member, spendId, reason, keccak256(memo), nonce, deadline)),
            nonce,
            deadline,
            sig
        );
        if (settled) revert PotSettled();
        uint256 i = _activeIndexOf(member);
        if (reason > 2) revert InvalidDisputeReason();
        Spend storage s = _spends[spendId];
        if (s.status != ProposalStatus.Executed || s.amount == 0) revert NothingToDispute();
        if (s.disputeOpen) revert DisputeAlreadyOpen();
        (,, uint256 splitMask) = _loadSplit(s);
        if (splitMask & (1 << i) == 0) revert NotInSplit();

        disputeId = ++disputeCount;
        uint8 subject = s.proposer;
        _disputes[disputeId] = Dispute({
            spendId: uint32(spendId),
            opener: uint8(i),
            subject: subject,
            outcome: DisputeOutcome.None,
            openedAt: uint40(block.timestamp),
            votesFor: 0,
            votesAgainst: 0,
            voted: 0
        });
        s.disputeOpen = true;
        ++_memberStates[i].openItems;
        ++_memberStates[subject].openItems;
        ++_openDisputes;
        emit DisputeOpened(disputeId, spendId, member, reason, memo);
        _resetAcks();
    }

    /// @inheritdoc IPot
    function resolveDispute(
        address member,
        uint256 disputeId,
        DisputeOutcome outcome,
        Split calldata split,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig
    ) external {
        _useSignature(
            member,
            keccak256(
                abi.encode(
                    RESOLVE_DISPUTE_TYPEHASH,
                    member,
                    disputeId,
                    outcome,
                    keccak256(abi.encode(split.members, split.weights)),
                    nonce,
                    deadline
                )
            ),
            nonce,
            deadline,
            sig
        );
        Dispute storage d = _openDisputeOf(disputeId);
        if (_members[d.subject].account != member) revert NotProposer();
        if (outcome == DisputeOutcome.Resplit) {
            (uint256[] memory idx, uint256[] memory w, bool ok) = _readSplit(split);
            if (!ok) revert InvalidSplit();
            _resolve(disputeId, d, outcome, idx, w);
        } else if (outcome == DisputeOutcome.SpenderCovers) {
            _resolveSpenderCovers(disputeId, d);
        } else {
            revert InvalidOutcome();
        }
    }

    /// @inheritdoc IPot
    function voteDispute(
        address member,
        uint256 disputeId,
        bool spenderCovers,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig
    ) external {
        _useSignature(
            member,
            keccak256(abi.encode(DISPUTE_VOTE_TYPEHASH, member, disputeId, spenderCovers, nonce, deadline)),
            nonce,
            deadline,
            sig
        );
        uint256 i = _activeIndexOf(member);
        Dispute storage d = _openDisputeOf(disputeId);
        if (block.timestamp >= d.openedAt + DISPUTE_PERIOD) revert VotingClosed();
        if (i == d.opener || i == d.subject) revert NotEligibleVoter();
        if (d.voted & (1 << i) != 0) revert AlreadyVoted();
        d.voted |= uint64(1 << i);
        if (spenderCovers) ++d.votesFor;
        else ++d.votesAgainst;
        emit DisputeVoted(disputeId, member, spenderCovers);
    }

    /// @inheritdoc IPot
    function finalizeDispute(uint256 disputeId) external {
        Dispute storage d = _openDisputeOf(disputeId);
        uint256 eligible = _activeMask & ~((1 << d.opener) | (1 << d.subject));
        bool allVoted = eligible != 0 && eligible & ~uint256(d.voted) == 0;
        if (block.timestamp < d.openedAt + DISPUTE_PERIOD && !allVoted) revert TooEarly();
        uint256 votesFor = d.votesFor;
        if (votesFor * 2 > votesFor + d.votesAgainst) {
            _resolveSpenderCovers(disputeId, d);
        } else {
            (uint256[] memory idx, uint256[] memory w,) = _loadSplit(_spends[d.spendId]);
            _resolve(disputeId, d, DisputeOutcome.Keep, idx, w);
        }
    }

    // ─────────────────────────── safety controls ───────────────────────────

    /// @inheritdoc IPot
    function freeze(address member, uint256 nonce, uint256 deadline, bytes calldata sig) external {
        _useSignature(member, keccak256(abi.encode(FREEZE_TYPEHASH, member, nonce, deadline)), nonce, deadline, sig);
        if (settled) revert PotSettled();
        uint256 i = _activeIndexOf(member);
        uint256 last = _lastFreezeAt[i];
        if (last != 0 && block.timestamp < last + FREEZE_DURATION) revert FreezeCooldown();
        _lastFreezeAt[i] = uint40(block.timestamp);

        uint256 until = frozenUntil;
        if (block.timestamp >= until) _unfreezeMask = 0; // a new freeze starts a new unfreeze vote
        if (block.timestamp + FREEZE_DURATION > until) until = block.timestamp + FREEZE_DURATION;
        frozenUntil = uint40(until);
        emit Frozen(member, uint64(until));
    }

    /// @inheritdoc IPot
    function voteUnfreeze(address member, uint256 nonce, uint256 deadline, bytes calldata sig) external {
        _useSignature(
            member, keccak256(abi.encode(UNFREEZE_VOTE_TYPEHASH, member, nonce, deadline)), nonce, deadline, sig
        );
        uint256 i = _activeIndexOf(member);
        if (block.timestamp >= frozenUntil) revert NotFrozen();
        uint64 votes = _unfreezeMask;
        if (votes & (1 << i) != 0) revert AlreadyVoted();
        votes |= uint64(1 << i);
        _unfreezeMask = votes;
        if (LibBit.popCount(votes & _activeMask) >= _majority()) {
            frozenUntil = uint40(block.timestamp);
            emit Unfrozen(member);
        }
    }

    /// @inheritdoc IPot
    function proposeRules(
        address member,
        Rules calldata rules,
        address[] calldata allowAdd,
        address[] calldata allowRemove,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig
    ) external returns (uint256 id) {
        _useSignature(
            member,
            keccak256(
                abi.encode(
                    PROPOSE_RULES_TYPEHASH,
                    member,
                    keccak256(abi.encode(rules)),
                    keccak256(abi.encode(allowAdd, allowRemove)),
                    nonce,
                    deadline
                )
            ),
            nonce,
            deadline,
            sig
        );
        if (settled) revert PotSettled();
        uint256 i = _activeIndexOf(member);
        _validateRules(rules);
        if (allowAdd.length > MAX_MEMBERS || allowRemove.length > MAX_MEMBERS) revert TooManyEntries();

        id = ++ruleChangeCount;
        RuleChange storage rc = _ruleChanges[id];
        uint40 expiresAt = uint40(block.timestamp + _rules.proposalTtl);
        rc.status = ProposalStatus.Pending;
        rc.approvals = 1;
        rc.approvalsRequired = uint8(_majority());
        rc.expiresAt = expiresAt;
        rc.voted = uint64(1 << i);
        rc.rules = rules;
        rc.allowAdd = allowAdd;
        rc.allowRemove = allowRemove;
        emit RuleChangeProposed(id, member, rules, allowAdd, allowRemove, expiresAt);
        if (rc.approvalsRequired <= 1) _approveRuleChange(id, rc);
    }

    /// @inheritdoc IPot
    function voteRules(address member, uint256 id, bool approve, uint256 nonce, uint256 deadline, bytes calldata sig)
        external
    {
        _useSignature(
            member,
            keccak256(abi.encode(VOTE_RULES_TYPEHASH, member, id, approve, nonce, deadline)),
            nonce,
            deadline,
            sig
        );
        uint256 i = _activeIndexOf(member);
        RuleChange storage rc = _ruleChanges[id];
        if (rc.status != ProposalStatus.Pending) revert InvalidStatus();
        if (block.timestamp > rc.expiresAt) revert ProposalExpired();
        if (rc.voted & (1 << i) != 0) revert AlreadyVoted();
        rc.voted |= uint64(1 << i);
        emit RuleChangeVoted(id, member, approve);
        if (approve && ++rc.approvals >= rc.approvalsRequired) _approveRuleChange(id, rc);
    }

    /// @inheritdoc IPot
    /// @dev Removals are applied before additions, so an address in both lists ends up allowed.
    function applyRules(uint256 id) external {
        if (settled) revert PotSettled();
        RuleChange storage rc = _ruleChanges[id];
        if (rc.status != ProposalStatus.Approved) revert InvalidStatus();
        if (block.timestamp < rc.eta) revert TooEarly();
        rc.status = ProposalStatus.Executed;

        _rules = rc.rules;
        address[] storage list = rc.allowRemove;
        for (uint256 k; k < list.length; ++k) {
            isAllowedPayee[list[k]] = false;
            emit AllowlistChanged(list[k], false);
        }
        list = rc.allowAdd;
        for (uint256 k; k < list.length; ++k) {
            isAllowedPayee[list[k]] = true;
            emit AllowlistChanged(list[k], true);
        }

        uint256 minContribution = rc.rules.minContribution;
        uint256 n = memberCount;
        uint64 metMin;
        for (uint256 j; j < n; ++j) {
            if (_memberStates[j].contributed >= minContribution) metMin |= uint64(1 << j);
        }
        _metMinMask = metMin;

        uint16 version = ++rulesVersion;
        emit RulesSet(version, rc.rules);
        emit RuleChangeApplied(id, version);
        _resetAcks();
    }

    // ───────────────────────────── ending ─────────────────────────────

    /// @inheritdoc IPot
    function exit(address member, uint256 nonce, uint256 deadline, bytes calldata sig) external {
        _useSignature(member, keccak256(abi.encode(EXIT_TYPEHASH, member, nonce, deadline)), nonce, deadline, sig);
        if (settled) revert PotSettled();
        uint256 i = _activeIndexOf(member);
        if (_memberStates[i].openItems != 0) revert HasOpenItems();
        _activeMask &= ~uint64(1 << i);

        int256 netAtExit = _members[i].net;
        uint256 paidOut;
        uint256 pulledIn;
        if (netAtExit > 0) {
            paidOut = _min(uint256(netAtExit), ausd.balanceOf(address(this)));
            if (paidOut != 0) {
                _members[i].net -= SafeCastLib.toInt96(paidOut);
                ausd.safeTransfer(member, paidOut);
                emit Payout(member, paidOut);
            }
        } else if (netAtExit < 0) {
            pulledIn = _pull(i, member, uint256(-netAtExit));
            uint256 debt = uint256(-netAtExit) - pulledIn;
            if (debt != 0) emit DebtRecorded(member, debt);
        }
        emit MemberExited(member, netAtExit, paidOut, pulledIn);
        _resetAcks();
    }

    /// @inheritdoc IPot
    function ack(address member, uint256 nonce, uint256 deadline, bytes calldata sig) external {
        _useSignature(member, keccak256(abi.encode(ACK_TYPEHASH, member, nonce, deadline)), nonce, deadline, sig);
        if (settled) revert PotSettled();
        uint256 i = _activeIndexOf(member);
        if (_ackedMask & (1 << i) != 0) revert AlreadyAcked();
        _ackedMask |= uint64(1 << i);
        emit Acked(member, ackEpoch);
    }

    /// @inheritdoc IPot
    function settle() external {
        if (!canSettle()) revert CannotSettle();
        settled = true;
        uint256 n = memberCount;

        // 1. Collect what debtors owe through their safety-net allowances.
        uint256 pulledIn;
        for (uint256 i; i < n; ++i) {
            int256 net = _members[i].net;
            if (net < 0) pulledIn += _pull(i, _members[i].account, uint256(-net));
        }

        // 2-4. Pay creditors in full, or pro rata when the pot is short.
        uint256 credit;
        for (uint256 i; i < n; ++i) {
            int256 net = _members[i].net;
            if (net > 0) credit += uint256(net);
        }
        uint256 balance = ausd.balanceOf(address(this));
        uint256 paidOut;
        for (uint256 i; i < n; ++i) {
            int256 net = _members[i].net;
            if (net <= 0) continue;
            uint256 amount = balance >= credit ? uint256(net) : uint256(net) * balance / credit;
            if (amount != 0 && _tryPay(i, amount)) paidOut += amount;
        }

        // Whatever is left are unpaid claims and unpaid debts.
        uint256 unpaidClaims;
        for (uint256 i; i < n; ++i) {
            int256 net = _members[i].net;
            if (net > 0) unpaidClaims += uint256(net);
            else if (net < 0) emit DebtRecorded(_members[i].account, uint256(-net));
        }
        emit Settled(msg.sender, paidOut, pulledIn, unpaidClaims, _freshFxRound());
    }

    /// @inheritdoc IPot
    /// @dev Closes the gap where a payout skipped at settlement (or in a later distribution), for
    /// example because AUSD refused the recipient at that moment, had no way out of a settled pot.
    /// Only `member` is paid and only `member`'s net changes, so no other member can block it or be
    /// affected by it. The amount is the member's pro-rata share of what the pot holds now, which is
    /// the full net when the pot covers every positive net. A transfer AUSD refuses reverts
    /// (`PayoutRefused`) and leaves the claim in place; a transfer starved of gas reverts
    /// `InsufficientGas` (see `_revertIfOutOfGas`), so either the member is paid or nothing changes.
    function collect(address member) external {
        if (!settled) revert NotSettled();
        (uint256 i, bool found) = _indexOf(member);
        if (!found) revert NotMember();
        int256 net = _members[i].net;
        if (net <= 0) revert NothingToCollect();
        uint256 credit;
        uint256 n = memberCount;
        for (uint256 k; k < n; ++k) {
            int256 c = _members[k].net;
            if (c > 0) credit += uint256(c);
        }
        uint256 balance = ausd.balanceOf(address(this));
        uint256 amount = balance >= credit ? uint256(net) : uint256(net) * balance / credit;
        if (amount == 0) revert NothingToCollect();
        if (!_tryPay(i, amount)) revert PayoutRefused();
        emit Collected(member, msg.sender, amount);
    }

    /// @inheritdoc IPot
    /// @dev Open to members with a negative net once the pot is settled, and to exited members
    /// before that (active members contribute instead). Before settlement the payment stays in the
    /// pot and is paid out by `settle`.
    function payDebt(address member, Auth3009 calldata auth) external {
        (uint256 i, bool found) = _indexOf(member);
        if (!found) revert NotMember();
        bool isSettled = settled;
        if (!isSettled && _isActive(i)) revert DebtNotDue();
        int256 net = _members[i].net;
        if (auth.value == 0 || net >= 0 || auth.value > uint256(-net)) revert InvalidAmount();

        AUSDLib.receiveFrom(ausd, member, auth);
        _credit(i, auth.value);
        emit DebtPaid(member, auth.value);
        if (isSettled) _distribute(auth.value);
    }

    /// @inheritdoc IPot
    /// @dev ClaimEscrow has already transferred `amount` back to this pot. Claims are all or
    /// nothing, so `amount` must be the spend's full amount; the spend's current shares are then
    /// reversed exactly and its amount drops to zero. Before settlement this changes the summary
    /// members acked, so acks are reset; after settlement the refund is paid out at once.
    function onEscrowRefund(uint256 spendId, uint256 amount) external {
        if (msg.sender != address(claimEscrow)) revert NotEscrow();
        Spend storage s = _spends[spendId];
        if (s.kind != SpendKind.LINK || s.status != ProposalStatus.Executed || amount == 0 || amount != s.amount) {
            revert InvalidRefund();
        }
        (uint256[] memory idx, uint256[] memory w,) = _loadSplit(s);
        _applyShares(idx, _parts(amount, w), true);
        s.amount = 0;
        emit EscrowRefunded(spendId, amount);
        if (settled) _distribute(amount);
        else _resetAcks();
    }

    // ───────────────────────────── views ─────────────────────────────

    /// @inheritdoc IPot
    function previewSpend(address proposer, SpendKind kind, address payee, uint256 amount, uint8 category)
        external
        view
        returns (uint8 approvalsRequired, bool ok, uint8 reason)
    {
        (uint256 p, bool found) = _indexOf(proposer);
        approvalsRequired = _approvalsRequired(amount);
        reason = _spendCheck(found && _isActive(p), p, kind, payee, amount, category);
        if (reason == OK) reason = _requestCheck(kind, payee, amount, category);
        ok = reason == OK;
    }

    /// @inheritdoc IPot
    function netOf(address member) external view returns (int256) {
        (uint256 i, bool found) = _indexOf(member);
        return found ? int256(_members[i].net) : int256(0);
    }

    /// @inheritdoc IPot
    /// @dev True for active members only; exited members return false.
    function isMember(address account) external view returns (bool) {
        (uint256 i, bool found) = _indexOf(account);
        return found && _isActive(i);
    }

    /// @inheritdoc IPot
    function activeMemberCount() public view returns (uint256) {
        return LibBit.popCount(_activeMask);
    }

    /// @inheritdoc IPot
    function canSettle() public view returns (bool) {
        if (settled || _openProposals != 0 || _openDisputes != 0) return false;
        return block.timestamp >= uint256(endTime) + reviewWindow || _activeMask & ~_ackedMask == 0;
    }

    /// @inheritdoc IPot
    function usedNonce(address member, uint256 nonce) external view returns (bool) {
        return AuthLib.isNonceUsed(_nonces, member, nonce);
    }

    /// @notice The current rules.
    function getRules() external view returns (Rules memory) {
        return _rules;
    }

    /// @notice Every member ever admitted, in index order (exited members included).
    function members() external view returns (address[] memory accounts) {
        uint256 n = memberCount;
        accounts = new address[](n);
        for (uint256 i; i < n; ++i) {
            accounts[i] = _members[i].account;
        }
    }

    /// @notice Total executed spending per category id (saturating at uint64 max).
    function categorySpent(uint8 category) external view returns (uint256) {
        return _categorySpent[category];
    }

    /// @notice A spend proposal's state.
    function spendInfo(uint256 id)
        external
        view
        returns (
            ProposalStatus status,
            SpendKind kind,
            address proposer,
            uint256 amount,
            uint8 approvals,
            uint8 approvalsRequired,
            uint64 expiresAt,
            bool disputeOpen
        )
    {
        Spend storage s = _spends[id];
        status = s.status;
        kind = s.kind;
        proposer = status == ProposalStatus.None ? address(0) : _members[s.proposer].account;
        amount = s.amount;
        approvals = s.approvals;
        approvalsRequired = s.approvalsRequired;
        expiresAt = s.expiresAt;
        disputeOpen = s.disputeOpen;
    }

    /// @notice A dispute's state. `outcome == None` while it is open.
    function disputeInfo(uint256 id)
        external
        view
        returns (uint256 spendId, DisputeOutcome outcome, uint64 openedAt, uint8 votesFor, uint8 votesAgainst)
    {
        Dispute storage d = _disputes[id];
        return (d.spendId, d.outcome, d.openedAt, d.votesFor, d.votesAgainst);
    }

    /// @notice A rule change's state.
    function ruleChangeInfo(uint256 id)
        external
        view
        returns (ProposalStatus status, uint8 approvals, uint8 approvalsRequired, uint64 expiresAt, uint64 eta)
    {
        RuleChange storage rc = _ruleChanges[id];
        return (rc.status, rc.approvals, rc.approvalsRequired, rc.expiresAt, rc.eta);
    }

    // ───────────────────────────── internal: auth ─────────────────────────────

    function _domainNameAndVersion() internal pure override returns (string memory, string memory) {
        return ("Plans Pot", "1");
    }

    /// @dev Checks the deadline, consumes the unordered nonce and verifies the EIP-712 signature.
    function _useSignature(address signer, bytes32 structHash, uint256 nonce, uint256 deadline, bytes calldata sig)
        internal
    {
        if (block.timestamp > deadline) revert SignatureExpired();
        if (!AuthLib.useNonce(_nonces, signer, nonce)) revert NonceAlreadyUsed();
        if (!AuthLib.isValidSignatureNowCalldata(signer, _hashTypedData(structHash), sig)) revert InvalidSignature();
    }

    function _proposeStructHash(
        address proposer,
        SpendKind kind,
        address payee,
        uint256 amount,
        uint8 category,
        Split calldata split,
        bytes32 receiptHash,
        bytes calldata memo,
        uint256 nonce,
        uint256 deadline
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PROPOSE_TYPEHASH,
                proposer,
                kind,
                payee,
                amount,
                category,
                keccak256(abi.encode(split.members, split.weights)),
                receiptHash,
                keccak256(memo),
                nonce,
                deadline
            )
        );
    }

    // ───────────────────────────── internal: members ─────────────────────────────

    /// @dev Linear scan of the member page. At most 50 warm reads, cheaper on Monad than one cold
    /// page for an address-keyed mapping.
    function _indexOf(address account) internal view returns (uint256 i, bool found) {
        uint256 n = memberCount;
        for (; i < n; ++i) {
            if (_members[i].account == account) return (i, true);
        }
    }

    function _activeIndexOf(address account) internal view returns (uint256 i) {
        bool found;
        (i, found) = _indexOf(account);
        if (!found || !_isActive(i)) revert NotActiveMember();
    }

    function _isActive(uint256 i) internal view returns (bool) {
        return _activeMask & (1 << i) != 0;
    }

    /// @dev floor(active / 2) + 1.
    function _majority() internal view returns (uint256) {
        return LibBit.popCount(_activeMask) / 2 + 1;
    }

    /// @dev Member slots are never reused, so the total number of members ever admitted (active
    /// and exited) is capped at MAX_MEMBERS. That bounds every loop in this contract.
    function _addMember(address account, bytes2 country, uint256 safetyNet) internal returns (uint256 i) {
        i = memberCount;
        if (i == MAX_MEMBERS) revert PotFull();
        memberCount = uint8(i + 1);
        _members[i].account = account;
        _activeMask |= uint64(1 << i);
        if (_rules.minContribution == 0) _metMinMask |= uint64(1 << i);
        emit MemberJoined(account, country, safetyNet, i);
    }

    function _deposit(uint256 i, address member, Auth3009 calldata auth) internal {
        AUSDLib.receiveFrom(ausd, member, auth);
        _credit(i, auth.value);
        emit Contributed(member, auth.value);
    }

    /// @dev Money in from member `i`: net and contributed go up.
    function _credit(uint256 i, uint256 amount) internal {
        _members[i].net += SafeCastLib.toInt96(amount);
        MemberState storage st = _memberStates[i];
        uint64 contributed = _sat64(uint256(st.contributed) + amount);
        st.contributed = contributed;
        if (contributed >= _rules.minContribution) _metMinMask |= uint64(1 << i);
    }

    /// @dev Pulls up to `want` from `account` through its safety-net allowance. A refused pull returns 0;
    /// only a pull starved of gas reverts (see `_revertIfOutOfGas`).
    function _pull(uint256 i, address account, uint256 want) internal returns (uint256 amount) {
        amount = _min(want, _min(IAUSD(ausd).allowance(account, address(this)), ausd.balanceOf(account)));
        if (amount == 0) return 0;
        uint256 gasBefore = gasleft();
        try IAUSD(ausd).transferFrom(account, address(this), amount) returns (bool ok) {
            if (!ok) return 0;
        } catch {
            _revertIfOutOfGas(gasBefore);
            return 0;
        }
        _credit(i, amount);
        emit Pulled(account, amount);
    }

    /// @dev Pays `amount` to member `i`. A failed transfer (for example a recipient AUSD refuses)
    /// leaves the amount as the member's claim instead of blocking everyone else's payout.
    function _tryPay(uint256 i, uint256 amount) internal returns (bool ok) {
        address account = _members[i].account;
        uint256 gasBefore = gasleft();
        try IAUSD(ausd).transfer(account, amount) returns (bool success) {
            ok = success;
        } catch {
            _revertIfOutOfGas(gasBefore);
        }
        if (ok) {
            _members[i].net -= SafeCastLib.toInt96(amount);
            emit Payout(account, amount);
        }
    }

    /// @dev Called when a try/catch-wrapped AUSD call has failed. A call that ran out of gas
    /// leaves at most 1/64 of the gas it started with (EIP-150), while a call that reverted for a
    /// reason of its own (a refused or frozen account) leaves far more. Treating the first case as
    /// a refusal would let whoever submits the transaction pick a gas limit that skips one member's
    /// payout or pull while the rest of the call succeeds, so it reverts the whole call instead.
    function _revertIfOutOfGas(uint256 gasBefore) internal view {
        if (gasleft() <= gasBefore / 63) revert InsufficientGas();
    }

    /// @dev The latest FxReference round if it is at most MAX_FX_AGE old, else 0. Never reverts
    /// because of FxReference: a missing contract, a failed read or malformed return data all give
    /// 0. Only a read starved of gas by the submitter's gas limit reverts (`InsufficientGas`), like
    /// the payouts, so the recorded round cannot be suppressed by picking a gas limit.
    function _freshFxRound() internal view returns (uint64) {
        address fx = address(fxReference);
        if (fx == address(0)) return 0;
        bytes4 selector = IFxReference.latestRoundTime.selector;
        uint256 gasBefore = gasleft();
        bool ok;
        uint256 roundId;
        uint256 scheduledTime;
        assembly ("memory-safe") {
            let m := mload(0x40)
            mstore(m, selector)
            ok := staticcall(FX_READ_GAS, fx, m, 4, m, 0x40)
            if lt(returndatasize(), 0x40) { ok := 0 }
            roundId := mload(m)
            scheduledTime := mload(add(m, 0x20))
        }
        if (!ok) {
            _revertIfOutOfGas(gasBefore);
            return 0;
        }
        if (roundId == 0 || roundId > type(uint64).max || scheduledTime == 0 || scheduledTime > type(uint64).max) {
            return 0;
        }
        if (block.timestamp > scheduledTime + MAX_FX_AGE) return 0;
        return uint64(roundId);
    }

    /// @dev Pays `amount` out pro rata to members with a positive net (floored).
    function _distribute(uint256 amount) internal {
        uint256 n = memberCount;
        uint256 credit;
        for (uint256 i; i < n; ++i) {
            int256 net = _members[i].net;
            if (net > 0) credit += uint256(net);
        }
        if (credit == 0) return;
        for (uint256 i; i < n; ++i) {
            int256 net = _members[i].net;
            if (net <= 0) continue;
            uint256 part = amount * uint256(net) / credit;
            if (part != 0) _tryPay(i, part);
        }
    }

    function _resetAcks() internal {
        uint32 epoch = ++ackEpoch;
        _ackedMask = 0;
        emit AcksReset(epoch);
    }

    // ───────────────────────────── internal: rules ─────────────────────────────

    function _validateRules(Rules calldata r) internal pure {
        if (r.proposalTtl == 0) revert InvalidRules();
    }

    function _approvalsRequired(uint256 amount) internal view returns (uint8) {
        uint256 active = LibBit.popCount(_activeMask);
        Rules storage r = _rules;
        uint256 required;
        if (amount <= r.instantMax) required = 1;
        else if (amount <= r.oneApprovalMax) required = 2;
        else if (r.highTier == HighTier.ALL) required = active;
        else required = active / 2 + 1;
        return uint8(_min(required, active));
    }

    /// @dev Checks 1-9 of docs/protocol.md for proposer index `p` (meaningful only if `active`).
    function _spendCheck(bool active, uint256 p, SpendKind kind, address payee, uint256 amount, uint256 category)
        internal
        view
        returns (uint8)
    {
        if (!active) return R_NOT_MEMBER;
        if (block.timestamp < startTime || block.timestamp > endTime || settled) return R_NOT_OPEN;
        if (block.timestamp < frozenUntil) return R_FROZEN;
        Rules storage r = _rules;
        if (r.minContribution != 0 && _activeMask & ~_metMinMask != 0) return R_MIN_CONTRIBUTION;
        if (kind == SpendKind.PAY && !_payeeAllowed(payee, r.payeePolicy)) return R_PAYEE;
        if (category < 8) {
            uint256 budget = r.categoryBudgets[category];
            if (budget != 0 && _exceeds(_categorySpent[category], amount, budget)) return R_BUDGET;
        }
        MemberState storage st = _memberStates[p];
        uint256 cap = r.memberDailyCap;
        if (cap != 0 && _exceeds(st.day == _today() ? st.daySpent : 0, amount, cap)) return R_DAILY_CAP;
        cap = r.memberTotalCap;
        if (cap != 0 && _exceeds(st.totalSpent, amount, cap)) return R_TOTAL_CAP;
        if (kind != SpendKind.PERSONAL && amount > ausd.balanceOf(address(this))) return R_FUNDS;
        return OK;
    }

    /// @dev Check 11: the request itself is malformed. Amounts must fit the 96-bit ledger, and a
    /// spend that moves money (PAY, LINK) needs a nonzero payee.
    function _requestCheck(SpendKind kind, address payee, uint256 amount, uint256 category)
        internal
        pure
        returns (uint8)
    {
        if (amount == 0 || amount > type(uint96).max || category > 7) return R_REQUEST;
        if (kind != SpendKind.PERSONAL && payee == address(0)) return R_REQUEST;
        return OK;
    }

    /// @dev Re-runs the spending checks against the current state before a pending spend executes.
    function _executionCheck(Spend storage s, uint256[] memory idx) internal view returns (uint8 reason) {
        uint256 p = s.proposer;
        reason = _spendCheck(_isActive(p), p, s.kind, s.payee, s.amount, s.category);
        if (reason == OK) {
            uint256 mask;
            for (uint256 k; k < idx.length; ++k) {
                mask |= 1 << idx[k];
            }
            if (mask & ~uint256(_activeMask) != 0) reason = R_SPLIT;
        }
    }

    /// @dev The pot itself and the ClaimEscrow are never valid PAY payees under any policy: a
    /// transfer to the pot would charge shares without moving money (breaking I1), and AUSD sent
    /// to the escrow outside a claim could never be claimed or refunded.
    function _payeeAllowed(address payee, PayeePolicy policy) internal view returns (bool) {
        if (payee == address(this) || payee == address(claimEscrow)) return false;
        if (policy == PayeePolicy.ANYONE) return true;
        (uint256 i, bool found) = _indexOf(payee);
        if (found && _isActive(i)) return true;
        return policy == PayeePolicy.MEMBERS_AND_ALLOWLIST && isAllowedPayee[payee];
    }

    /// @dev used + amount > limit, without overflow.
    function _exceeds(uint256 used, uint256 amount, uint256 limit) internal pure returns (bool) {
        return amount > limit || used > limit - amount;
    }

    // ───────────────────────────── internal: spends ─────────────────────────────

    function _onThresholdMet(uint256 id, Spend storage s) internal {
        (uint256[] memory idx, uint256[] memory w,) = _loadSplit(s);
        if (_executionCheck(s, idx) == OK) {
            _closeProposal(s.proposer);
            _execute(id, s, s.payee, idx, w);
        } else {
            s.status = ProposalStatus.Approved;
            emit SpendApproved(id);
        }
    }

    /// @dev Assigns shares, records budget and cap usage, then moves the money.
    function _execute(uint256 id, Spend storage s, address payee, uint256[] memory idx, uint256[] memory w) internal {
        s.status = ProposalStatus.Executed;
        uint256 amount = s.amount;
        uint256 p = s.proposer;
        SpendKind kind = s.kind;
        uint256 category = s.category;

        uint256[] memory parts = _parts(amount, w);
        address[] memory accounts = _applyShares(idx, parts, false);
        if (kind == SpendKind.PERSONAL) _members[p].net += SafeCastLib.toInt96(amount);

        _categorySpent[category] = _sat64(uint256(_categorySpent[category]) + amount);
        MemberState storage st = _memberStates[p];
        uint16 today = _today();
        st.daySpent = _sat64((st.day == today ? uint256(st.daySpent) : 0) + amount);
        st.day = today;
        st.totalSpent = _sat64(uint256(st.totalSpent) + amount);

        uint256 claimId;
        if (kind == SpendKind.PAY) {
            ausd.safeTransfer(payee, amount);
        } else if (kind == SpendKind.LINK) {
            ausd.safeApprove(address(claimEscrow), amount);
            uint256 expiry = _min(block.timestamp + LINK_EXPIRY, uint256(endTime) + reviewWindow);
            claimId = claimEscrow.createFromPot(payee, amount, uint64(expiry), id);
        }
        emit SpendExecuted(id, amount, accounts, parts, claimId);
        _resetAcks();
    }

    function _cancel(uint256 id, Spend storage s, uint8 reason) internal {
        s.status = ProposalStatus.Cancelled;
        _closeProposal(s.proposer);
        emit SpendCancelled(id, reason);
    }

    function _closeProposal(uint256 proposer) internal {
        --_memberStates[proposer].openItems;
        --_openProposals;
    }

    function _isOpen(ProposalStatus status) internal pure returns (bool) {
        return status == ProposalStatus.Pending || status == ProposalStatus.Approved;
    }

    // ───────────────────────────── internal: splits ─────────────────────────────

    /// @dev Validates a split against the active members. On failure returns ok = false.
    function _readSplit(Split calldata split)
        internal
        view
        returns (uint256[] memory idx, uint256[] memory w, bool ok)
    {
        uint256 n = split.members.length;
        if (n == 0 || n > MAX_MEMBERS || n != split.weights.length) return (idx, w, false);
        idx = new uint256[](n);
        w = new uint256[](n);
        uint256 active = _activeMask;
        uint256 seen;
        for (uint256 k; k < n; ++k) {
            (uint256 i, bool found) = _indexOf(split.members[k]);
            uint256 bit = 1 << i;
            uint256 weight = split.weights[k];
            if (!found || active & bit == 0 || seen & bit != 0 || weight == 0) return (idx, w, false);
            seen |= bit;
            idx[k] = i;
            w[k] = weight;
        }
        ok = true;
    }

    /// @dev Packs (member index, weight) entries six to a word.
    function _storeSplit(Spend storage s, uint256[] memory idx, uint256[] memory w) internal {
        uint256 n = idx.length;
        s.splitLength = uint8(n);
        for (uint256 word; word * SPLIT_ENTRIES_PER_WORD < n; ++word) {
            uint256 packed;
            for (uint256 j; j < SPLIT_ENTRIES_PER_WORD; ++j) {
                uint256 k = word * SPLIT_ENTRIES_PER_WORD + j;
                if (k == n) break;
                packed |= (idx[k] | (w[k] << 8)) << (j * SPLIT_ENTRY_BITS);
            }
            s.split[word] = packed;
        }
    }

    function _loadSplit(Spend storage s)
        internal
        view
        returns (uint256[] memory idx, uint256[] memory w, uint256 mask)
    {
        uint256 n = s.splitLength;
        idx = new uint256[](n);
        w = new uint256[](n);
        uint256 packed;
        for (uint256 k; k < n; ++k) {
            uint256 j = k % SPLIT_ENTRIES_PER_WORD;
            if (j == 0) packed = s.split[k / SPLIT_ENTRIES_PER_WORD];
            uint256 entry = packed >> (j * SPLIT_ENTRY_BITS);
            idx[k] = entry & 0xff;
            w[k] = (entry >> 8) & 0xffffffff;
            mask |= 1 << idx[k];
        }
    }

    /// @dev part_k = amount * w_k / sum(w) for k >= 1; part_0 takes the rounding remainder.
    function _parts(uint256 amount, uint256[] memory w) internal pure returns (uint256[] memory parts) {
        uint256 n = w.length;
        parts = new uint256[](n);
        uint256 total;
        for (uint256 k; k < n; ++k) {
            total += w[k];
        }
        uint256 rest = amount;
        for (uint256 k = 1; k < n; ++k) {
            parts[k] = amount * w[k] / total;
            rest -= parts[k];
        }
        if (n != 0) parts[0] = rest;
    }

    /// @dev Assigns (`reverse` = false) or removes (`reverse` = true) cost shares.
    function _applyShares(uint256[] memory idx, uint256[] memory parts, bool reverse)
        internal
        returns (address[] memory accounts)
    {
        accounts = new address[](idx.length);
        for (uint256 k; k < idx.length; ++k) {
            Member storage m = _members[idx[k]];
            int96 part = SafeCastLib.toInt96(parts[k]);
            m.net = reverse ? m.net + part : m.net - part;
            accounts[k] = m.account;
        }
    }

    // ───────────────────────────── internal: disputes ─────────────────────────────

    function _openDisputeOf(uint256 disputeId) internal view returns (Dispute storage d) {
        d = _disputes[disputeId];
        if (d.openedAt == 0 || d.outcome != DisputeOutcome.None) revert InvalidStatus();
    }

    function _resolveSpenderCovers(uint256 disputeId, Dispute storage d) internal {
        uint256[] memory idx = new uint256[](1);
        uint256[] memory w = new uint256[](1);
        idx[0] = d.subject;
        w[0] = 1;
        _resolve(disputeId, d, DisputeOutcome.SpenderCovers, idx, w);
    }

    /// @dev Replaces the spend's cost assignment with (`idx`, `w`) unless the outcome is Keep.
    /// Only shares move, so Σ net is unchanged.
    function _resolve(
        uint256 disputeId,
        Dispute storage d,
        DisputeOutcome outcome,
        uint256[] memory idx,
        uint256[] memory w
    ) internal {
        Spend storage s = _spends[d.spendId];
        uint256 amount = s.amount;
        if (outcome != DisputeOutcome.Keep) {
            (uint256[] memory oldIdx, uint256[] memory oldW,) = _loadSplit(s);
            _applyShares(oldIdx, _parts(amount, oldW), true);
            _storeSplit(s, idx, w);
        }
        uint256[] memory parts = _parts(amount, w);
        address[] memory accounts = outcome == DisputeOutcome.Keep ? _accountsOf(idx) : _applyShares(idx, parts, false);

        d.outcome = outcome;
        s.disputeOpen = false;
        --_memberStates[d.opener].openItems;
        --_memberStates[d.subject].openItems;
        --_openDisputes;
        emit DisputeResolved(disputeId, outcome, accounts, parts);
        _resetAcks();
    }

    function _accountsOf(uint256[] memory idx) internal view returns (address[] memory accounts) {
        accounts = new address[](idx.length);
        for (uint256 k; k < idx.length; ++k) {
            accounts[k] = _members[idx[k]].account;
        }
    }

    function _approveRuleChange(uint256 id, RuleChange storage rc) internal {
        uint40 eta = uint40(block.timestamp + _rules.ruleTimelock);
        rc.status = ProposalStatus.Approved;
        rc.eta = eta;
        emit RuleChangeApproved(id, eta);
    }

    // ───────────────────────────── internal: math ─────────────────────────────

    function _today() internal view returns (uint16) {
        return uint16(block.timestamp / 1 days);
    }

    function _sat64(uint256 x) internal pure returns (uint64) {
        return x > type(uint64).max ? type(uint64).max : uint64(x);
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
