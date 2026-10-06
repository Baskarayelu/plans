// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {LibClone} from "solady/utils/LibClone.sol";
import {PlansBase} from "../utils/PlansBase.sol";
import {PlansSigs} from "../utils/PlansSigs.sol";
import {MockAUSD} from "../mocks/MockAUSD.sol";
import {MockERC1271Wallet} from "../mocks/MockERC1271Wallet.sol";
import {IAUSD, IClaimEscrow, IKeyRegistry, IPlansFactory, IPlansSend} from "../../src/interfaces/IPlansPeriphery.sol";
import {ClaimEscrow} from "../../src/ClaimEscrow.sol";
import {KeyRegistry} from "../../src/KeyRegistry.sol";
import {PlansFactory} from "../../src/PlansFactory.sol";
import {PlansSend} from "../../src/PlansSend.sol";
import {Pot} from "../../src/Pot.sol";

/// @notice PlansFactory, KeyRegistry, ClaimEscrow and PlansSend.
contract PeripheryTest is PlansBase {
    // ─────────────── factory ───────────────

    function test_factory_wiring() public view {
        assertEq(factory.ausd(), token);
        assertEq(factory.keyRegistry(), address(registry));
        assertEq(escrow.factory(), address(factory));
        assertEq(escrow.ausd(), token);
        assertEq(Pot(factory.potImplementation()).factory(), address(factory));
        assertEq(factory.claimEscrow(), vm.computeCreateAddress(address(factory), 1));
        assertEq(factory.potImplementation(), vm.computeCreateAddress(address(factory), 2));
    }

    function test_createPot_deploysRegistersAndEmits() public {
        CreatePotParams memory p = _params(_balancedRules());
        address predicted = factory.predictPot(users[0], p.salt);
        bytes32 salt = keccak256(abi.encode(users[0], p.salt));
        assertEq(predicted, LibClone.predictDeterministicAddress(factory.potImplementation(), salt, address(factory)));
        assertFalse(factory.isPot(predicted));

        vm.expectEmit(address(factory));
        emit IPlansFactory.PotCreated(
            predicted, users[0], p.startTime, p.endTime, p.reviewWindow, p.meta, p.inviteKeyWrap
        );
        Pot pot = _createPot(0, p, 0);
        assertEq(address(pot), predicted);
        assertTrue(factory.isPot(predicted));
        // Solady LibClone minimal proxy (0age's 44-byte ERC-1167 variant)
        bytes memory proxy =
            abi.encodePacked(hex"3d3d3d3d363d3d37363d73", factory.potImplementation(), hex"5af43d3d93803e602a57fd5bf3");
        assertEq(address(pot).code, proxy);
    }

    function test_createPot_withCreatorDepositPermitAndKey() public {
        CreatePotParams memory p = _params(_balancedRules());
        p.creatorSafetyNet = 300 * USD;
        address predicted = factory.predictPot(users[0], p.salt);
        _fund(users[0], 50 * USD);
        Auth3009 memory dep = _auth(pks[0], predicted, 50 * USD);
        Permit2612 memory permit = PlansSigs.permit(pks[0], token, predicted, 300 * USD, _deadline());
        KeyReg memory key = KeyReg(bytes32(uint256(0x1234)), _deadline(), "");
        key.signature = PlansSigs.registerKey(pks[0], address(registry), users[0], key.pubKey, key.deadline);
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.createPot(pks[0], address(factory), users[0], p, nonce, _deadline());

        Pot pot = Pot(factory.createPot(users[0], p, nonce, _deadline(), sig, dep, permit, key));
        assertEq(pot.netOf(users[0]), int256(50 * USD));
        assertEq(_balance(address(pot)), 50 * USD);
        assertEq(IAUSD(token).allowance(users[0], address(pot)), 300 * USD);
        assertEq(registry.keyOf(users[0]), key.pubKey);
        assertTrue(factory.usedNonce(users[0], nonce));
    }

    function test_createPot_usedPermitDoesNotRevert() public {
        CreatePotParams memory p = _params(_balancedRules());
        p.creatorSafetyNet = 300 * USD;
        address predicted = factory.predictPot(users[0], p.salt);
        Permit2612 memory permit = PlansSigs.permit(pks[0], token, predicted, 300 * USD, _deadline());
        IAUSD(token).permit(users[0], predicted, permit.value, permit.deadline, permit.v, permit.r, permit.s);
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.createPot(pks[0], address(factory), users[0], p, nonce, _deadline());
        factory.createPot(users[0], p, nonce, _deadline(), sig, _noDeposit(), permit, _noKey());
        assertTrue(factory.isPot(predicted));
    }

    function test_createPot_reverts() public {
        CreatePotParams memory p = _params(_balancedRules());
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.createPot(pks[0], address(factory), users[0], p, nonce, _deadline());

        vm.expectRevert(PlansFactory.InvalidSignature.selector);
        factory.createPot(users[1], p, nonce, _deadline(), sig, _noDeposit(), _noPermit(), _noKey());

        uint256 past = vm.getBlockTimestamp() - 1;
        vm.expectRevert(PlansFactory.SignatureExpired.selector);
        factory.createPot(users[0], p, nonce, past, sig, _noDeposit(), _noPermit(), _noKey());

        Permit2612 memory permit = PlansSigs.permit(pks[0], token, address(1), 5, _deadline());
        vm.expectRevert(PlansFactory.SafetyNetMismatch.selector);
        factory.createPot(users[0], p, nonce, _deadline(), sig, _noDeposit(), permit, _noKey());

        factory.createPot(users[0], p, nonce, _deadline(), sig, _noDeposit(), _noPermit(), _noKey());
        vm.expectRevert(PlansFactory.NonceAlreadyUsed.selector);
        factory.createPot(users[0], p, nonce, _deadline(), sig, _noDeposit(), _noPermit(), _noKey());
    }

    function test_createPot_failedPermitWithoutAllowanceReverts() public {
        CreatePotParams memory p = _params(_balancedRules());
        p.creatorSafetyNet = 5;
        Permit2612 memory permit = PlansSigs.permit(pks[0], token, factory.predictPot(users[0], p.salt), 5, _deadline());
        permit.s = bytes32(uint256(permit.s) ^ 1);
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.createPot(pks[0], address(factory), users[0], p, nonce, _deadline());
        vm.expectRevert(PlansFactory.PermitFailed.selector);
        factory.createPot(users[0], p, nonce, _deadline(), sig, _noDeposit(), permit, _noKey());
    }

    function test_createPot_sameSaltTwiceFails() public {
        CreatePotParams memory p = _params(_balancedRules());
        _createPot(0, p, 0);
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.createPot(pks[0], address(factory), users[0], p, nonce, _deadline());
        vm.expectRevert(LibClone.DeploymentFailed.selector);
        factory.createPot(users[0], p, nonce, _deadline(), sig, _noDeposit(), _noPermit(), _noKey());
        // the same salt is free for another creator
        _createPot(1, p, 0);
    }

    function test_createPot_erc1271Creator() public {
        MockERC1271Wallet wallet = new MockERC1271Wallet(users[3]);
        CreatePotParams memory p = _params(_balancedRules());
        uint256 nonce = _nonce();
        bytes memory sig = PlansSigs.createPot(pks[3], address(factory), address(wallet), p, nonce, _deadline());
        Pot pot =
            Pot(factory.createPot(address(wallet), p, nonce, _deadline(), sig, _noDeposit(), _noPermit(), _noKey()));
        assertTrue(pot.isMember(address(wallet)));
    }

    // ─────────────── key registry ───────────────

    function test_keyRegistry_register() public {
        bytes32 key = bytes32(uint256(7));
        uint256 deadline = _deadline();
        bytes memory sig = PlansSigs.registerKey(pks[1], address(registry), users[1], key, deadline);
        vm.expectEmit(address(registry));
        emit IKeyRegistry.KeyRegistered(users[1], key);
        registry.register(users[1], key, deadline, sig);
        assertEq(registry.keyOf(users[1]), key);
    }

    function test_keyRegistry_replayAndStaleRejected() public {
        bytes32 keyA = bytes32(uint256(7));
        bytes32 keyB = bytes32(uint256(8));
        uint256 d1 = _deadline();
        bytes memory sigA = PlansSigs.registerKey(pks[1], address(registry), users[1], keyA, d1);
        registry.register(users[1], keyA, d1, sigA);
        vm.expectRevert(KeyRegistry.StaleRegistration.selector);
        registry.register(users[1], keyA, d1, sigA);

        bytes memory sigB = PlansSigs.registerKey(pks[1], address(registry), users[1], keyB, d1 + 1);
        registry.register(users[1], keyB, d1 + 1, sigB);
        vm.expectRevert(KeyRegistry.StaleRegistration.selector);
        registry.register(users[1], keyA, d1, sigA); // cannot roll back to the older key
        assertEq(registry.keyOf(users[1]), keyB);
    }

    function test_keyRegistry_reverts() public {
        uint256 deadline = _deadline();
        bytes memory sig = PlansSigs.registerKey(pks[1], address(registry), users[1], bytes32(uint256(7)), deadline);
        vm.expectRevert(KeyRegistry.InvalidSignature.selector);
        registry.register(users[2], bytes32(uint256(7)), deadline, sig);
        vm.expectRevert(KeyRegistry.ZeroKey.selector);
        registry.register(users[1], 0, deadline, sig);
        vm.warp(deadline + 1);
        vm.expectRevert(KeyRegistry.SignatureExpired.selector);
        registry.register(users[1], bytes32(uint256(7)), deadline, sig);
    }

    // ─────────────── claim escrow ───────────────

    uint256 internal constant CLAIM_PK = 0xc1a1;

    function _sendByLink(uint256 amount, uint64 expiry, bytes32 salt) internal returns (uint256 id) {
        address claimKey = vm.addr(CLAIM_PK);
        if (_balance(users[0]) < amount) _fund(users[0], amount);
        bytes32 nonce = keccak256(abi.encode(claimKey, expiry, bytes2("GB"), salt));
        Auth3009 memory auth = PlansSigs.receiveAuth(pks[0], token, address(escrow), amount, nonce);
        id = escrow.createWithAuthorization(users[0], claimKey, expiry, "GB", salt, auth);
    }

    function test_escrow_createWithAuthorizationAndClaim() public {
        uint64 expiry = uint64(vm.getBlockTimestamp() + 3 days);
        _fund(users[0], 5 * USD);
        vm.expectEmit(address(escrow));
        emit IClaimEscrow.ClaimCreated(1, users[0], vm.addr(CLAIM_PK), 5 * USD, expiry, 0, "GB");
        uint256 id = _sendByLink(5 * USD, expiry, "s1");
        assertEq(_balance(address(escrow)), 5 * USD);

        bytes memory sig = PlansSigs.claim(CLAIM_PK, address(escrow), id, users[4], "IN");
        vm.expectRevert(ClaimEscrow.InvalidSignature.selector); // recipient is bound by the signature
        escrow.claim(id, users[5], "IN", sig);
        vm.expectEmit(address(escrow));
        emit IClaimEscrow.Claimed(id, users[4], "IN");
        escrow.claim(id, users[4], "IN", sig);
        assertEq(_balance(users[4]), 5 * USD);
        (,,,,, ClaimEscrow.Status st) = escrow.claimInfo(id);
        assertEq(uint8(st), uint8(ClaimEscrow.Status.Claimed));

        vm.expectRevert(ClaimEscrow.NotOpen.selector);
        escrow.claim(id, users[4], "IN", sig);
        vm.warp(expiry + 1);
        vm.expectRevert(ClaimEscrow.NotOpen.selector);
        escrow.refund(id);
    }

    function test_escrow_refundToSender() public {
        uint64 expiry = uint64(vm.getBlockTimestamp() + 3 days);
        uint256 id = _sendByLink(5 * USD, expiry, "s1");
        vm.expectRevert(ClaimEscrow.NotExpired.selector);
        escrow.refund(id);
        vm.warp(expiry);
        bytes memory sig = PlansSigs.claim(CLAIM_PK, address(escrow), id, users[4], "IN");
        escrow.claim(id, users[4], "IN", sig); // still claimable at expiry
        id = _sendByLink(5 * USD, expiry + 10, "s2");
        vm.warp(expiry + 11);
        sig = PlansSigs.claim(CLAIM_PK, address(escrow), id, users[4], "IN");
        vm.expectRevert(ClaimEscrow.ClaimExpired.selector);
        escrow.claim(id, users[4], "IN", sig);
        vm.expectEmit(address(escrow));
        emit IClaimEscrow.ClaimRefunded(id, users[0], 5 * USD);
        escrow.refund(id);
        assertEq(_balance(users[0]), 5 * USD);
    }

    function test_escrow_createWithAuthorization_reverts() public {
        address claimKey = vm.addr(CLAIM_PK);
        uint64 expiry = uint64(vm.getBlockTimestamp() + 1 days);
        _fund(users[0], 5 * USD);
        Auth3009 memory auth = PlansSigs.receiveAuth(pks[0], token, address(escrow), 5 * USD, bytes32("wrong"));
        vm.expectRevert(ClaimEscrow.NonceMismatch.selector);
        escrow.createWithAuthorization(users[0], claimKey, expiry, "GB", "s", auth);

        // terms that differ from what the nonce binds are rejected
        bytes32 nonce = keccak256(abi.encode(claimKey, expiry, bytes2("GB"), bytes32("s")));
        auth = PlansSigs.receiveAuth(pks[0], token, address(escrow), 5 * USD, nonce);
        vm.expectRevert(ClaimEscrow.NonceMismatch.selector);
        escrow.createWithAuthorization(users[0], users[9], expiry, "GB", "s", auth);

        uint64 past = uint64(vm.getBlockTimestamp());
        nonce = keccak256(abi.encode(claimKey, past, bytes2("GB"), bytes32("s")));
        auth = PlansSigs.receiveAuth(pks[0], token, address(escrow), 5 * USD, nonce);
        vm.expectRevert(ClaimEscrow.InvalidExpiry.selector);
        escrow.createWithAuthorization(users[0], claimKey, past, "GB", "s", auth);

        nonce = keccak256(abi.encode(address(0), expiry, bytes2("GB"), bytes32("s")));
        auth = PlansSigs.receiveAuth(pks[0], token, address(escrow), 5 * USD, nonce);
        vm.expectRevert(ClaimEscrow.ZeroAddress.selector);
        escrow.createWithAuthorization(users[0], address(0), expiry, "GB", "s", auth);

        nonce = keccak256(abi.encode(claimKey, expiry, bytes2("GB"), bytes32("s")));
        auth = PlansSigs.receiveAuth(pks[0], token, address(escrow), 0, nonce);
        vm.expectRevert(ClaimEscrow.ZeroAmount.selector);
        escrow.createWithAuthorization(users[0], claimKey, expiry, "GB", "s", auth);
    }

    function test_escrow_claimReverts() public {
        uint256 id = _sendByLink(5 * USD, uint64(vm.getBlockTimestamp() + 1 days), "s");
        bytes memory sig = PlansSigs.claim(CLAIM_PK, address(escrow), id, address(0), "IN");
        vm.expectRevert(ClaimEscrow.ZeroAddress.selector);
        escrow.claim(id, address(0), "IN", sig);
        sig = PlansSigs.claim(0xbad, address(escrow), id, users[4], "IN");
        vm.expectRevert(ClaimEscrow.InvalidSignature.selector);
        escrow.claim(id, users[4], "IN", sig);
        vm.expectRevert(ClaimEscrow.NotOpen.selector);
        escrow.claim(99, users[4], "IN", sig);
    }

    function test_escrow_createFromPotOnlyPots() public {
        vm.expectRevert(ClaimEscrow.NotPot.selector);
        escrow.createFromPot(users[1], 1, uint64(vm.getBlockTimestamp() + 1), 1);
    }

    // ─────────────── send ───────────────

    function _meta(address to) internal pure returns (IPlansSend.SendMeta memory m) {
        m = IPlansSend.SendMeta({
            to: to,
            fromCountry: "GB",
            toCountry: "IN",
            fromCurrency: "GBP",
            toCurrency: "INR",
            fxRateE8: 11_250_000_000,
            fxTimestamp: 1_700_000_000,
            memoHash: keccak256("rent"),
            salt: "x"
        });
    }

    function test_send() public {
        IPlansSend.SendMeta memory m = _meta(users[6]);
        _fund(users[0], 7 * USD);
        Auth3009 memory auth = PlansSigs.receiveAuth(pks[0], token, address(sender), 7 * USD, keccak256(abi.encode(m)));
        vm.expectEmit(address(sender));
        emit IPlansSend.Sent(
            users[0], users[6], 7 * USD, "GB", "IN", "GBP", "INR", 11_250_000_000, 1_700_000_000, keccak256("rent")
        );
        sender.send(users[0], m, auth);
        assertEq(_balance(users[6]), 7 * USD);
        assertEq(_balance(address(sender)), 0);
    }

    function test_send_reverts() public {
        IPlansSend.SendMeta memory m = _meta(users[6]);
        _fund(users[0], 7 * USD);
        Auth3009 memory auth = PlansSigs.receiveAuth(pks[0], token, address(sender), 7 * USD, keccak256(abi.encode(m)));
        m.to = users[7]; // a relayer cannot redirect the money
        vm.expectRevert(PlansSend.NonceMismatch.selector);
        sender.send(users[0], m, auth);

        m = _meta(address(0));
        auth = PlansSigs.receiveAuth(pks[0], token, address(sender), 7 * USD, keccak256(abi.encode(m)));
        vm.expectRevert(PlansSend.ZeroAddress.selector);
        sender.send(users[0], m, auth);

        m = _meta(users[6]);
        auth = PlansSigs.receiveAuth(pks[0], token, address(sender), 0, keccak256(abi.encode(m)));
        vm.expectRevert(PlansSend.ZeroAmount.selector);
        sender.send(users[0], m, auth);

        // AUSD rejects a direct receiveWithAuthorization front-run (caller must be the payee)
        auth = PlansSigs.receiveAuth(pks[0], token, address(sender), 7 * USD, keccak256(abi.encode(m)));
        vm.expectRevert(MockAUSD.CallerMustBePayee.selector);
        IAUSD(token)
            .receiveWithAuthorization(
                users[0], address(sender), auth.value, auth.validAfter, auth.validBefore, auth.nonce, auth.signature
            );
    }
}
