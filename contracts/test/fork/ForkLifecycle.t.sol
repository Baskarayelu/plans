// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PlansBase} from "../utils/PlansBase.sol";
import {PlansSigs} from "../utils/PlansSigs.sol";
import {IAUSD, IPlansSend} from "../../src/interfaces/IPlansPeriphery.sol";
import {Vm} from "forge-std/Vm.sol";
import {ClaimEscrow} from "../../src/ClaimEscrow.sol";
import {FxReference} from "../../src/FxReference.sol";
import {Pot} from "../../src/Pot.sol";
import {PlansSend} from "../../src/PlansSend.sol";
import {IFxReference} from "../../src/interfaces/IFxReference.sol";
import {IPot} from "../../src/interfaces/IPot.sol";

/// @notice Runs Plans against the real AUSD on a Monad fork.
///
/// The fork is created in `setUp`. Every test in the suite is skipped (not failed) when:
///  - `SKIP_FORK_TESTS=true` is set,
///  - the RPC alias (foundry.toml `[rpc_endpoints]`) cannot be reached, or
///  - the forked chain is not the expected one, or AUSD has no code there.
///
/// Balances are written straight into AUSD's storage, because forge-std `deal` cannot write them
/// (it fails with "Failed to write value"). AUSD (proxy 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a,
/// implementation 0xc1e3c7d486d6a92fbe920232e439eec2ceb112da; the testnet proxy uses the same
/// implementation) keeps its ERC-20 state in an ERC-7201 namespace:
///   base + 0: mapping(address => AccountData) with AccountData packed as `balance << 8 | isFrozen`
///   base + 2: totalSupply (uint256)
/// `setUp` checks the totalSupply slot and `_fund` checks `balanceOf` after every write, so a change
/// to the token's layout shows up as a failing test.
abstract contract AUSDForkBase is PlansBase {
    bytes32 internal constant AUSD_ERC20_BASE = 0x455730fed596673e69db1907be2e521374ba893f1a04cc5f5dd931616cd6b700;
    bytes32 internal constant AUSD_TOTAL_SUPPLY_SLOT =
        0x455730fed596673e69db1907be2e521374ba893f1a04cc5f5dd931616cd6b702;

    function _rpcAlias() internal pure virtual returns (string memory);
    function _expectedChainId() internal pure virtual returns (uint256);
    function _ausd() internal pure virtual returns (address);
    /// @dev Chainlink's MockKeystoneForwarder (the CRE simulation forwarder) on this chain.
    function _simForwarder() internal pure virtual returns (address);
    function _chainSelector() internal pure virtual returns (uint64);

    function setUp() public virtual override {
        if (vm.envOr("SKIP_FORK_TESTS", false)) vm.skip(true, "SKIP_FORK_TESTS is set");
        try vm.createSelectFork(_rpcAlias()) returns (uint256) {}
        catch {
            vm.skip(true, string.concat("RPC unreachable: ", _rpcAlias()));
        }
        if (block.chainid != _expectedChainId()) vm.skip(true, "unexpected chain id");
        if (_ausd().code.length == 0) vm.skip(true, "AUSD not deployed on this chain");

        super.setUp();

        assertEq(
            uint256(vm.load(token, AUSD_TOTAL_SUPPLY_SLOT)),
            IERC20Supply(token).totalSupply(),
            "AUSD storage layout: totalSupply slot"
        );
    }

    function _deployToken() internal pure override returns (address) {
        return _ausd();
    }

    /// @dev Adds `amount` to `to`'s AUSD balance (keeping its frozen flag) and to totalSupply.
    function _fund(address to, uint256 amount) internal override {
        bytes32 slot = keccak256(abi.encode(to, AUSD_ERC20_BASE));
        uint256 raw = uint256(vm.load(token, slot));
        uint256 before = raw >> 8;
        vm.store(token, slot, bytes32(((before + amount) << 8) | (raw & 0xff)));
        vm.store(token, AUSD_TOTAL_SUPPLY_SLOT, bytes32(uint256(vm.load(token, AUSD_TOTAL_SUPPLY_SLOT)) + amount));
        assertEq(_balance(to), before + amount, "AUSD storage layout: balance slot");
    }

    /// @dev Sets or clears AUSD's own per-account frozen flag (low byte of the packed balance word).
    function _setFrozen(address who, bool frozen) internal {
        bytes32 slot = keccak256(abi.encode(who, AUSD_ERC20_BASE));
        uint256 raw = uint256(vm.load(token, slot));
        vm.store(token, slot, bytes32((raw & ~uint256(0xff)) | (frozen ? 1 : 0)));
    }

    // ─────────────── shared fork tests ───────────────

    /// @notice F1 with the real AUSD freeze flag: a creditor frozen at settlement is skipped, the
    /// claim is refused while frozen, and `collect` pays it (and only it) once AUSD unfreezes.
    function test_fork_collectFrozenThenUnfrozenCreditor() public {
        Pot pot = _createPot(0, _params(_balancedRules()), 20 * USD);
        _join(pot, 1, 10 * USD);
        _setFrozen(users[1], true);
        vm.expectRevert(); // real AUSD refuses a transfer to a frozen account
        IAUSD(token).transfer(users[1], 0);
        _ackAll(pot);
        pot.settle();
        assertEq(_balance(users[0]), 20 * USD, "alice paid");
        assertEq(pot.netOf(users[1]), int256(10 * USD), "bob's payout skipped and kept");
        assertEq(_balance(address(pot)), 10 * USD);
        _assertI1(pot);

        vm.expectRevert(Pot.PayoutRefused.selector);
        pot.collect(users[1]);

        _setFrozen(users[1], false);
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        pot.collect(users[1]);
        assertEq(_balance(users[1]), 10 * USD, "bob collected");
        assertEq(_balance(users[0]), 20 * USD, "alice unchanged");
        assertEq(_balance(stranger), 0);
        assertEq(_balance(address(pot)), 0, "pot drained");
        assertEq(pot.netOf(users[1]), 0);
        _assertI1(pot);
    }

    /// @notice FxReference fed through Chainlink's real MockKeystoneForwarder on the fork, exactly as
    /// `cre workflow simulate --broadcast` delivers: report() from the configured transmitter writes
    /// a round; the same call from anyone else is refused by the tx.origin guard (the mock swallows
    /// the revert and emits ReportProcessed(false)).
    function test_fork_fxReferenceThroughSimulationForwarder() public {
        address mock = _simForwarder();
        assertGt(mock.code.length, 0, "MockKeystoneForwarder deployed");
        address transmitter = makeAddr("cre transmitter");
        FxReference fxr = new FxReference(makeAddr("fx owner"), mock, transmitter, _chainSelector());
        uint64[] memory r = _fxRates();
        bytes memory payload = abi.encode(
            _chainSelector(), uint64(vm.getBlockTimestamp()), uint32(20261006), _fxCurrencies(), r, _fxMasks(r)
        );
        bytes memory raw = abi.encodePacked(
            bytes1(0x01), keccak256("exec-1"), bytes4(0), bytes4(uint32(1)), bytes4(uint32(1))
        );
        raw = abi.encodePacked(raw, bytes32(uint256(0x1111)), bytes10("fxrefwf"), address(0xAAAA), bytes2(0x0001), payload);

        // A stranger: not written.
        address mallory = makeAddr("mallory");
        vm.prank(mallory, mallory);
        IMockForwarder(mock).report(address(fxr), raw, "", new bytes[](0));
        assertEq(fxr.latestRoundId(), 0, "stranger's report refused");

        // The configured transmitter: written.
        vm.recordLogs();
        vm.prank(transmitter, transmitter);
        IMockForwarder(mock).report(address(fxr), raw, "", new bytes[](0));
        assertEq(fxr.latestRoundId(), 1, "round written through the mock forwarder");
        assertEq(fxr.rateOf(1, "GBP"), r[0]);
        assertEq(fxr.rateOf(1, "INR"), r[2]);
        bool sawRound;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(fxr) && logs[i].topics[0] == IFxReference.RoundWritten.selector) sawRound = true;
        }
        assertTrue(sawRound, "RoundWritten");

        // Replaying the same report through the forwarder (which does not dedupe in the mock) is refused.
        vm.prank(transmitter, transmitter);
        IMockForwarder(mock).report(address(fxr), raw, "", new bytes[](0));
        assertEq(fxr.latestRoundId(), 1, "replay refused");
    }

    /// @notice A send that names a fresh round records the reference rate; settlement records it too.
    function test_fork_sendAndSettleWithFxRound() public {
        uint64 id = _writeFxRound();
        _fund(users[3], 9 * USD);
        IPlansSend.SendMeta memory meta = IPlansSend.SendMeta({
            to: users[11],
            fromCountry: "GB",
            toCountry: "IN",
            fromCurrency: "GBP",
            toCurrency: "INR",
            fxRateE8: 127_50000000,
            fxTimestamp: uint64(vm.getBlockTimestamp()),
            fxRoundId: id,
            memoHash: keccak256("fx"),
            salt: keccak256("fx-salt")
        });
        Auth3009 memory auth = PlansSigs.receiveAuth(pks[3], token, address(sender), 9 * USD, keccak256(abi.encode(meta)));
        (uint256 ref, int256 diff) = sender.previewReference(meta);
        assertEq(ref, uint256(fx.rateOf(id, "GBP")) * 1e8 / fx.rateOf(id, "INR"));
        vm.expectEmit(address(sender));
        emit IPlansSend.Sent(
            users[3], users[11], 9 * USD, "GB", "IN", "GBP", "INR", 127_50000000, meta.fxTimestamp, keccak256("fx"), id, ref, diff
        );
        sender.send(users[3], meta, auth);
        assertEq(_balance(users[11]), 9 * USD);

        Pot pot = _createPot(0, _params(_balancedRules()), 5 * USD);
        _ackAll(pot);
        vm.expectEmit(address(pot));
        emit IPot.Settled(address(this), 5 * USD, 0, 0, id);
        pot.settle();

        vm.warp(vm.getBlockTimestamp() + 6 hours + 1);
        meta.salt = keccak256("fx-salt-2");
        _fund(users[3], 1 * USD);
        auth = PlansSigs.receiveAuth(pks[3], token, address(sender), 1 * USD, keccak256(abi.encode(meta)));
        vm.expectRevert(abi.encodeWithSelector(PlansSend.FxRoundStale.selector, id, fx.roundTime(id)));
        sender.send(users[3], meta, auth);
    }

    // ─────────────── helpers ───────────────

    function _keyReg(uint256 u, bytes32 pubKey) internal view returns (KeyReg memory k) {
        k.pubKey = pubKey;
        k.deadline = _deadline();
        k.signature = PlansSigs.registerKey(pks[u], address(registry), users[u], pubKey, k.deadline);
    }

    function _permit(Pot pot, uint256 u, uint256 value) internal view returns (Permit2612 memory) {
        return PlansSigs.permit(pks[u], token, address(pot), value, _deadline());
    }

    /// @dev Join with a 3009 deposit, an ERC-2612 safety-net permit and a KeyRegistry registration.
    function _joinFull(Pot pot, uint256 u, uint256 deposit, uint256 safetyNet, bytes32 pubKey) internal {
        _joinWith(pot, u, deposit, _permit(pot, u, safetyNet), _keyReg(u, pubKey));
        assertTrue(pot.isMember(users[u]), "joined");
        assertEq(IAUSD(token).allowance(users[u], address(pot)), safetyNet, "safety-net allowance");
        assertEq(registry.keyOf(users[u]), pubKey, "key registered");
    }

    function _status(Pot pot, uint256 id) internal view returns (ProposalStatus status) {
        (status,,,,,,,) = pot.spendInfo(id);
    }

    function _assertDomain() internal view {
        assertEq(
            IAUSD(token).DOMAIN_SEPARATOR(),
            PlansSigs.domainSeparator("Agora Dollar", token),
            "AUSD EIP-712 domain is {Agora Dollar, 1, chainid, token}"
        );
        assertEq(IERC20Supply(token).decimals(), 6, "AUSD decimals");
    }
}

