// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {PlansBase} from "../utils/PlansBase.sol";
import {PlansSigs} from "../utils/PlansSigs.sol";
import {MockFxReference} from "../mocks/MockFxReference.sol";
import {IPot} from "../../src/interfaces/IPot.sol";
import {IPlansSend} from "../../src/interfaces/IPlansPeriphery.sol";
import {PlansFactory} from "../../src/PlansFactory.sol";
import {PlansSend} from "../../src/PlansSend.sol";
import {Pot} from "../../src/Pot.sol";

/// @notice FX reference rounds on receipts: PlansSend records the round, reference rate, applied
/// rate and difference (never changing the amount), and settlement records the round that was
/// fresh, without ever failing because of FX.
contract FxSendSettleTest is PlansBase {
    uint64 internal constant GBP_INR_APPLIED = 127_50000000; // 127.5 INR per GBP, as the app showed

    function _meta(address to, uint64 roundId) internal view returns (IPlansSend.SendMeta memory m) {
        m = IPlansSend.SendMeta({
            to: to,
            fromCountry: "GB",
            toCountry: "IN",
            fromCurrency: "GBP",
            toCurrency: "INR",
            fxRateE8: GBP_INR_APPLIED,
            fxTimestamp: uint64(vm.getBlockTimestamp()),
            fxRoundId: roundId,
            memoHash: keccak256("rent"),
            salt: keccak256(abi.encode("salt", roundId))
        });
    }

    function _auth(IPlansSend.SendMeta memory m, uint256 amount) internal returns (Auth3009 memory) {
        _fund(users[0], amount);
        return PlansSigs.receiveAuth(pks[0], token, address(sender), amount, keccak256(abi.encode(m)));
    }

    function _expectedRef(uint64 id, bytes3 from, bytes3 to) internal view returns (uint256) {
        return uint256(fx.rateOf(id, from)) * 1e8 / fx.rateOf(id, to);
    }

    // ─────────────── PlansSend ───────────────

    function test_send_withRound_recordsReferenceAndDiff() public {
        uint64 id = _writeFxRound();
        IPlansSend.SendMeta memory m = _meta(users[6], id);
        Auth3009 memory a = _auth(m, 50 * USD);
        uint256 ref = _expectedRef(id, "GBP", "INR"); // 132765000 * 1e8 / 1037000 = 12802796528
        assertEq(ref, 12_802_796_528);
        int256 diff = (int256(uint256(GBP_INR_APPLIED)) - int256(ref)) * 10_000 / int256(ref); // -41 bps
        assertEq(diff, -41);
        (uint256 pRef, int256 pDiff) = sender.previewReference(m);
        assertEq(pRef, ref);
        assertEq(pDiff, diff);
        vm.expectEmit(address(sender));
        emit IPlansSend.Sent(
            users[0],
            users[6],
            50 * USD,
            "GB",
            "IN",
            "GBP",
            "INR",
            GBP_INR_APPLIED,
            m.fxTimestamp,
            keccak256("rent"),
            id,
            ref,
            diff
        );
        sender.send(users[0], m, a);
        assertEq(_balance(users[6]), 50 * USD, "the amount is exactly auth.value");
        assertEq(_balance(address(sender)), 0);
    }

    function test_send_withoutRound_zeros() public {
        _writeFxRound();
        IPlansSend.SendMeta memory m = _meta(users[6], 0);
        Auth3009 memory a = _auth(m, 5 * USD);
        vm.expectEmit(address(sender));
        emit IPlansSend.Sent(
            users[0], users[6], 5 * USD, "GB", "IN", "GBP", "INR", GBP_INR_APPLIED, m.fxTimestamp, keccak256("rent"), 0, 0, 0
        );
        sender.send(users[0], m, a);
        assertEq(_balance(users[6]), 5 * USD);
    }

    function test_send_usdLegsAndSameCurrency() public {
        uint64 id = _writeFxRound();
        IPlansSend.SendMeta memory m = _meta(users[6], id);
        m.fromCurrency = "USD"; // AUSD = USD
        m.fxRateE8 = uint64(_expectedRef(id, "USD", "INR"));
        Auth3009 memory a = _auth(m, 1 * USD);
        sender.send(users[0], m, a);
        (uint256 ref, int256 diff) = sender.previewReference(m);
        assertEq(ref, uint256(1e16) / 1_037_000);
        assertEq(diff, 0);

        m = _meta(users[6], id);
        m.toCurrency = "GBP";
        m.fxRateE8 = 1e8;
        (ref, diff) = sender.previewReference(m);
        assertEq(ref, 1e8);
        assertEq(diff, 0);
    }

    function test_send_staleRoundRejected() public {
        uint64 id = _writeFxRound();
        uint64 t = fx.roundTime(id);
        vm.warp(uint256(t) + 6 hours); // exactly 6 h old: still fresh
        IPlansSend.SendMeta memory m = _meta(users[6], id);
        Auth3009 memory a = _auth(m, 1 * USD);
        sender.send(users[0], m, a);

        vm.warp(uint256(t) + 6 hours + 1);
        m = _meta(users[7], id);
        a = _auth(m, 1 * USD);
        vm.expectRevert(abi.encodeWithSelector(PlansSend.FxRoundStale.selector, id, t));
        sender.send(users[0], m, a);
        assertEq(_balance(users[7]), 0, "nothing moved");
    }

    function test_send_unknownRoundOrMissingPairRejected() public {
        IPlansSend.SendMeta memory m = _meta(users[6], 1);
        Auth3009 memory a = _auth(m, 1 * USD);
        vm.expectRevert(abi.encodeWithSelector(PlansSend.FxRoundUnknown.selector, uint64(1)));
        sender.send(users[0], m, a);

        uint64[] memory r = _fxRates();
        r[2] = 0; // no INR this round
        uint64 id = _writeFxRound(r);
        m = _meta(users[6], id);
        a = _auth(m, 1 * USD);
        vm.expectRevert(
            abi.encodeWithSelector(PlansSend.FxPairUnavailable.selector, id, bytes3("GBP"), bytes3("INR"))
        );
        sender.send(users[0], m, a);

        m = _meta(users[6], id);
        m.toCurrency = "KES"; // not in the list
        a = _auth(m, 1 * USD);
        vm.expectRevert(
            abi.encodeWithSelector(PlansSend.FxPairUnavailable.selector, id, bytes3("GBP"), bytes3("KES"))
        );
        sender.send(users[0], m, a);
    }

    /// @dev The round id is inside the 3009 nonce: a relayer cannot swap in another round.
    function test_send_roundIsBoundBySignature() public {
        uint64 id1 = _writeFxRound();
        vm.warp(vm.getBlockTimestamp() + 1);
        uint64 id2 = _writeFxRound();
        IPlansSend.SendMeta memory m = _meta(users[6], id1);
        Auth3009 memory a = _auth(m, 1 * USD);
        m.fxRoundId = id2;
        vm.expectRevert(PlansSend.NonceMismatch.selector);
        sender.send(users[0], m, a);
        m.fxRoundId = 0;
        vm.expectRevert(PlansSend.NonceMismatch.selector);
        sender.send(users[0], m, a);
    }

    function test_send_noFxReferenceConfigured() public {
        PlansSend bare = new PlansSend(token, address(0));
        IPlansSend.SendMeta memory m = _meta(users[6], 1);
        _fund(users[0], 1 * USD);
        Auth3009 memory a = PlansSigs.receiveAuth(pks[0], token, address(bare), 1 * USD, keccak256(abi.encode(m)));
        vm.expectRevert(abi.encodeWithSelector(PlansSend.FxRoundUnknown.selector, uint64(1)));
        bare.send(users[0], m, a);
        m.fxRoundId = 0;
        a = PlansSigs.receiveAuth(pks[0], token, address(bare), 1 * USD, keccak256(abi.encode(m)));
        bare.send(users[0], m, a);
        assertEq(_balance(users[6]), 1 * USD);
    }

    /// @dev Fuzz: the recorded reference and difference match an independent computation, and
    /// the amount moved is always exactly auth.value.
    function testFuzz_send_referenceMath(uint64 fromUsd, uint64 toUsd, uint64 applied, uint96 amount) public {
        fromUsd = uint64(bound(fromUsd, 1_000, 1e12));
        toUsd = uint64(bound(toUsd, 1_000, 1e12));
        amount = uint96(bound(amount, 1, 1e15));
        uint64[] memory r = new uint64[](8);
        r[0] = fromUsd; // GBP
        r[2] = toUsd; // INR
        uint64 id = _writeFxRound(r);
        IPlansSend.SendMeta memory m = _meta(users[6], id);
        m.fxRateE8 = applied;
        Auth3009 memory a = _auth(m, amount);
        uint256 ref = uint256(fromUsd) * 1e8 / toUsd;
        if (ref == 0) {
            // A pair whose reference rounds to 0 at 8 decimals is treated as unavailable.
            vm.expectRevert(
                abi.encodeWithSelector(PlansSend.FxPairUnavailable.selector, id, bytes3("GBP"), bytes3("INR"))
            );
            sender.send(users[0], m, a);
            return;
        }
        int256 diff = (int256(uint256(applied)) - int256(ref)) * 10_000 / int256(ref);
        vm.expectEmit(address(sender));
        emit IPlansSend.Sent(
            users[0], users[6], amount, "GB", "IN", "GBP", "INR", applied, m.fxTimestamp, keccak256("rent"), id, ref, diff
        );
        sender.send(users[0], m, a);
        assertEq(_balance(users[6]), amount);
        if (applied >= ref) assertGe(diff, 0);
        else assertLe(diff, 0);
    }

    // ─────────────── settlement round ───────────────

    function _settleable() internal returns (Pot pot) {
        pot = _potWith(2, _balancedRules(), 10 * USD);
        _ackAll(pot);
    }

    function test_settle_recordsFreshRound() public {
        uint64 id = _writeFxRound();
        Pot pot = _settleable();
        vm.warp(vm.getBlockTimestamp() + 6 hours);
        vm.expectEmit(address(pot));
        emit IPot.Settled(address(this), 20 * USD, 0, 0, id);
        pot.settle();
    }

    function test_settle_staleRoundRecordsZero() public {
        _writeFxRound();
        Pot pot = _settleable();
        vm.warp(vm.getBlockTimestamp() + 6 hours + 1);
        vm.expectEmit(address(pot));
        emit IPot.Settled(address(this), 20 * USD, 0, 0, 0);
        pot.settle();
    }

    function test_settle_noRoundRecordsZero() public {
        Pot pot = _settleable();
        vm.expectEmit(address(pot));
        emit IPot.Settled(address(this), 20 * USD, 0, 0, 0);
        pot.settle();
    }

    function test_settle_latestRoundWins() public {
        _writeFxRound();
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        uint64 id2 = _writeFxRound();
        Pot pot = _settleable();
        vm.expectEmit(address(pot));
        emit IPot.Settled(address(this), 20 * USD, 0, 0, id2);
        pot.settle();
    }

    /// @dev Pots of a factory with no FxReference settle with round 0.
    function test_settle_withoutFxReference() public {
        factory = new PlansFactory(token, address(registry), address(0));
        Pot pot = _settleable();
        assertEq(address(pot.fxReference()), address(0));
        vm.expectEmit(address(pot));
        emit IPot.Settled(address(this), 20 * USD, 0, 0, 0);
        pot.settle();
        _assertI1(pot);
    }

    /// @dev Whatever the FX contract does, settlement succeeds and records 0 (or the round when sane).
    function test_settle_neverFailsBecauseOfFx() public {
        MockFxReference bad = new MockFxReference();
        factory = new PlansFactory(token, address(registry), address(bad));
        uint64 nowT = uint64(vm.getBlockTimestamp());
        for (uint8 mode; mode <= uint8(MockFxReference.Mode.ReturnBomb); ++mode) {
            bad.set(MockFxReference.Mode(mode), 5, nowT);
            Pot pot = _settleable();
            uint64 expected = mode == uint8(MockFxReference.Mode.Ok) ? 5 : mode == uint8(MockFxReference.Mode.ReturnBomb) ? 1 : 0;
            vm.expectEmit(address(pot));
            emit IPot.Settled(address(this), 20 * USD, 0, 0, expected);
            pot.settle{gas: 2_000_000}();
            assertTrue(pot.settled());
            _assertI1(pot);
        }
    }

    /// @dev A round with a zero or future-looking time is handled without reverting.
    function test_settle_oddRoundTimes() public {
        MockFxReference odd = new MockFxReference();
        factory = new PlansFactory(token, address(registry), address(odd));
        odd.set(MockFxReference.Mode.Ok, 3, 0); // zero time
        Pot pot = _settleable();
        vm.expectEmit(address(pot));
        emit IPot.Settled(address(this), 20 * USD, 0, 0, 0);
        pot.settle();
        odd.set(MockFxReference.Mode.Ok, 4, uint64(vm.getBlockTimestamp() + 1 days)); // future: fresh
        pot = _settleable();
        vm.expectEmit(address(pot));
        emit IPot.Settled(address(this), 20 * USD, 0, 0, 4);
        pot.settle();
    }

    /// @dev The submitter cannot pick a gas limit that makes the FX read fail while settlement
    /// succeeds: every successful settle records the fresh round.
    function test_settle_gasLimitCannotSuppressRound() public {
        uint64 id = _writeFxRound();
        Pot pot = _settleable();
        bytes memory data = abi.encodeCall(pot.settle, ());
        uint256 ok;
        uint256 wrong;
        for (uint256 g = 60_000; g <= 400_000; g += 500) {
            uint256 snap = vm.snapshotState();
            vm.recordLogs();
            (bool success,) = address(pot).call{gas: g}(data);
            if (success) {
                ++ok;
                (,,, uint64 recorded) = _settledArgs();
                if (recorded != id) ++wrong;
            }
            vm.revertToState(snap);
        }
        assertGt(ok, 0, "settle never succeeded in the scanned range");
        assertEq(wrong, 0, "a gas limit made settle record no round");
    }

    function _settledArgs() internal view returns (uint256 paidOut, uint256 pulledIn, uint256 unpaid, uint64 roundId) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == IPot.Settled.selector) {
                return abi.decode(logs[i].data, (uint256, uint256, uint256, uint64));
            }
        }
        revert("no Settled");
    }
}
