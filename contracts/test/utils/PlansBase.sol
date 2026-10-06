// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IPlansTypes} from "../../src/interfaces/IPlansTypes.sol";
import {IAUSD} from "../../src/interfaces/IPlansPeriphery.sol";
import {ClaimEscrow} from "../../src/ClaimEscrow.sol";
import {KeyRegistry} from "../../src/KeyRegistry.sol";
import {PlansFactory} from "../../src/PlansFactory.sol";
import {PlansSend} from "../../src/PlansSend.sol";
import {Pot} from "../../src/Pot.sol";
import {MockAUSD} from "../mocks/MockAUSD.sol";
import {PlansSigs} from "./PlansSigs.sol";

/// @notice Deploys Plans against an AUSD (MockAUSD by default) and wraps every signed action in a
/// one-line helper. Fork tests override `_deployToken` and `_fund`.
abstract contract PlansBase is Test, IPlansTypes {
    uint256 internal constant USD = 1e6;
    uint256 internal constant N_USERS = 12;

    address internal token;
    KeyRegistry internal registry;
    PlansFactory internal factory;
    ClaimEscrow internal escrow;
    PlansSend internal sender;

    uint256 internal invitePk;
    address internal inviteSigner;
    uint256[] internal pks;
    address[] internal users;
    uint256 internal nonceCounter;

    function setUp() public virtual {
        token = _deployToken();
        registry = new KeyRegistry();
        factory = new PlansFactory(token, address(registry));
        escrow = ClaimEscrow(factory.claimEscrow());
        sender = new PlansSend(token);
        (inviteSigner, invitePk) = makeAddrAndKey("invite");
        for (uint256 i; i < N_USERS; ++i) {
            (address user, uint256 pk) = makeAddrAndKey(string.concat("user", vm.toString(i)));
            users.push(user);
            pks.push(pk);
        }
    }

    function _deployToken() internal virtual returns (address) {
        return address(new MockAUSD());
    }

    function _fund(address to, uint256 amount) internal virtual {
        MockAUSD(token).mint(to, amount);
    }

    function _balance(address account) internal view returns (uint256) {
        return IAUSD(token).balanceOf(account);
    }

    // ─────────────── params ───────────────

    /// @dev The "Balanced" preset from docs/protocol.md.
    function _balancedRules() internal pure returns (Rules memory r) {
        r.instantMax = uint64(25 * USD);
        r.oneApprovalMax = uint64(200 * USD);
        r.highTier = HighTier.MAJORITY;
        r.memberDailyCap = uint64(150 * USD);
        r.proposalTtl = 24 hours;
        r.ruleTimelock = 1 hours;
    }

    function _params(Rules memory rules) internal view returns (CreatePotParams memory p) {
        p.rules = rules;
        p.startTime = uint64(vm.getBlockTimestamp());
        p.endTime = uint64(vm.getBlockTimestamp() + 30 days);
        p.reviewWindow = 1 days;
        p.inviteSigner = inviteSigner;
        p.creatorCountry = "GB";
        p.meta = hex"c0ffee";
        p.creatorKeyWrap = hex"0a";
        p.inviteKeyWrap = hex"0b";
        p.salt = keccak256(abi.encode(nonceCounter));
    }

    function _nonce() internal returns (uint256) {
        return uint256(keccak256(abi.encode("nonce", ++nonceCounter)));
    }

    function _deadline() internal view returns (uint256) {
        return vm.getBlockTimestamp() + 1 hours;
    }

    function _noDeposit() internal pure returns (Auth3009 memory a) {}

    function _noPermit() internal pure returns (Permit2612 memory p) {}

    function _noKey() internal pure returns (KeyReg memory k) {}

    function _auth(uint256 pk, address to, uint256 value) internal returns (Auth3009 memory) {
        return PlansSigs.receiveAuth(pk, token, to, value, bytes32(_nonce()));
    }

    // ─────────────── setup actions ───────────────

    /// @dev Creates a pot for user 0 (no extras) and joins users 1..n-1, each depositing `deposit`.
    function _potWith(uint256 n, Rules memory rules, uint256 deposit) internal returns (Pot pot) {
        pot = _createPot(0, _params(rules), deposit);
        for (uint256 i = 1; i < n; ++i) {
            _join(pot, i, deposit);
        }
    }

    function _createPot(uint256 creator, CreatePotParams memory p, uint256 deposit) internal returns (Pot pot) {
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.createPot(pks[creator], address(factory), users[creator], p, nonce, _deadline());
        Auth3009 memory dep;
        if (deposit != 0) {
            _fund(users[creator], deposit);
            dep = PlansSigs.receiveAuth(
                pks[creator], token, factory.predictPot(users[creator], p.salt), deposit, bytes32(_nonce())
            );
        }
        pot = Pot(factory.createPot(users[creator], p, nonce, _deadline(), sig, dep, _noPermit(), _noKey()));
    }

    function _join(Pot pot, uint256 u, uint256 deposit) internal {
        _joinWith(pot, u, deposit, _noPermit(), _noKey());
    }

    function _joinWith(Pot pot, uint256 u, uint256 deposit, Permit2612 memory permit, KeyReg memory key) internal {
        Auth3009 memory dep;
        if (deposit != 0) {
            if (_balance(users[u]) < deposit) _fund(users[u], deposit);
            dep = _auth(pks[u], address(pot), deposit);
        }
        uint256 nonce = _nonce();
        pot.join(
            users[u],
            "FR",
            nonce,
            _deadline(),
            PlansSigs.join(pks[u], address(pot), users[u], "FR", permit.value, nonce, _deadline()),
            PlansSigs.invite(invitePk, address(pot), users[u]),
            dep,
            permit,
            key
        );
    }

    function _contribute(Pot pot, uint256 u, uint256 amount) internal {
        _fund(users[u], amount);
        pot.contribute(users[u], _auth(pks[u], address(pot), amount));
    }

    /// @dev Grants the pot a safety-net allowance directly (outside join).
    function _approveSafetyNet(Pot pot, uint256 u, uint256 amount) internal {
        vm.prank(users[u]);
        IERC20Approve(token).approve(address(pot), amount);
    }

    // ─────────────── spending ───────────────

    function _propose(
        Pot pot,
        uint256 u,
        SpendKind kind,
        address payee,
        uint256 amount,
        uint8 category,
        address[] memory members,
        uint32[] memory weights
    ) internal returns (uint256) {
        PlansSigs.ProposeMsg memory m = PlansSigs.ProposeMsg({
            proposer: users[u],
            kind: uint8(kind),
            payee: payee,
            amount: amount,
            category: category,
            members: members,
            weights: weights,
            receiptHash: keccak256("receipt"),
            memo: "memo",
            nonce: _nonce(),
            deadline: _deadline()
        });
        bytes memory sig = PlansSigs.propose(pks[u], address(pot), m);
        return pot.propose(
            users[u],
            kind,
            payee,
            amount,
            category,
            Split(members, weights),
            m.receiptHash,
            m.memo,
            m.nonce,
            m.deadline,
            sig
        );
    }

    /// @dev Equal split across `members`.
    function _proposeEqual(Pot pot, uint256 u, SpendKind kind, address payee, uint256 amount, address[] memory members)
        internal
        returns (uint256)
    {
        return _propose(pot, u, kind, payee, amount, 7, members, _ones(members.length));
    }

    function _vote(Pot pot, uint256 u, uint256 id, bool approve) internal {
        uint256 nonce = _nonce();
        pot.vote(
            users[u],
            id,
            approve,
            nonce,
            _deadline(),
            PlansSigs.vote(pks[u], address(pot), users[u], id, approve, nonce, _deadline())
        );
    }

    function _cancel(Pot pot, uint256 u, uint256 id) internal {
        uint256 nonce = _nonce();
        pot.cancelSpend(
            users[u],
            id,
            nonce,
            _deadline(),
            PlansSigs.cancelSpend(pks[u], address(pot), users[u], id, nonce, _deadline())
        );
    }

    // ─────────────── disputes ───────────────

    function _openDispute(Pot pot, uint256 u, uint256 spendId, uint8 reason) internal returns (uint256) {
        uint256 nonce = _nonce();
        bytes memory sig =
            PlansSigs.openDispute(pks[u], address(pot), users[u], spendId, reason, "why", nonce, _deadline());
        return pot.openDispute(users[u], spendId, reason, "why", nonce, _deadline(), sig);
    }

    function _resolveDispute(
        Pot pot,
        uint256 u,
        uint256 disputeId,
        DisputeOutcome outcome,
        address[] memory members,
        uint32[] memory weights
    ) internal {
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.resolveDispute(
            pks[u], address(pot), users[u], disputeId, uint8(outcome), members, weights, nonce, _deadline()
        );
        pot.resolveDispute(users[u], disputeId, outcome, Split(members, weights), nonce, _deadline(), sig);
    }

    function _voteDispute(Pot pot, uint256 u, uint256 disputeId, bool covers) internal {
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.disputeVote(pks[u], address(pot), users[u], disputeId, covers, nonce, _deadline());
        pot.voteDispute(users[u], disputeId, covers, nonce, _deadline(), sig);
    }

    // ─────────────── controls and ending ───────────────

    function _memberSig(Pot pot, uint256 u, string memory typeName, uint256 nonce)
        internal
        view
        returns (bytes memory)
    {
        return PlansSigs.memberAction(pks[u], address(pot), typeName, users[u], nonce, _deadline());
    }

    function _freeze(Pot pot, uint256 u) internal {
        uint256 nonce = _nonce();
        pot.freeze(users[u], nonce, _deadline(), _memberSig(pot, u, "Freeze", nonce));
    }

    function _voteUnfreeze(Pot pot, uint256 u) internal {
        uint256 nonce = _nonce();
        pot.voteUnfreeze(users[u], nonce, _deadline(), _memberSig(pot, u, "UnfreezeVote", nonce));
    }

    function _exit(Pot pot, uint256 u) internal {
        uint256 nonce = _nonce();
        pot.exit(users[u], nonce, _deadline(), _memberSig(pot, u, "Exit", nonce));
    }

    function _ack(Pot pot, uint256 u) internal {
        uint256 nonce = _nonce();
        pot.ack(users[u], nonce, _deadline(), _memberSig(pot, u, "Ack", nonce));
    }

    function _proposeRules(Pot pot, uint256 u, Rules memory rules, address[] memory add, address[] memory remove)
        internal
        returns (uint256)
    {
        uint256 nonce = _nonce();
        bytes memory sig =
            PlansSigs.proposeRules(pks[u], address(pot), users[u], rules, add, remove, nonce, _deadline());
        return pot.proposeRules(users[u], rules, add, remove, nonce, _deadline(), sig);
    }

    function _voteRules(Pot pot, uint256 u, uint256 id, bool approve) internal {
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.voteRules(pks[u], address(pot), users[u], id, approve, nonce, _deadline());
        pot.voteRules(users[u], id, approve, nonce, _deadline(), sig);
    }

    function _ackAll(Pot pot) internal {
        address[] memory all = pot.members();
        for (uint256 i; i < all.length; ++i) {
            if (pot.isMember(all[i])) _ack(pot, _userIndex(all[i]));
        }
    }

    // ─────────────── accounting ───────────────

    function _sumNet(Pot pot) internal view returns (int256 sum) {
        address[] memory all = pot.members();
        for (uint256 i; i < all.length; ++i) {
            sum += pot.netOf(all[i]);
        }
    }

    function _assertI1(Pot pot) internal view {
        assertEq(_sumNet(pot), int256(_balance(address(pot))), "I1: sum(net) == pot balance");
    }

    // ─────────────── arrays ───────────────

    function _userIndex(address account) internal view returns (uint256) {
        for (uint256 i; i < users.length; ++i) {
            if (users[i] == account) return i;
        }
        revert("unknown user");
    }

    function _users(uint256 n) internal view returns (address[] memory a) {
        a = new address[](n);
        for (uint256 i; i < n; ++i) {
            a[i] = users[i];
        }
    }

    function _addrs(address a0) internal pure returns (address[] memory a) {
        a = new address[](1);
        a[0] = a0;
    }

    function _addrs(address a0, address a1) internal pure returns (address[] memory a) {
        a = new address[](2);
        (a[0], a[1]) = (a0, a1);
    }

    function _addrs(address a0, address a1, address a2) internal pure returns (address[] memory a) {
        a = new address[](3);
        (a[0], a[1], a[2]) = (a0, a1, a2);
    }

    function _ones(uint256 n) internal pure returns (uint32[] memory w) {
        w = new uint32[](n);
        for (uint256 i; i < n; ++i) {
            w[i] = 1;
        }
    }

    function _weights(uint32 w0, uint32 w1) internal pure returns (uint32[] memory w) {
        w = new uint32[](2);
        (w[0], w[1]) = (w0, w1);
    }

    function _weights(uint32 w0, uint32 w1, uint32 w2) internal pure returns (uint32[] memory w) {
        w = new uint32[](3);
        (w[0], w[1], w[2]) = (w0, w1, w2);
    }
}

interface IERC20Approve {
    function approve(address spender, uint256 amount) external returns (bool);
}
