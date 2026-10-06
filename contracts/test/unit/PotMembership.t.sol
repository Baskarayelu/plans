// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PlansBase} from "../utils/PlansBase.sol";
import {PlansSigs} from "../utils/PlansSigs.sol";
import {MockERC1271Wallet} from "../mocks/MockERC1271Wallet.sol";
import {IPot} from "../../src/interfaces/IPot.sol";
import {IAUSD} from "../../src/interfaces/IPlansPeriphery.sol";
import {Pot} from "../../src/Pot.sol";

contract PotMembershipTest is PlansBase {
    Pot internal pot;

    function setUp() public override {
        super.setUp();
        pot = _createPot(0, _params(_balancedRules()), 0);
    }

    // ─────────────── initialize ───────────────

    function test_initialize_setsStateAndCreator() public view {
        assertEq(pot.factory(), address(factory));
        assertEq(pot.ausd(), token);
        assertEq(address(pot.claimEscrow()), address(escrow));
        assertEq(address(pot.keyRegistry()), address(registry));
        assertEq(pot.startTime(), vm.getBlockTimestamp());
        assertEq(pot.endTime(), vm.getBlockTimestamp() + 30 days);
        assertEq(pot.reviewWindow(), 1 days);
        assertEq(pot.inviteSigner(), inviteSigner);
        assertEq(pot.memberCount(), 1);
        assertTrue(pot.isMember(users[0]));
        assertEq(pot.activeMemberCount(), 1);
        assertEq(pot.members()[0], users[0]);
        assertEq(pot.getRules().instantMax, 25 * USD);
        assertEq(pot.rulesVersion(), 0);
        assertFalse(pot.settled());
    }

    function test_initialize_onlyFactory() public {
        CreatePotParams memory p = _params(_balancedRules());
        vm.expectRevert(Pot.NotFactory.selector);
        pot.initialize(users[1], p);
    }

    function test_initialize_onlyOnce() public {
        CreatePotParams memory p = _params(_balancedRules());
        vm.prank(address(factory));
        vm.expectRevert(Pot.AlreadyInitialized.selector);
        pot.initialize(users[1], p);
    }

    function test_initialize_implementationIsLocked() public {
        Pot impl = Pot(factory.potImplementation());
        CreatePotParams memory p = _params(_balancedRules());
        vm.prank(address(factory));
        vm.expectRevert(Pot.AlreadyInitialized.selector);
        impl.initialize(users[1], p);
    }

    function test_initialize_emitsEvents() public {
        CreatePotParams memory p = _params(_balancedRules());
        address predicted = factory.predictPot(users[1], p.salt);
        vm.expectEmit(predicted);
        emit IPot.RulesSet(0, p.rules);
        vm.expectEmit(predicted);
        emit IPot.MemberJoined(users[1], "GB", 0, 0);
        vm.expectEmit(predicted);
        emit IPot.KeyWrapped(users[1], users[1], p.creatorKeyWrap);
        _createPot(1, p, 0);
    }

    function test_initialize_pastStartIsNow() public {
        vm.warp(1000 days);
        CreatePotParams memory p = _params(_balancedRules());
        p.startTime = uint64(vm.getBlockTimestamp() - 1 days);
        Pot q = _createPot(1, p, 0);
        assertEq(q.startTime(), vm.getBlockTimestamp());
    }

    function test_initialize_rejectsBadSchedule() public {
        CreatePotParams memory p = _params(_balancedRules());
        p.endTime = uint64(vm.getBlockTimestamp() + 365 days + 1);
        _expectCreateRevert(1, p, Pot.InvalidSchedule.selector);

        p = _params(_balancedRules());
        p.startTime = uint64(vm.getBlockTimestamp() + 2 days);
        p.endTime = uint64(vm.getBlockTimestamp() + 1 days);
        _expectCreateRevert(1, p, Pot.InvalidSchedule.selector);

        p = _params(_balancedRules());
        p.startTime = uint64(vm.getBlockTimestamp() + 10 days);
        p.endTime = uint64(vm.getBlockTimestamp() + 10 days + 365 days);
        Pot q = _createPot(1, p, 0); // exactly 365 days is allowed
        assertEq(q.endTime() - q.startTime(), 365 days);
    }

    function test_initialize_rejectsZeroInviteSigner() public {
        CreatePotParams memory p = _params(_balancedRules());
        p.inviteSigner = address(0);
        _expectCreateRevert(1, p, Pot.ZeroAddress.selector);
    }

    function test_initialize_rejectsLongData() public {
        CreatePotParams memory p = _params(_balancedRules());
        p.meta = new bytes(513);
        _expectCreateRevert(1, p, Pot.DataTooLong.selector);
        p = _params(_balancedRules());
        p.creatorKeyWrap = new bytes(513);
        _expectCreateRevert(1, p, Pot.DataTooLong.selector);
        p = _params(_balancedRules());
        p.inviteKeyWrap = new bytes(513);
        _expectCreateRevert(1, p, Pot.DataTooLong.selector);
    }

    function test_initialize_rejectsZeroTtl() public {
        Rules memory r = _balancedRules();
        r.proposalTtl = 0;
        _expectCreateRevert(1, _params(r), Pot.InvalidRules.selector);
    }

    function _expectCreateRevert(uint256 u, CreatePotParams memory p, bytes4 selector) internal {
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.createPot(pks[u], address(factory), users[u], p, nonce, _deadline());
        vm.expectRevert(selector);
        factory.createPot(users[u], p, nonce, _deadline(), sig, _noDeposit(), _noPermit(), _noKey());
    }

    // ─────────────── join ───────────────

    function test_join_bare() public {
        vm.expectEmit(address(pot));
        emit IPot.MemberJoined(users[1], "FR", 0, 1);
        vm.expectEmit(address(pot));
        emit IPot.AcksReset(1);
        _join(pot, 1, 0);
        assertTrue(pot.isMember(users[1]));
        assertEq(pot.activeMemberCount(), 2);
        assertEq(pot.netOf(users[1]), 0);
    }

    function test_join_withDepositPermitAndKey() public {
        Permit2612 memory permit = PlansSigs.permit(pks[1], token, address(pot), 500 * USD, _deadline());
        KeyReg memory key = KeyReg(bytes32(uint256(0xabc)), _deadline(), "");
        key.signature = PlansSigs.registerKey(pks[1], address(registry), users[1], key.pubKey, key.deadline);
        _fund(users[1], 40 * USD);

        vm.expectEmit(address(pot));
        emit IPot.MemberJoined(users[1], "FR", 500 * USD, 1);
        vm.expectEmit(address(pot));
        emit IPot.Contributed(users[1], 40 * USD);
        _joinWith(pot, 1, 40 * USD, permit, key);

        assertEq(pot.netOf(users[1]), int256(40 * USD));
        assertEq(_balance(address(pot)), 40 * USD);
        assertEq(IAUSD(token).allowance(users[1], address(pot)), 500 * USD);
        assertEq(registry.keyOf(users[1]), key.pubKey);
        _assertI1(pot);
    }

    function test_join_usedPermitDoesNotRevert() public {
        Permit2612 memory permit = PlansSigs.permit(pks[1], token, address(pot), 500 * USD, _deadline());
        IAUSD(token).permit(users[1], address(pot), permit.value, permit.deadline, permit.v, permit.r, permit.s);
        _joinWith(pot, 1, 0, permit, _noKey());
        assertTrue(pot.isMember(users[1]));
    }

    function test_join_failedPermitWithoutAllowanceReverts() public {
        Permit2612 memory permit = PlansSigs.permit(pks[1], token, address(pot), 500 * USD, _deadline());
        permit.s = bytes32(uint256(permit.s) ^ 1);
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.join(pks[1], address(pot), users[1], "FR", permit.value, nonce, _deadline());
        bytes memory inv = PlansSigs.invite(invitePk, address(pot), users[1]);
        vm.expectRevert(Pot.PermitFailed.selector);
        pot.join(users[1], "FR", nonce, _deadline(), sig, inv, _noDeposit(), permit, _noKey());
    }

    function test_join_alreadyRegisteredKeyIsSkipped() public {
        KeyReg memory key = KeyReg(bytes32(uint256(0xabc)), _deadline(), "");
        key.signature = PlansSigs.registerKey(pks[1], address(registry), users[1], key.pubKey, key.deadline);
        registry.register(users[1], key.pubKey, key.deadline, key.signature); // front-run
        _joinWith(pot, 1, 0, _noPermit(), key);
        assertEq(registry.keyOf(users[1]), key.pubKey);
    }

    function test_join_revertsWithBadInvite() public {
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.join(pks[1], address(pot), users[1], "FR", 0, nonce, _deadline());
        bytes memory inv = PlansSigs.invite(pks[2], address(pot), users[1]);
        vm.expectRevert(Pot.InvalidInvite.selector);
        pot.join(users[1], "FR", nonce, _deadline(), sig, inv, _noDeposit(), _noPermit(), _noKey());

        // an invite for someone else does not work either
        inv = PlansSigs.invite(invitePk, address(pot), users[2]);
        vm.expectRevert(Pot.InvalidInvite.selector);
        pot.join(users[1], "FR", nonce, _deadline(), sig, inv, _noDeposit(), _noPermit(), _noKey());
    }

    function test_join_revertsWithBadMemberSig() public {
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.join(pks[2], address(pot), users[1], "FR", 0, nonce, _deadline());
        bytes memory inv = PlansSigs.invite(invitePk, address(pot), users[1]);
        vm.expectRevert(Pot.InvalidSignature.selector);
        pot.join(users[1], "FR", nonce, _deadline(), sig, inv, _noDeposit(), _noPermit(), _noKey());
    }

    function test_join_revertsWhenAlreadyMember() public {
        _join(pot, 1, 0);
        vm.expectRevert(Pot.AlreadyMember.selector);
        _join(pot, 1, 0);
    }

    function test_join_revertsForExitedMember() public {
        _join(pot, 1, 0);
        _exit(pot, 1);
        vm.expectRevert(Pot.AlreadyMember.selector);
        _join(pot, 1, 0);
    }

    function test_join_revertsWhenFull() public {
        for (uint256 i = 1; i < 50; ++i) {
            address m = vm.addr(1000 + i);
            _joinRaw(1000 + i, m);
        }
        assertEq(pot.memberCount(), 50);
        vm.expectRevert(Pot.PotFull.selector);
        _join(pot, 1, 0);
    }

    function test_join_exitedMembersKeepTheirSlot() public {
        for (uint256 i = 1; i < 50; ++i) {
            _joinRaw(1000 + i, vm.addr(1000 + i));
        }
        uint256 nonce = _nonce();
        pot.exit(
            vm.addr(1001),
            nonce,
            _deadline(),
            PlansSigs.memberAction(1001, address(pot), "Exit", vm.addr(1001), nonce, _deadline())
        );
        assertEq(pot.activeMemberCount(), 49);
        vm.expectRevert(Pot.PotFull.selector);
        _join(pot, 1, 0);
    }

    function test_join_revertsWhenSettled() public {
        vm.warp(pot.endTime() + pot.reviewWindow());
        pot.settle();
        vm.expectRevert(Pot.PotSettled.selector);
        _join(pot, 1, 0);
    }

    function test_join_rotatedInviteStopsOldLinks() public {
        (address newSigner, uint256 newPk) = makeAddrAndKey("invite2");
        uint256 nonce = _nonce();
        pot.rotateInvite(
            users[0],
            newSigner,
            nonce,
            _deadline(),
            PlansSigs.rotateInvite(pks[0], address(pot), users[0], newSigner, nonce, _deadline())
        );
        vm.expectRevert(Pot.InvalidInvite.selector);
        _join(pot, 1, 0);

        nonce = _nonce();
        bytes memory sig = PlansSigs.join(pks[1], address(pot), users[1], "FR", 0, nonce, _deadline());
        bytes memory inv = PlansSigs.invite(newPk, address(pot), users[1]);
        pot.join(users[1], "FR", nonce, _deadline(), sig, inv, _noDeposit(), _noPermit(), _noKey());
        assertTrue(pot.isMember(users[1]));
    }

    function test_join_erc1271Member() public {
        MockERC1271Wallet wallet = new MockERC1271Wallet(users[5]);
        address member = address(wallet);
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.join(pks[5], address(pot), member, "US", 0, nonce, _deadline());
        bytes memory inv = PlansSigs.invite(invitePk, address(pot), member);
        pot.join(member, "US", nonce, _deadline(), sig, inv, _noDeposit(), _noPermit(), _noKey());
        assertTrue(pot.isMember(member));
    }

    function _joinRaw(uint256 pk, address m) internal {
        uint256 nonce = _nonce();
        pot.join(
            m,
            "DE",
            nonce,
            _deadline(),
            PlansSigs.join(pk, address(pot), m, "DE", 0, nonce, _deadline()),
            PlansSigs.invite(invitePk, address(pot), m),
            _noDeposit(),
            _noPermit(),
            _noKey()
        );
    }

    // ─────────────── signatures and nonces ───────────────

    function test_signature_expiredDeadline() public {
        _join(pot, 1, 0);
        uint256 nonce = _nonce();
        uint256 deadline = vm.getBlockTimestamp() - 1;
        bytes memory sig = PlansSigs.memberAction(pks[1], address(pot), "Ack", users[1], nonce, deadline);
        vm.expectRevert(Pot.SignatureExpired.selector);
        pot.ack(users[1], nonce, deadline, sig);
    }

    function test_signature_nonceCannotBeReused() public {
        _join(pot, 1, 0);
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.memberAction(pks[1], address(pot), "Freeze", users[1], nonce, _deadline());
        assertFalse(pot.usedNonce(users[1], nonce));
        pot.freeze(users[1], nonce, _deadline(), sig);
        assertTrue(pot.usedNonce(users[1], nonce));
        vm.expectRevert(Pot.NonceAlreadyUsed.selector);
        pot.freeze(users[1], nonce, _deadline(), sig);
        // the same nonce under another type is also spent
        sig = PlansSigs.memberAction(pks[1], address(pot), "Ack", users[1], nonce, _deadline());
        vm.expectRevert(Pot.NonceAlreadyUsed.selector);
        pot.ack(users[1], nonce, _deadline(), sig);
    }

    function test_signature_unorderedNonces() public {
        uint256 base = 7 << 8;
        uint256[3] memory order = [base + 2, base, base + 1];
        for (uint256 k; k < 3; ++k) {
            uint256 nonce = order[k];
            pot.rotateInvite(
                users[0],
                inviteSigner,
                nonce,
                _deadline(),
                PlansSigs.rotateInvite(pks[0], address(pot), users[0], inviteSigner, nonce, _deadline())
            );
        }
        assertTrue(pot.usedNonce(users[0], base));
        assertTrue(pot.usedNonce(users[0], base + 2));
        assertFalse(pot.usedNonce(users[0], base + 3));
        assertFalse(pot.usedNonce(users[1], base));
    }

    function test_signature_wrongSignerRejected() public {
        _join(pot, 1, 0);
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.memberAction(pks[2], address(pot), "Ack", users[1], nonce, _deadline());
        vm.expectRevert(Pot.InvalidSignature.selector);
        pot.ack(users[1], nonce, _deadline(), sig);
    }

    function test_signature_otherPotDomainRejected() public {
        _join(pot, 1, 0);
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.memberAction(pks[1], address(0xbeef), "Ack", users[1], nonce, _deadline());
        vm.expectRevert(Pot.InvalidSignature.selector);
        pot.ack(users[1], nonce, _deadline(), sig);
    }

    function test_signature_compactSignatureAccepted() public {
        _join(pot, 1, 0);
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.memberAction(pks[1], address(pot), "Ack", users[1], nonce, _deadline());
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        bytes32 vs = bytes32(uint256(s) | (uint256(v - 27) << 255));
        pot.ack(users[1], nonce, _deadline(), abi.encodePacked(r, vs));
        assertTrue(pot.usedNonce(users[1], nonce));
    }

    // ─────────────── contribute ───────────────

    function test_contribute() public {
        _fund(users[0], 10 * USD);
        Auth3009 memory auth = _auth(pks[0], address(pot), 10 * USD);
        vm.expectEmit(address(pot));
        emit IPot.Contributed(users[0], 10 * USD);
        pot.contribute(users[0], auth);
        assertEq(pot.netOf(users[0]), int256(10 * USD));
        _assertI1(pot);
    }

    function test_contribute_revertsForNonMemberZeroOrSettled() public {
        _fund(users[1], 10 * USD);
        Auth3009 memory auth = _auth(pks[1], address(pot), 10 * USD);
        vm.expectRevert(Pot.NotActiveMember.selector);
        pot.contribute(users[1], auth);

        auth = _auth(pks[0], address(pot), 0);
        vm.expectRevert(Pot.InvalidAmount.selector);
        pot.contribute(users[0], auth);

        vm.warp(pot.endTime() + pot.reviewWindow());
        pot.settle();
        auth = _auth(pks[0], address(pot), 1);
        vm.expectRevert(Pot.PotSettled.selector);
        pot.contribute(users[0], auth);
    }

    function test_contribute_authMustNameTheMember() public {
        _join(pot, 1, 0);
        _fund(users[1], 10 * USD);
        Auth3009 memory auth = _auth(pks[1], address(pot), 10 * USD);
        vm.expectRevert(); // AUSD rejects: the signature is from users[1], not users[0]
        pot.contribute(users[0], auth);
    }

    // ─────────────── rotateInvite / postKeyWraps ───────────────

    function test_rotateInvite() public {
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.rotateInvite(pks[0], address(pot), users[0], users[9], nonce, _deadline());
        vm.expectEmit(address(pot));
        emit IPot.InviteRotated(users[0], users[9]);
        pot.rotateInvite(users[0], users[9], nonce, _deadline(), sig);
        assertEq(pot.inviteSigner(), users[9]);
    }

    function test_rotateInvite_reverts() public {
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.rotateInvite(pks[0], address(pot), users[0], address(0), nonce, _deadline());
        vm.expectRevert(Pot.ZeroAddress.selector);
        pot.rotateInvite(users[0], address(0), nonce, _deadline(), sig);

        sig = PlansSigs.rotateInvite(pks[1], address(pot), users[1], users[9], nonce, _deadline());
        vm.expectRevert(Pot.NotActiveMember.selector);
        pot.rotateInvite(users[1], users[9], nonce, _deadline(), sig);
    }

    function test_postKeyWraps() public {
        KeyWrap[] memory wraps = new KeyWrap[](2);
        wraps[0] = KeyWrap(users[1], hex"01");
        wraps[1] = KeyWrap(users[2], hex"0202");
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.postKeyWraps(pks[0], address(pot), users[0], wraps, nonce, _deadline());
        vm.expectEmit(address(pot));
        emit IPot.KeyWrapped(users[1], users[0], hex"01");
        vm.expectEmit(address(pot));
        emit IPot.KeyWrapped(users[2], users[0], hex"0202");
        pot.postKeyWraps(users[0], wraps, nonce, _deadline(), sig);
    }

    function test_postKeyWraps_reverts() public {
        KeyWrap[] memory wraps = new KeyWrap[](1);
        wraps[0] = KeyWrap(users[1], new bytes(513));
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.postKeyWraps(pks[0], address(pot), users[0], wraps, nonce, _deadline());
        vm.expectRevert(Pot.DataTooLong.selector);
        pot.postKeyWraps(users[0], wraps, nonce, _deadline(), sig);

        wraps = new KeyWrap[](51);
        sig = PlansSigs.postKeyWraps(pks[0], address(pot), users[0], wraps, nonce, _deadline());
        vm.expectRevert(Pot.TooManyEntries.selector);
        pot.postKeyWraps(users[0], wraps, nonce, _deadline(), sig);

        wraps = new KeyWrap[](0);
        sig = PlansSigs.postKeyWraps(pks[1], address(pot), users[1], wraps, nonce, _deadline());
        vm.expectRevert(Pot.NotActiveMember.selector);
        pot.postKeyWraps(users[1], wraps, nonce, _deadline(), sig);
    }

    // ─────────────── views ───────────────

    function test_views_unknownMember() public view {
        assertEq(pot.netOf(users[7]), 0);
        assertFalse(pot.isMember(users[7]));
    }
}