/// @notice Monad mainnet (chain 143), real AUSD.
contract ForkLifecycleMainnetTest is AUSDForkBase {
    function _rpcAlias() internal pure override returns (string memory) {
        return "monad";
    }

    function _expectedChainId() internal pure override returns (uint256) {
        return 143;
    }

    function _ausd() internal pure override returns (address) {
        return 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a;
    }

    function _simForwarder() internal pure override returns (address) {
        return 0x9eF6468C5f37b976E57d52054c693269479A784d;
    }

    function _chainSelector() internal pure override returns (uint64) {
        return 8481857512324358265;
    }

    function test_fork_ausdDomain() public view {
        _assertDomain();
    }

    function test_fork_fullLifecycle() public {
        // ── createPot with the creator's 3009 deposit ──
        Pot pot = _createPot(0, _params(_balancedRules()), 100 * USD);
        assertTrue(factory.isPot(address(pot)));
        assertEq(_balance(address(pot)), 100 * USD);
        _assertI1(pot);

        // ── joins: 3009 deposit + ERC-2612 safety net + KeyRegistry ──
        _joinFull(pot, 1, 100 * USD, 100 * USD, keccak256("x25519-user1"));
        _assertI1(pot);
        _joinFull(pot, 2, 10 * USD, 100 * USD, keccak256("x25519-user2")); // the future debtor
        _assertI1(pot);
        assertEq(_balance(address(pot)), 210 * USD);

        // ── instant PAY ($20 <= instantMax $25): executes inside propose ──
        address business = users[9];
        uint256 id = _proposeEqual(pot, 0, SpendKind.PAY, business, 20 * USD, _users(3));
        assertEq(uint8(_status(pot, id)), uint8(ProposalStatus.Executed));
        assertEq(_balance(business), 20 * USD);
        _assertI1(pot);

        // ── PAY needing one other approval ($120 <= oneApprovalMax $200) ──
        id = _proposeEqual(pot, 1, SpendKind.PAY, business, 120 * USD, _users(3));
        assertEq(uint8(_status(pot, id)), uint8(ProposalStatus.Pending));
        _assertI1(pot);
        _vote(pot, 0, id, true);
        assertEq(uint8(_status(pot, id)), uint8(ProposalStatus.Executed));
        assertEq(_balance(business), 140 * USD);
        _assertI1(pot);

        // ── LINK spend into ClaimEscrow, claimed with the claim key ──
        (address claimKey, uint256 claimPk) = makeAddrAndKey("link-claim-key");
        id = _proposeEqual(pot, 0, SpendKind.LINK, claimKey, 15 * USD, _users(3));
        assertEq(uint8(_status(pot, id)), uint8(ProposalStatus.Executed));
        uint256 claimId = escrow.claimCount();
        {
            (address source, address signer, uint256 amount,, uint256 spendId, ClaimEscrow.Status st) =
                escrow.claimInfo(claimId);
            assertEq(source, address(pot));
            assertEq(signer, claimKey);
            assertEq(amount, 15 * USD);
            assertEq(spendId, id);
            assertEq(uint8(st), uint8(ClaimEscrow.Status.Open));
        }
        assertEq(_balance(address(escrow)), 15 * USD);
        _assertI1(pot); // escrowed money already left the pot
        escrow.claim(claimId, users[10], "US", PlansSigs.claim(claimPk, address(escrow), claimId, users[10], "US"));
        assertEq(_balance(users[10]), 15 * USD);
        assertEq(_balance(address(escrow)), 0);
        _assertI1(pot);

        // ── PlansSend: 3009 nonce = keccak256(abi.encode(meta)) ──
        _send(3, users[11], 7 * USD);
        _assertI1(pot);

        // ── Send-by-link: ClaimEscrow.createWithAuthorization + claim ──
        _sendByLink(4, users[5], 12 * USD);
        _assertI1(pot);

        // ── settle: user2 owes, and the debt is pulled through the permit allowance ──
        int256 debt = -pot.netOf(users[2]);
        assertGt(debt, 0, "user2 is a debtor");
        _fund(users[2], 100 * USD);
        uint256 debtorBefore = _balance(users[2]);
        uint256 c0 = _balance(users[0]);
        uint256 c1 = _balance(users[1]);
        int256 n0 = pot.netOf(users[0]);
        int256 n1 = pot.netOf(users[1]);

        _ackAll(pot);
        assertTrue(pot.canSettle());
        pot.settle();

        assertTrue(pot.settled());
        assertEq(_balance(address(pot)), 0, "pot empty after settle");
        _assertI1(pot);
        assertEq(debtorBefore - _balance(users[2]), uint256(debt), "debt pulled");
        assertEq(IAUSD(token).allowance(users[2], address(pot)), 100 * USD - uint256(debt));
        assertEq(_balance(users[0]) - c0, uint256(n0));
        assertEq(_balance(users[1]) - c1, uint256(n1));
        for (uint256 i; i < 3; ++i) {
            assertEq(pot.netOf(users[i]), 0);
        }
    }

    /// @notice A safety-net permit that was already used (front-run straight on AUSD) must not make
    /// `join` revert, because the allowance it set is still in place.
    function test_fork_joinSurvivesFrontRunPermit() public {
        Pot pot = _createPot(0, _params(_balancedRules()), 50 * USD);
        Permit2612 memory permit = _permit(pot, 1, 80 * USD);

        IAUSD(token).permit(users[1], address(pot), permit.value, permit.deadline, permit.v, permit.r, permit.s);
        assertEq(IAUSD(token).allowance(users[1], address(pot)), 80 * USD);
        // Real AUSD rejects the replay, which is what Pot has to tolerate.
        vm.expectRevert();
        IAUSD(token).permit(users[1], address(pot), permit.value, permit.deadline, permit.v, permit.r, permit.s);

        _joinWith(pot, 1, 30 * USD, permit, _keyReg(1, keccak256("x25519-user1")));
        assertTrue(pot.isMember(users[1]));
        assertEq(IAUSD(token).allowance(users[1], address(pot)), 80 * USD);
        assertEq(_balance(address(pot)), 80 * USD);
        _assertI1(pot);
    }

    /// @notice A used permit whose allowance has since been lowered does fail the join.
    function test_fork_joinRevertsWhenUsedPermitAllowanceTooLow() public {
        Pot pot = _createPot(0, _params(_balancedRules()), 0);
        Permit2612 memory permit = _permit(pot, 1, 80 * USD);
        IAUSD(token).permit(users[1], address(pot), permit.value, permit.deadline, permit.v, permit.r, permit.s);
        _approveSafetyNet(pot, 1, 1 * USD);

        uint256 nonce = _nonce();
        bytes memory memberSig = PlansSigs.join(pks[1], address(pot), users[1], "FR", permit.value, nonce, _deadline());
        bytes memory inviteSig = PlansSigs.invite(invitePk, address(pot), users[1]);
        Auth3009 memory dep = _noDeposit();
        KeyReg memory key = _noKey();
        uint256 deadline = _deadline();
        vm.expectRevert(Pot.PermitFailed.selector);
        pot.join(users[1], "FR", nonce, deadline, memberSig, inviteSig, dep, permit, key);
    }

    function _send(uint256 from, address to, uint256 amount) internal {
        _fund(users[from], amount);
        IPlansSend.SendMeta memory meta = IPlansSend.SendMeta({
            to: to,
            fromCountry: "GB",
            toCountry: "IN",
            fromCurrency: "GBP",
            toCurrency: "INR",
            fxRateE8: 112_50000000,
            fxTimestamp: uint64(vm.getBlockTimestamp()),
            fxRoundId: 0,
            memoHash: keccak256("dinner"),
            salt: keccak256("send-salt")
        });
        Auth3009 memory auth =
            PlansSigs.receiveAuth(pks[from], token, address(sender), amount, keccak256(abi.encode(meta)));
        uint256 before = _balance(to);
        sender.send(users[from], meta, auth);
        assertEq(_balance(to) - before, amount);
        assertEq(_balance(users[from]), 0);
        assertEq(_balance(address(sender)), 0, "PlansSend holds nothing");
    }

    function _sendByLink(uint256 from, address recipient, uint256 amount) internal {
        _fund(users[from], amount);
        (address claimKey, uint256 claimPk) = makeAddrAndKey("send-link-claim-key");
        uint64 expiry = uint64(vm.getBlockTimestamp() + 3 days);
        bytes2 fromCountry = "DE";
        bytes32 salt = keccak256("link-salt");
        Auth3009 memory auth = PlansSigs.receiveAuth(
            pks[from], token, address(escrow), amount, keccak256(abi.encode(claimKey, expiry, fromCountry, salt))
        );
        uint256 id = escrow.createWithAuthorization(users[from], claimKey, expiry, fromCountry, salt, auth);
        assertEq(_balance(address(escrow)), amount);
        assertEq(_balance(users[from]), 0);

        uint256 before = _balance(recipient);
        escrow.claim(id, recipient, "FR", PlansSigs.claim(claimPk, address(escrow), id, recipient, "FR"));
        assertEq(_balance(recipient) - before, amount);
        assertEq(_balance(address(escrow)), 0);
    }
}

