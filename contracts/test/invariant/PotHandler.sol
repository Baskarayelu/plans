// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IPot} from "../../src/interfaces/IPot.sol";
import {ClaimEscrow} from "../../src/ClaimEscrow.sol";
import {Pot} from "../../src/Pot.sol";
import {MockAUSD} from "../mocks/MockAUSD.sol";
import {PlansBase, IERC20Approve} from "../utils/PlansBase.sol";
import {PlansSigs} from "../utils/PlansSigs.sol";

/// @notice Drives one pot (5 founding members, up to 12) through random signed actions. Every
/// action goes through a low-level call, so a revert never fails the run; ghost state is only
/// updated from calls that succeeded, using the events they emitted.
///
/// Spend-rule oracle: before any call that can execute a spend (propose, vote, execute) the
/// handler snapshots the pot (rules, schedule, freeze, balance, active set, payee status). For
/// every `SpendExecuted` the call emits, it re-derives from that snapshot and from its own ghost
/// ledgers (category spend, per-member day/total spend, contributions) whether the spend was
/// allowed, and whether its approvals met the tier computed independently at proposal time.
contract PotHandler is PlansBase {
    // ───────────────────────────── system ─────────────────────────────

    Pot public pot;
    uint256 public constant FOUNDERS = 5;

    address[] public outsiders;
    address[] public claimKeys;
    uint256[] internal claimPks;
    mapping(address => uint256) internal claimPkOf;
    /// @dev Every address other than pot and escrow that can ever hold AUSD in this suite.
    address[] internal _actors;
    bool[N_USERS] public joined;

    // ───────────────────────────── ghosts: spend rules ─────────────────────────────

    struct GSpend {
        address proposer;
        SpendKind kind;
        address payee;
        uint256 amount;
        uint8 category;
        uint8 expectedRequired;
        bool executed;
    }

    struct Snap {
        Rules rules;
        uint256 frozenUntil;
        uint256 balance;
        bool settled;
        uint256 startTime;
        uint256 endTime;
        uint256 activeMask; // over user indices
        bool payeeActive;
        bool payeeAllowlisted;
    }

    mapping(uint256 => GSpend) internal _gSpends;
    mapping(uint256 => address[]) internal _gSplit; // current cost assignment members
    mapping(uint256 => uint256) internal _gVoted; // user-index mask of members who voted on a spend
    mapping(address => uint256) public ghostContributed;
    uint256[8] public ghostCategorySpent;
    mapping(address => uint256) public ghostDay;
    mapping(address => uint256) public ghostDaySpent;
    mapping(address => uint256) public ghostTotalSpent;

    uint256 public ghostExecutions;
    uint256 public ghostExecViolations;
    string public lastViolation;

    // ───────────────────────────── ghosts: disputes ─────────────────────────────

    mapping(uint256 => address) internal _disputeSubject;

    // ───────────────────────────── ghosts: nonces and replays ─────────────────────────────

    struct Replay {
        address target;
        bytes data;
    }

    uint256 internal constant MAX_REPLAYS = 64;
    uint256 internal constant MAX_NONCES = 400;
    Replay[] internal _replays;
    uint256 internal _replayCursor;
    address[] internal _nonceMembers;
    uint256[] internal _nonceValues;
    uint256 public ghostReplayAttempts;
    uint256 public ghostReplaySuccess;
    uint256 public ghostRejoins;

    // ───────────────────────────── ghosts: escrow ─────────────────────────────

    mapping(uint256 => bool) public ghostClaimed;
    mapping(uint256 => bool) public ghostRefunded;
    uint256 public ghostEscrowViolations; // wrong-key claim, late claim or early refund that succeeded

    // ───────────────────────────── ghosts: settlement ─────────────────────────────

    bool public ghostSettled;
    bool public ghostCleanSettle;
    uint256 public ghostCleanSettleViolations;
    uint256 public ghostPostSettleRefunds;

    // ───────────────────────────── ghosts: collect ─────────────────────────────

    uint256 public ghostCollects;
    uint256 public ghostCollectedAmount;
    uint256 public ghostCollectViolations;
    string public lastCollectViolation;

    // ───────────────────────────── stats ─────────────────────────────

    uint256 internal constant N_ACTIONS = 28;
    uint256[N_ACTIONS] public callCount;
    uint256[N_ACTIONS] public okCount;
    uint256 internal _totalCalls;

    constructor() {
        setUp();
        vm.warp(1_750_000_000);

        for (uint256 i; i < 3; ++i) {
            (address o,) = makeAddrAndKey(string.concat("outsider", vm.toString(i)));
            outsiders.push(o);
            (address k, uint256 pk) = makeAddrAndKey(string.concat("claimKey", vm.toString(i)));
            claimKeys.push(k);
            claimPks.push(pk);
            claimPkOf[k] = pk;
        }
        for (uint256 i; i < N_USERS; ++i) {
            _actors.push(users[i]);
        }
        for (uint256 i; i < 3; ++i) {
            _actors.push(outsiders[i]);
            _actors.push(claimKeys[i]);
        }
        _actors.push(address(this));

        Rules memory r = _balancedRules();
        r.oneApprovalMax = uint64(100 * USD);
        r.memberDailyCap = uint64(500 * USD);
        r.memberTotalCap = uint64(2000 * USD);
        r.categoryBudgets[0] = uint64(300 * USD);
        r.categoryBudgets[3] = uint64(200 * USD);
        CreatePotParams memory p = _params(r);
        p.endTime = uint64(_now() + 20 days);
        pot = _createPot(0, p, 200 * USD);
        ghostContributed[users[0]] = 200 * USD;
        joined[0] = true;
        for (uint256 i = 1; i < FOUNDERS; ++i) {
            Permit2612 memory pm;
            if (i % 2 == 1) pm = PlansSigs.permit(pks[i], token, address(pot), 300 * USD, _now() + 365 days);
            _joinWith(pot, i, 200 * USD, pm, _noKey());
            ghostContributed[users[i]] = 200 * USD;
            joined[i] = true;
        }
    }

    // ───────────────────────────── views for the invariant suite ─────────────────────────────

    function ausd() external view returns (MockAUSD) {
        return MockAUSD(token);
    }

    function claimEscrow() external view returns (ClaimEscrow) {
        return escrow;
    }

    function actors() external view returns (address[] memory) {
        return _actors;
    }

    function usedNonceCount() external view returns (uint256) {
        return _nonceValues.length;
    }

    function usedNonceAt(uint256 k) external view returns (address, uint256) {
        return (_nonceMembers[k], _nonceValues[k]);
    }

    // ───────────────────────────── actions: membership and money in ─────────────────────────────

    function joinMember(uint256 seed) external {
        _stat(0);
        seed = _h(seed, 1000);
        bool rejoin = seed % 10 == 0;
        uint256 u = type(uint256).max;
        for (uint256 k; k < N_USERS; ++k) {
            uint256 i = (seed + k) % N_USERS;
            if (joined[i] == rejoin) {
                u = i;
                break;
            }
        }
        if (u == type(uint256).max) return;
        uint256 r = _h(seed, 1);
        Auth3009 memory dep;
        if (r % 4 != 0) {
            uint256 amount = _between(r >> 8, 1, 300 * USD);
            _fund(users[u], amount);
            dep = _auth(pks[u], address(pot), amount);
        }
        Permit2612 memory pm;
        if ((r >> 80) % 2 == 0) {
            pm = PlansSigs.permit(pks[u], token, address(pot), _between(r >> 88, 1, 500 * USD), _now() + 30 days);
        }
        uint256 nonce = _nonce();
        bytes memory data = abi.encodeCall(
            IPot.join,
            (
                users[u],
                bytes2("FR"),
                nonce,
                _deadline(),
                PlansSigs.join(pks[u], address(pot), users[u], "FR", pm.value, nonce, _deadline()),
                PlansSigs.invite(invitePk, address(pot), users[u]),
                dep,
                pm,
                _noKey()
            )
        );
        if (_signed(0, users[u], nonce, data, false, address(0))) {
            if (rejoin) ++ghostRejoins;
            joined[u] = true;
        }
    }

    function contribute(uint256 seed) external {
        _stat(1);
        seed = _h(seed, 1007);
        (uint256 u, bool found) = _pickActive(seed);
        if (!found) return;
        uint256 amount = _between(seed >> 8, 1, 300 * USD);
        _fund(users[u], amount);
        bytes memory data = abi.encodeCall(IPot.contribute, (users[u], _auth(pks[u], address(pot), amount)));
        if (_call(1, address(pot), data, false, address(0))) _remember(address(pot), data);
    }

    function approveSafetyNet(uint256 seed) external {
        _stat(2);
        seed = _h(seed, 1014);
        uint256 u = seed % N_USERS;
        vm.prank(users[u]);
        IERC20Approve(token).approve(address(pot), _between(seed >> 8, 0, 1000 * USD));
        ++okCount[2];
    }

    // ───────────────────────────── actions: spending ─────────────────────────────

    function proposeSpend(uint256 seed, uint256 amountSeed, uint256 splitSeed) external {
        _stat(3);
        seed = _h(seed, 1021);
        amountSeed = _h(amountSeed, 1022);
        splitSeed = _h(splitSeed, 1023);
        _proposeRandom(3, seed, _amount(amountSeed), splitSeed);
    }

    /// @dev Small amounts, mostly within instantMax, so instant executions are frequent.
    function proposeSmall(uint256 seed, uint256 splitSeed) external {
        _stat(4);
        seed = _h(seed, 1028);
        splitSeed = _h(splitSeed, 1029);
        _proposeRandom(4, seed, _between(seed >> 128, 1, 30 * USD), splitSeed);
    }

    function voteSpend(uint256 seed) external {
        _stat(5);
        seed = _h(seed, 1035);
        (uint256 id, bool found) = _findLiveSpend(seed, ProposalStatus.Pending);
        if (!found) return;
        // Sometimes freeze first, so a vote that meets the threshold leaves the spend Approved.
        if ((seed >> 200) % 5 == 0 && _now() >= pot.frozenUntil()) {
            (uint256 f,) = _pickActive(seed >> 100);
            _memberAction(13, f, "Freeze", IPot.freeze.selector);
        }
        uint256 voters = 1 + (seed >> 8) % 4;
        for (uint256 k; k < voters; ++k) {
            (ProposalStatus st,,,,,,,) = pot.spendInfo(id);
            if (st != ProposalStatus.Pending) break;
            // Mostly members who have not voted yet; sometimes anyone (AlreadyVoted path).
            (uint256 u, bool ok) = _h(seed, 30 + k) % 8 == 0
                ? _pickActive(_h(seed, 10 + k))
                : _pickNonVoter(_h(seed, 10 + k), _gVoted[id] | (1 << _userIndex(_gSpends[id].proposer)));
            if (!ok) break;
            bool approve = _h(seed, 20 + k) % 5 != 0;
            uint256 nonce = _nonce();
            bytes memory data = abi.encodeCall(
                IPot.vote,
                (
                    users[u],
                    id,
                    approve,
                    nonce,
                    _deadline(),
                    PlansSigs.vote(pks[u], address(pot), users[u], id, approve, nonce, _deadline())
                )
            );
            if (_signed(5, users[u], nonce, data, true, _gSpends[id].payee)) _gVoted[id] |= 1 << u;
        }
    }

    function cancelSpend(uint256 seed) external {
        _stat(6);
        seed = _h(seed, 1042);
        (uint256 id, bool found) = _findSpend(seed, ProposalStatus.Pending, ProposalStatus.Approved);
        if (!found) return;
        _cancelAs(6, _userIndex(_gSpends[id].proposer), id);
    }

    function executeSpend(uint256 seed) external {
        _stat(7);
        seed = _h(seed, 1049);
        (uint256 id, bool found) = _findLiveSpend(seed, ProposalStatus.Approved);
        if (!found) return;
        // Approved means the threshold was met while blocked (cap, freeze, funds, split). Often move
        // to the next UTC day (if the proposal is still live) or vote the freeze away first.
        uint256 mode = (seed >> 8) % 3;
        if (mode == 0) {
            (,,,,,, uint64 expiresAt,) = pot.spendInfo(id);
            uint256 target = (_now() / 1 days + 1) * 1 days;
            if (target <= expiresAt) vm.warp(target);
        } else if (mode == 1) {
            for (uint256 i; i < N_USERS && _now() < pot.frozenUntil(); ++i) {
                if (pot.isMember(users[i])) _memberAction(14, i, "UnfreezeVote", IPot.voteUnfreeze.selector);
            }
        }
        _call(7, address(pot), abi.encodeCall(IPot.execute, (id)), true, _gSpends[id].payee);
    }

    function expireSpend(uint256 seed) external {
        _stat(8);
        seed = _h(seed, 1056);
        (uint256 id, bool found) = _findSpend(seed, ProposalStatus.Pending, ProposalStatus.Approved);
        if (!found) return;
        (,,,,,, uint64 expiresAt,) = pot.spendInfo(id);
        if ((seed >> 8) % 4 == 0 && _now() <= expiresAt) vm.warp(uint256(expiresAt) + 1);
        _call(8, address(pot), abi.encodeCall(IPot.expire, (id)), false, address(0));
    }

    // ───────────────────────────── actions: disputes ─────────────────────────────

    function openDispute(uint256 seed) external {
        _stat(9);
        seed = _h(seed, 1063);
        uint256 n = pot.spendCount();
        if (n == 0) return;
        for (uint256 k; k < n; ++k) {
            uint256 id = 1 + (seed + k) % n;
            (ProposalStatus st,,, uint256 amount,,,, bool open) = pot.spendInfo(id);
            if (st != ProposalStatus.Executed || amount == 0 || open) continue;
            address[] storage split = _gSplit[id];
            address member = split[(seed >> 8) % split.length];
            if (!pot.isMember(member)) continue;
            uint256 u = _userIndex(member);
            uint8 reason = uint8((seed >> 16) % 3);
            uint256 nonce = _nonce();
            bytes memory data = abi.encodeCall(
                IPot.openDispute,
                (
                    member,
                    id,
                    reason,
                    bytes("why"),
                    nonce,
                    _deadline(),
                    PlansSigs.openDispute(pks[u], address(pot), member, id, reason, "why", nonce, _deadline())
                )
            );
            if (_signed(9, member, nonce, data, false, address(0))) {
                _disputeSubject[pot.disputeCount()] = _gSpends[id].proposer;
            }
            return;
        }
    }

    function resolveDispute(uint256 seed, uint256 splitSeed) external {
        _stat(10);
        seed = _h(seed, 1070);
        splitSeed = _h(splitSeed, 1071);
        (uint256 did, bool found) = _findOpenDispute(seed);
        if (!found) return;
        uint256 t = (seed >> 8) % 10;
        DisputeOutcome outcome =
            t < 5 ? DisputeOutcome.Resplit : t < 9 ? DisputeOutcome.SpenderCovers : DisputeOutcome.Keep;
        _resolveAs(10, did, outcome, splitSeed);
    }

    function voteDispute(uint256 seed) external {
        _stat(11);
        seed = _h(seed, 1077);
        (uint256 did, bool found) = _findOpenDispute(seed);
        if (!found) return;
        (uint256 u, bool ok) = _pickActive(seed >> 8);
        if (!ok) return;
        bool covers = (seed >> 16) % 2 == 0;
        uint256 nonce = _nonce();
        bytes memory data = abi.encodeCall(
            IPot.voteDispute,
            (
                users[u],
                did,
                covers,
                nonce,
                _deadline(),
                PlansSigs.disputeVote(pks[u], address(pot), users[u], did, covers, nonce, _deadline())
            )
        );
        _signed(11, users[u], nonce, data, false, address(0));
    }

    function finalizeDispute(uint256 seed) external {
        _stat(12);
        seed = _h(seed, 1084);
        (uint256 did, bool found) = _findOpenDispute(seed);
        if (!found) return;
        (uint256 spendId,, uint64 openedAt,,) = pot.disputeInfo(did);
        if ((seed >> 8) % 4 == 0 && _now() < uint256(openedAt) + 48 hours) {
            vm.warp(uint256(openedAt) + 48 hours);
        }
        if (_call(12, address(pot), abi.encodeCall(IPot.finalizeDispute, (did)), false, address(0))) {
            (, DisputeOutcome outcome,,,) = pot.disputeInfo(did);
            if (outcome == DisputeOutcome.SpenderCovers) _setSplitTo(spendId, _disputeSubject[did]);
        }
    }

    // ───────────────────────────── actions: safety controls ─────────────────────────────

    function freezePot(uint256 seed) external {
        _stat(13);
        seed = _h(seed, 1091);
        if (seed % 8 != 0) return; // a freeze blocks spending for 24h; keep it rare
        (uint256 u, bool found) = _pickActive(seed >> 8);
        if (!found) return;
        _memberAction(13, u, "Freeze", IPot.freeze.selector);
    }

    function voteUnfreeze(uint256 seed) external {
        _stat(14);
        seed = _h(seed, 1098);
        if (_now() >= pot.frozenUntil() && seed % 8 != 0) return;
        uint256 voters = 1 + (seed >> 8) % 3;
        for (uint256 k; k < voters; ++k) {
            (uint256 u, bool found) = _pickActive(_h(seed, k));
            if (!found) return;
            _memberAction(14, u, "UnfreezeVote", IPot.voteUnfreeze.selector);
        }
    }

    function proposeRules(uint256 seed, uint256 listSeed) external {
        _stat(15);
        seed = _h(seed, 1105);
        listSeed = _h(listSeed, 1106);
        (uint256 u, bool found) = _pickActive(seed);
        if (!found) return;
        Rules memory r = _randomRules(_h(seed, 1));
        address[] memory add = _randomPayees(listSeed);
        address[] memory remove = _randomPayees(listSeed >> 128);
        uint256 nonce = _nonce();
        bytes memory data = abi.encodeCall(
            IPot.proposeRules,
            (
                users[u],
                r,
                add,
                remove,
                nonce,
                _deadline(),
                PlansSigs.proposeRules(pks[u], address(pot), users[u], r, add, remove, nonce, _deadline())
            )
        );
        _signed(15, users[u], nonce, data, false, address(0));
    }

    function voteRules(uint256 seed) external {
        _stat(16);
        seed = _h(seed, 1112);
        (uint256 id, bool found) = _findRuleChange(seed, ProposalStatus.Pending);
        if (!found) return;
        uint256 voters = 1 + (seed >> 8) % 3;
        for (uint256 k; k < voters; ++k) {
            (uint256 u, bool ok) = _pickActive(_h(seed, 30 + k));
            if (!ok) return;
            bool approve = _h(seed, 40 + k) % 5 != 0;
            uint256 nonce = _nonce();
            bytes memory data = abi.encodeCall(
                IPot.voteRules,
                (
                    users[u],
                    id,
                    approve,
                    nonce,
                    _deadline(),
                    PlansSigs.voteRules(pks[u], address(pot), users[u], id, approve, nonce, _deadline())
                )
            );
            _signed(16, users[u], nonce, data, false, address(0));
        }
    }

    function applyRules(uint256 seed) external {
        _stat(17);
        seed = _h(seed, 1119);
        (uint256 id, bool found) = _findRuleChange(seed, ProposalStatus.Approved);
        if (!found) return;
        (,,,, uint64 eta) = pot.ruleChangeInfo(id);
        if ((seed >> 8) % 4 == 0 && _now() < eta) vm.warp(eta);
        _call(17, address(pot), abi.encodeCall(IPot.applyRules, (id)), false, address(0));
    }

    // ───────────────────────────── actions: ending ─────────────────────────────

    function exitMember(uint256 seed) external {
        _stat(18);
        seed = _h(seed, 1126);
        if (pot.activeMemberCount() <= 3) return;
        (uint256 u, bool found) = _pickActive(seed);
        if (!found) return;
        _memberAction(18, u, "Exit", IPot.exit.selector);
    }

    function ackMembers(uint256 seed) external {
        _stat(19);
        seed = _h(seed, 1133);
        bool all = seed % 3 == 0;
        for (uint256 i; i < N_USERS; ++i) {
            if (!pot.isMember(users[i])) continue;
            if (all || _h(seed, i) % 2 == 0) _memberAction(19, i, "Ack", IPot.ack.selector);
        }
    }

    function settlePot(uint256 seed) external {
        _stat(20);
        seed = _h(seed, 1140);
        // Settlement ends spending for good, so it mostly happens late in a run.
        if (pot.settled() || (_totalCalls < 50 ? seed % 25 != 0 : seed % 3 != 0)) return;
        if ((seed >> 8) % 4 != 0) _wrapUp();
        bool prepare = (seed >> 16) % 3 != 0;

        address[] memory all = pot.members();
        bool clean = true;
        for (uint256 i; i < all.length; ++i) {
            int256 net = pot.netOf(all[i]);
            if (MockAUSD(token).frozen(all[i])) {
                // A frozen creditor's payout or debtor's pull is skipped: not a clean settle.
                if (net != 0) clean = false;
                continue;
            }
            if (net >= 0) continue;
            uint256 debt = uint256(-net);
            if (prepare) {
                uint256 bal = _balance(all[i]);
                if (bal < debt) _fund(all[i], debt - bal);
                if (IERC20Allowance(token).allowance(all[i], address(pot)) < debt) {
                    vm.prank(all[i]);
                    IERC20Approve(token).approve(address(pot), debt);
                }
            }
            if (_balance(all[i]) < debt || IERC20Allowance(token).allowance(all[i], address(pot)) < debt) {
                clean = false;
            }
        }

        if (!_call(20, address(pot), abi.encodeCall(IPot.settle, ()), false, address(0))) return;
        ghostSettled = true;
        if (!clean) return;
        ghostCleanSettle = true;
        if (_balance(address(pot)) != 0) ++ghostCleanSettleViolations;
        for (uint256 i; i < all.length; ++i) {
            if (pot.netOf(all[i]) != 0) ++ghostCleanSettleViolations;
        }
    }

    function payDebt(uint256 seed) external {
        _stat(21);
        seed = _h(seed, 1147);
        address[] memory all = pot.members();
        bool isSettled = pot.settled();
        for (uint256 k; k < all.length; ++k) {
            address m = all[(seed + k) % all.length];
            int256 net = pot.netOf(m);
            if (net >= 0 || (!isSettled && pot.isMember(m))) continue;
            uint256 amount = _between(seed >> 8, 1, uint256(-net));
            _fund(m, amount);
            bytes memory data = abi.encodeCall(IPot.payDebt, (m, _auth(pks[_userIndex(m)], address(pot), amount)));
            if (_call(21, address(pot), data, false, address(0))) _remember(address(pot), data);
            return;
        }
    }

    // ───────────────────────────── actions: escrow ─────────────────────────────

    function claimLink(uint256 seed) external {
        _stat(22);
        seed = _h(seed, 1154);
        uint256 n = escrow.claimCount();
        if (n == 0) return;
        uint256 id = _pickClaim(seed, n);
        (, address signer,, uint64 expiry,,) = escrow.claimInfo(id);
        bool wrongKey = (seed >> 8) % 8 == 0;
        uint256 pk = claimPkOf[signer];
        if (wrongKey) pk = claimPks[(_indexOfKey(signer) + 1) % claimPks.length];
        address recipient = _actors[(seed >> 16) % _actors.length];
        bytes memory data = abi.encodeCall(
            ClaimEscrow.claim, (id, recipient, bytes2("US"), PlansSigs.claim(pk, address(escrow), id, recipient, "US"))
        );
        if (_call(22, address(escrow), data, false, address(0))) {
            if (wrongKey || _now() > expiry) ++ghostEscrowViolations;
            ghostClaimed[id] = true;
            _remember(address(escrow), data);
        }
    }

    function refundLink(uint256 seed) external {
        _stat(23);
        seed = _h(seed, 1161);
        uint256 n = escrow.claimCount();
        if (n == 0) return;
        uint256 id = _pickClaim(seed, n);
        (,,, uint64 expiry,,) = escrow.claimInfo(id);
        // After settlement nothing else can happen, so refunds always wait for expiry.
        if ((pot.settled() || (seed >> 8) % 4 == 0) && _now() <= expiry) vm.warp(uint256(expiry) + 1);
        bool early = _now() <= expiry;
        if (_call(23, address(escrow), abi.encodeCall(ClaimEscrow.refund, (id)), false, address(0))) {
            if (early) ++ghostEscrowViolations;
            ghostRefunded[id] = true;
        }
    }

    // ───────────────────────────── actions: AUSD freeze and collect ─────────────────────────────

    /// @dev Toggles AUSD's freeze flag on a member (freezing is rarer than unfreezing), so payouts
    /// at settlement and in distributions get skipped and later collected.
    function freezeAusd(uint256 seed) external {
        _stat(26);
        seed = _h(seed, 1182);
        address a = users[seed % N_USERS];
        bool freezeIt = !MockAUSD(token).frozen(a);
        if (freezeIt && (seed >> 8) % 3 != 0) return;
        MockAUSD(token).setFrozen(a, freezeIt);
        ++okCount[26];
    }

    /// @dev Anyone collects for a member (mostly one with a positive net). A success must pay that
    /// member exactly the pro-rata formula and nobody else anything; a refusal must change nothing.
    function collectPayout(uint256 seed) external {
        _stat(27);
        seed = _h(seed, 1189);
        address[] memory all = pot.members();
        address m = all[seed % all.length];
        if ((seed >> 8) % 4 != 0) {
            for (uint256 k; k < all.length; ++k) {
                address c = all[(seed + k) % all.length];
                if (pot.netOf(c) > 0) {
                    m = c;
                    break;
                }
            }
        }
        if ((seed >> 16) % 2 == 0 && MockAUSD(token).frozen(m)) MockAUSD(token).setFrozen(m, false);

        int256 net = pot.netOf(m);
        uint256 credit;
        int256[] memory nets = new int256[](all.length);
        for (uint256 i; i < all.length; ++i) {
            nets[i] = pot.netOf(all[i]);
            if (nets[i] > 0) credit += uint256(nets[i]);
        }
        uint256 bal = _balance(address(pot));
        uint256 expected;
        if (net > 0) expected = bal >= credit ? uint256(net) : uint256(net) * bal / credit;
        bool settledBefore = pot.settled();
        bool frozenBefore = MockAUSD(token).frozen(m);
        uint256[] memory before = new uint256[](_actors.length);
        for (uint256 i; i < _actors.length; ++i) {
            before[i] = _balance(_actors[i]);
        }
        uint256 escrowBefore = _balance(address(escrow));

        bool ok = _call(27, address(pot), abi.encodeCall(IPot.collect, (m)), false, address(0));
        if (!ok) {
            if (settledBefore && expected != 0 && !frozenBefore) _collectViolation("collect refused a payable claim");
            if (_balance(address(pot)) != bal) _collectViolation("failed collect moved money");
            return;
        }
        ++ghostCollects;
        ghostCollectedAmount += expected;
        if (!settledBefore) _collectViolation("collect before settlement");
        if (expected == 0 || expected > uint256(net)) _collectViolation("collect paid with nothing owed");
        if (_balance(address(pot)) != bal - expected) _collectViolation("pot paid a different amount");
        if (pot.netOf(m) != net - int256(expected)) _collectViolation("member net not reduced by the payment");
        if (_balance(address(escrow)) != escrowBefore) _collectViolation("escrow changed");
        for (uint256 i; i < _actors.length; ++i) {
            uint256 want = _actors[i] == m ? before[i] + expected : before[i];
            if (_balance(_actors[i]) != want) _collectViolation("someone other than the member was paid");
        }
        for (uint256 i; i < all.length; ++i) {
            if (all[i] != m && pot.netOf(all[i]) != nets[i]) _collectViolation("another member's net changed");
        }
    }

    function _collectViolation(string memory why) internal {
        ++ghostCollectViolations;
        lastCollectViolation = why;
    }

    // ───────────────────────────── actions: time and replays ─────────────────────────────

    function warpTime(uint256 seed) external {
        _stat(24);
        seed = _h(seed, 1168);
        uint256 t = seed % 16;
        uint256 dt;
        if (t < 8) dt = _between(seed >> 8, 1, 1 hours);
        else if (t < 12) dt = _between(seed >> 8, 1 hours, 12 hours);
        else if (t < 14) dt = 1 days + 1;
        else if (t < 15) dt = 48 hours + 1;
        else dt = 7 days + 1;
        vm.warp(_now() + dt);
        ++okCount[24];
    }

    /// @dev Re-submits a call that already succeeded. Every recorded call is consumed by a nonce
    /// (pot nonce, ERC-3009 nonce or one-time claim), so any success is a replay.
    function replay(uint256 seed) external {
        _stat(25);
        seed = _h(seed, 1175);
        if (_replays.length == 0) return;
        Replay storage r = _replays[seed % _replays.length];
        ++ghostReplayAttempts;
        (bool ok,) = r.target.call(r.data);
        if (ok) {
            ++ghostReplaySuccess;
            ++okCount[25];
        }
    }

    // ───────────────────────────── internal: actions ─────────────────────────────

    function _proposeRandom(uint256 action, uint256 seed, uint256 amount, uint256 splitSeed) internal {
        (uint256 u, bool found) = _pickActive(seed);
        if (!found) return;
        SpendKind kind = SpendKind((seed >> 8) % 3);
        uint8 category = uint8((seed >> 16) % 8);
        if ((seed >> 20) % 32 == 0) category = 8; // invalid
        address payee;
        if (kind == SpendKind.PAY) {
            payee = (seed >> 24) % 2 == 0 ? users[(seed >> 32) % N_USERS] : outsiders[(seed >> 32) % outsiders.length];
        } else if (kind == SpendKind.LINK) {
            payee = claimKeys[(seed >> 32) % claimKeys.length];
        }
        (address[] memory members, uint32[] memory weights) = _randomSplit(splitSeed);
        _proposeAs(action, u, kind, payee, amount, category, members, weights);
    }

    function _proposeAs(
        uint256 action,
        uint256 u,
        SpendKind kind,
        address payee,
        uint256 amount,
        uint8 category,
        address[] memory members,
        uint32[] memory weights
    ) internal {
        uint256 id = pot.spendCount() + 1;
        // Tier from the pre-call state, computed independently of the pot.
        Rules memory r = pot.getRules();
        uint256 active = pot.activeMemberCount();
        uint256 required;
        if (amount <= r.instantMax) required = 1;
        else if (amount <= r.oneApprovalMax) required = 2;
        else if (r.highTier == HighTier.ALL) required = active;
        else required = active / 2 + 1;
        if (required > active) required = active;

        _gSpends[id] = GSpend({
            proposer: users[u],
            kind: kind,
            payee: payee,
            amount: amount,
            category: category,
            expectedRequired: uint8(required),
            executed: false
        });
        _gSplit[id] = members;

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
        bytes memory data = abi.encodeCall(
            IPot.propose,
            (
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
                PlansSigs.propose(pks[u], address(pot), m)
            )
        );
        if (!_signed(action, users[u], m.nonce, data, true, payee)) {
            delete _gSpends[id];
            delete _gSplit[id];
        }
    }

    function _cancelAs(uint256 action, uint256 u, uint256 id) internal {
        uint256 nonce = _nonce();
        bytes memory data = abi.encodeCall(
            IPot.cancelSpend,
            (
                users[u],
                id,
                nonce,
                _deadline(),
                PlansSigs.cancelSpend(pks[u], address(pot), users[u], id, nonce, _deadline())
            )
        );
        _signed(action, users[u], nonce, data, false, address(0));
    }

    function _resolveAs(uint256 action, uint256 did, DisputeOutcome outcome, uint256 splitSeed) internal {
        address subject = _disputeSubject[did];
        uint256 u = _userIndex(subject);
        (address[] memory members, uint32[] memory weights) = _randomSplit(splitSeed);
        uint256 nonce = _nonce();
        bytes memory data = abi.encodeCall(
            IPot.resolveDispute,
            (
                subject,
                did,
                outcome,
                Split(members, weights),
                nonce,
                _deadline(),
                PlansSigs.resolveDispute(
                    pks[u], address(pot), subject, did, uint8(outcome), members, weights, nonce, _deadline()
                )
            )
        );
        if (_signed(action, subject, nonce, data, false, address(0))) {
            (uint256 spendId,,,,) = pot.disputeInfo(did);
            if (outcome == DisputeOutcome.Resplit) _gSplit[spendId] = members;
            else if (outcome == DisputeOutcome.SpenderCovers) _setSplitTo(spendId, subject);
        }
    }

    /// @dev Freeze, UnfreezeVote, Exit and Ack share the signature shape (member, nonce, deadline, sig).
    function _memberAction(uint256 action, uint256 u, string memory typeName, bytes4 selector) internal {
        uint256 nonce = _nonce();
        bytes memory data = abi.encodeWithSelector(
            selector,
            users[u],
            nonce,
            _deadline(),
            PlansSigs.memberAction(pks[u], address(pot), typeName, users[u], nonce, _deadline())
        );
        _signed(action, users[u], nonce, data, false, address(0));
    }

    /// @dev Closes every open proposal and dispute, then has every active member ack.
    function _wrapUp() internal {
        uint256 n = pot.spendCount();
        for (uint256 id = 1; id <= n; ++id) {
            (ProposalStatus st,,,,,,,) = pot.spendInfo(id);
            if (st == ProposalStatus.Pending || st == ProposalStatus.Approved) {
                _cancelAs(20, _userIndex(_gSpends[id].proposer), id);
            }
        }
        uint256 d = pot.disputeCount();
        for (uint256 did = 1; did <= d; ++did) {
            (, DisputeOutcome outcome,,,) = pot.disputeInfo(did);
            if (outcome == DisputeOutcome.None) _resolveAs(20, did, DisputeOutcome.SpenderCovers, 0);
        }
        for (uint256 i; i < N_USERS; ++i) {
            if (pot.isMember(users[i])) _memberAction(20, i, "Ack", IPot.ack.selector);
        }
    }

    // ───────────────────────────── internal: calls and the oracle ─────────────────────────────

    function _signed(uint256 action, address member, uint256 nonce, bytes memory data, bool mayExecute, address payee)
        internal
        returns (bool ok)
    {
        ok = _call(action, address(pot), data, mayExecute, payee);
        if (!ok) return false;
        _remember(address(pot), data);
        if (_nonceValues.length < MAX_NONCES) {
            _nonceMembers.push(member);
            _nonceValues.push(nonce);
        }
    }

    function _call(uint256 action, address target, bytes memory data, bool mayExecute, address payee)
        internal
        returns (bool ok)
    {
        Snap memory s = _snap(payee);
        vm.recordLogs();
        (ok,) = target.call(data);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        if (!ok) return false;
        ++okCount[action];
        for (uint256 k; k < logs.length; ++k) {
            if (logs[k].emitter != address(pot)) continue;
            bytes32 t0 = logs[k].topics[0];
            if (t0 == IPot.Contributed.selector || t0 == IPot.Pulled.selector || t0 == IPot.DebtPaid.selector) {
                ghostContributed[address(uint160(uint256(logs[k].topics[1])))] += abi.decode(logs[k].data, (uint256));
            } else if (t0 == IPot.SpendExecuted.selector) {
                (uint256 amount,,,) = abi.decode(logs[k].data, (uint256, address[], uint256[], uint256));
                uint256 id = uint256(logs[k].topics[1]);
                if (!mayExecute) _violation("spend executed by an unexpected action");
                _checkExecution(id, amount, s);
            } else if (t0 == IPot.EscrowRefunded.selector && s.settled) {
                ++ghostPostSettleRefunds;
            }
        }
    }

    function _snap(address payee) internal view returns (Snap memory s) {
        s.rules = pot.getRules();
        s.frozenUntil = pot.frozenUntil();
        s.balance = _balance(address(pot));
        s.settled = pot.settled();
        s.startTime = pot.startTime();
        s.endTime = pot.endTime();
        for (uint256 i; i < N_USERS; ++i) {
            if (pot.isMember(users[i])) s.activeMask |= 1 << i;
        }
        if (payee != address(0)) {
            s.payeeActive = pot.isMember(payee);
            s.payeeAllowlisted = pot.isAllowedPayee(payee);
        }
    }

    /// @dev Independent re-derivation of every check in docs/protocol.md "Spending rules" against
    /// the state right before the call that executed spend `id`.
    function _checkExecution(uint256 id, uint256 evAmount, Snap memory s) internal {
        ++ghostExecutions;
        GSpend storage g = _gSpends[id];
        if (g.proposer == address(0)) return _violation("executed spend unknown to the handler");
        if (g.executed) _violation("spend executed twice");
        g.executed = true;
        uint256 amount = g.amount;
        if (evAmount != amount) _violation("executed amount differs from proposal");

        if (s.activeMask & (1 << _userIndex(g.proposer)) == 0) _violation("proposer not active");
        if (_now() < s.startTime || _now() > s.endTime || s.settled) _violation("plan not open");
        if (_now() < s.frozenUntil) _violation("executed while frozen");
        if (s.rules.minContribution != 0) {
            for (uint256 i; i < N_USERS; ++i) {
                if (s.activeMask & (1 << i) != 0 && ghostContributed[users[i]] < s.rules.minContribution) {
                    _violation("min contribution not met");
                }
            }
        }
        if (g.kind == SpendKind.PAY && s.rules.payeePolicy != PayeePolicy.ANYONE) {
            bool allowed =
                s.payeeActive || (s.rules.payeePolicy == PayeePolicy.MEMBERS_AND_ALLOWLIST && s.payeeAllowlisted);
            if (!allowed) _violation("payee not allowed");
        }
        if (g.category > 7 || amount == 0) _violation("invalid amount or category");
        uint256 c = g.category > 7 ? 7 : g.category;
        uint256 budget = s.rules.categoryBudgets[c];
        if (budget != 0 && ghostCategorySpent[c] + amount > budget) _violation("over category budget");
        uint256 today = _now() / 1 days;
        address p = g.proposer;
        uint256 daySpent = ghostDay[p] == today ? ghostDaySpent[p] : 0;
        if (s.rules.memberDailyCap != 0 && daySpent + amount > s.rules.memberDailyCap) _violation("over daily cap");
        if (s.rules.memberTotalCap != 0 && ghostTotalSpent[p] + amount > s.rules.memberTotalCap) {
            _violation("over total cap");
        }
        if (g.kind != SpendKind.PERSONAL && amount > s.balance) _violation("not enough money");
        address[] storage split = _gSplit[id];
        for (uint256 k; k < split.length; ++k) {
            uint256 i = _userIndexOr(split[k]);
            if (i == type(uint256).max || s.activeMask & (1 << i) == 0) _violation("split member not active");
        }
        (,,,, uint8 approvals, uint8 required,,) = pot.spendInfo(id);
        if (required != g.expectedRequired) _violation("approvalsRequired does not match tier");
        if (approvals < required) _violation("executed below approvals required");

        ghostCategorySpent[c] += amount;
        ghostDaySpent[p] = daySpent + amount;
        ghostDay[p] = today;
        ghostTotalSpent[p] += amount;
    }

    function _violation(string memory why) internal {
        ++ghostExecViolations;
        lastViolation = why;
    }

    function _remember(address target, bytes memory data) internal {
        if (_replays.length < MAX_REPLAYS) {
            _replays.push(Replay(target, data));
        } else {
            _replays[_replayCursor++ % MAX_REPLAYS] = Replay(target, data);
        }
    }

    function _stat(uint256 action) internal {
        ++_totalCalls;
        ++callCount[action];
    }

    // ───────────────────────────── internal: picking ─────────────────────────────

    function _pickActive(uint256 seed) internal view returns (uint256, bool) {
        for (uint256 k; k < N_USERS; ++k) {
            uint256 i = (seed + k) % N_USERS;
            if (pot.isMember(users[i])) return (i, true);
        }
        return (0, false);
    }

    function _findSpend(uint256 seed, ProposalStatus a, ProposalStatus b) internal view returns (uint256, bool) {
        uint256 n = pot.spendCount();
        for (uint256 k; k < n; ++k) {
            uint256 id = 1 + (seed + k) % n;
            (ProposalStatus st,,,,,,,) = pot.spendInfo(id);
            if (st == a || st == b) return (id, true);
        }
        return (0, false);
    }

    /// @dev An open claim most of the time; any claim 1 in 4 (NotOpen paths, double claim/refund).
    function _pickClaim(uint256 seed, uint256 n) internal view returns (uint256) {
        uint256 start = 1 + seed % n;
        if ((seed >> 64) % 4 == 0) return start;
        for (uint256 k; k < n; ++k) {
            uint256 id = 1 + (start - 1 + k) % n;
            (,,,,, ClaimEscrow.Status st) = escrow.claimInfo(id);
            if (st == ClaimEscrow.Status.Open) return id;
        }
        return start;
    }

    /// @dev A Pending/Approved spend (`want`) that has not expired yet.
    function _findLiveSpend(uint256 seed, ProposalStatus want) internal view returns (uint256, bool) {
        uint256 n = pot.spendCount();
        for (uint256 k; k < n; ++k) {
            uint256 id = 1 + (seed + k) % n;
            (ProposalStatus st,,,,,, uint64 expiresAt,) = pot.spendInfo(id);
            if (st == want && _now() <= expiresAt) return (id, true);
        }
        return (0, false);
    }

    function _pickNonVoter(uint256 seed, uint256 votedMask) internal view returns (uint256, bool) {
        for (uint256 k; k < N_USERS; ++k) {
            uint256 i = (seed + k) % N_USERS;
            if (votedMask & (1 << i) == 0 && pot.isMember(users[i])) return (i, true);
        }
        return (0, false);
    }

    function _findOpenDispute(uint256 seed) internal view returns (uint256, bool) {
        uint256 n = pot.disputeCount();
        for (uint256 k; k < n; ++k) {
            uint256 id = 1 + (seed + k) % n;
            (, DisputeOutcome outcome,,,) = pot.disputeInfo(id);
            if (outcome == DisputeOutcome.None) return (id, true);
        }
        return (0, false);
    }

    function _findRuleChange(uint256 seed, ProposalStatus want) internal view returns (uint256, bool) {
        uint256 n = pot.ruleChangeCount();
        for (uint256 k; k < n; ++k) {
            uint256 id = 1 + (seed + k) % n;
            (ProposalStatus st,,,,) = pot.ruleChangeInfo(id);
            if (st == want) return (id, true);
        }
        return (0, false);
    }

    /// @dev A random non-empty subset of active members with weights 1..5; 1 in 32 splits also
    /// includes an outsider (invalid).
    function _randomSplit(uint256 seed) internal view returns (address[] memory members, uint32[] memory weights) {
        address[] memory m = new address[](N_USERS + 1);
        uint32[] memory w = new uint32[](N_USERS + 1);
        uint256 n;
        for (uint256 i; i < N_USERS; ++i) {
            if (!pot.isMember(users[i]) || (seed >> i) & 1 == 0) continue;
            m[n] = users[i];
            w[n] = uint32(1 + (seed >> (16 + 4 * i)) % 5);
            ++n;
        }
        if (n == 0) {
            (uint256 u, bool found) = _pickActive(seed >> 100);
            m[0] = found ? users[u] : users[0];
            w[0] = 1;
            n = 1;
        }
        if ((seed >> 200) % 32 == 0) {
            m[n] = outsiders[0];
            w[n] = 1;
            ++n;
        }
        members = new address[](n);
        weights = new uint32[](n);
        for (uint256 k; k < n; ++k) {
            (members[k], weights[k]) = (m[k], w[k]);
        }
    }

    function _randomPayees(uint256 seed) internal view returns (address[] memory list) {
        uint256 n = seed % 3;
        list = new address[](n);
        for (uint256 k; k < n; ++k) {
            uint256 x = _h(seed, k);
            list[k] = x % 3 == 0 ? users[x % N_USERS] : outsiders[(x >> 8) % outsiders.length];
        }
    }

    function _randomRules(uint256 x) internal pure returns (Rules memory r) {
        uint64[4] memory instant = [uint64(0), uint64(10 * USD), uint64(25 * USD), uint64(50 * USD)];
        uint64[4] memory one = [uint64(0), uint64(100 * USD), uint64(200 * USD), type(uint64).max];
        uint64[4] memory daily = [uint64(0), uint64(100 * USD), uint64(150 * USD), uint64(400 * USD)];
        uint64[4] memory total = [uint64(0), uint64(300 * USD), uint64(800 * USD), uint64(0)];
        uint32[3] memory ttl = [uint32(1 hours), uint32(24 hours), uint32(3 days)];
        uint32[3] memory lock = [uint32(0), uint32(1 hours), uint32(1 days)];
        r.instantMax = instant[x % 4];
        r.oneApprovalMax = one[(x >> 4) % 4];
        r.highTier = HighTier((x >> 8) % 2);
        r.memberDailyCap = daily[(x >> 12) % 4];
        r.memberTotalCap = total[(x >> 16) % 4];
        r.payeePolicy = PayeePolicy((x >> 20) % 3);
        r.minContribution = (x >> 24) % 6 == 0 ? uint64(100 * USD) : 0;
        r.proposalTtl = (x >> 28) % 32 == 0 ? 0 : ttl[(x >> 36) % 3]; // 0 is invalid
        r.ruleTimelock = lock[(x >> 40) % 3];
        for (uint256 c; c < 8; ++c) {
            uint256 b = (x >> (48 + 4 * c)) % 6;
            r.categoryBudgets[c] = b == 0 ? uint64(100 * USD) : b == 1 ? uint64(400 * USD) : 0;
        }
    }

    function _amount(uint256 x) internal pure returns (uint256) {
        uint256 t = x % 8;
        if (t < 3) return _between(x >> 8, 1, 25 * USD);
        if (t < 5) return _between(x >> 8, 25 * USD, 120 * USD);
        if (t < 7) return _between(x >> 8, 100 * USD, 400 * USD);
        return (x >> 128) % 4 == 0 ? 0 : _between(x >> 8, 1, 2000 * USD);
    }

    function _setSplitTo(uint256 spendId, address member) internal {
        delete _gSplit[spendId];
        _gSplit[spendId].push(member);
    }

    function _indexOfKey(address key) internal view returns (uint256) {
        for (uint256 k; k < claimKeys.length; ++k) {
            if (claimKeys[k] == key) return k;
        }
        return 0;
    }

    function _userIndexOr(address account) internal view returns (uint256) {
        for (uint256 i; i < N_USERS; ++i) {
            if (users[i] == account) return i;
        }
        return type(uint256).max;
    }

    function _now() internal view returns (uint256) {
        return vm.getBlockTimestamp();
    }

    function _h(uint256 seed, uint256 salt) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed, salt)));
    }

    function _between(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256) {
        return lo + x % (hi - lo + 1);
    }
}

interface IERC20Allowance {
    function allowance(address owner, address spender) external view returns (uint256);
}