/// @notice Monad testnet (chain 10143), real testnet AUSD.
contract ForkLifecycleTestnetTest is AUSDForkBase {
    function _rpcAlias() internal pure override returns (string memory) {
        return "monad_testnet";
    }

    function _expectedChainId() internal pure override returns (uint256) {
        return 10143;
    }

    function _ausd() internal pure override returns (address) {
        return 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    }

    function _simForwarder() internal pure override returns (address) {
        return 0xB9F79d863261869B234c481D1f9A7af84AeAd192;
    }

    function _chainSelector() internal pure override returns (uint64) {
        return 2183018362218727504;
    }

    function test_fork_ausdDomain() public view {
        _assertDomain();
    }

    function test_fork_joinWithDepositPermitAndKey() public {
        Pot pot = _createPot(0, _params(_balancedRules()), 40 * USD);
        _assertI1(pot);
        _joinFull(pot, 1, 25 * USD, 60 * USD, keccak256("x25519-user1"));
        assertEq(_balance(address(pot)), 65 * USD);
        _assertI1(pot);

        uint256 id = _proposeEqual(pot, 1, SpendKind.PAY, users[9], 10 * USD, _users(2));
        assertEq(uint8(_status(pot, id)), uint8(ProposalStatus.Executed));
        _assertI1(pot);
    }
}

interface IMockForwarder {
    function report(address receiver, bytes calldata rawReport, bytes calldata reportContext, bytes[] calldata signatures)
        external;
}

interface IERC20Supply {
    function totalSupply() external view returns (uint256);
    function decimals() external view returns (uint8);
}
