// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PlansBase} from "../utils/PlansBase.sol";
import {FxReference} from "../../src/FxReference.sol";
import {IERC165, IFxReference, IReceiver} from "../../src/interfaces/IFxReference.sol";

/// @notice FxReference: access control in simulation and production mode, replay and freshness
/// rules, report validation, the per-currency move limit, owner powers and views.
contract FxReferenceTest is PlansBase {
    bytes32 internal constant WF_ID = keccak256("plans-fx-workflow");
    address internal constant WF_OWNER = address(0xC0FFEE);
    address internal prodForwarder = address(0xF8344);

    function _metadata(bytes32 id, address owner_) internal pure returns (bytes memory) {
        return abi.encodePacked(id, bytes10("plansfx"), owner_, bytes2(0x0001));
    }

    function _report(uint64 t) internal view returns (bytes memory) {
        uint64[] memory r = _fxRates();
        return _fxReport(t, r, _fxMasks(r));
    }

    function _now64() internal view returns (uint64) {
        return uint64(vm.getBlockTimestamp());
    }

    function _toProduction() internal {
        vm.prank(fxOwner);
        fx.setProductionMode(prodForwarder, WF_ID, WF_OWNER);
    }

    // ─────────────── deployment ───────────────

    function test_constructor_startsInSimulationMode() public view {
        assertEq(fx.owner(), fxOwner);
        assertEq(fx.forwarder(), fxForwarder);
        assertEq(fx.SIM_FORWARDER(), fxForwarder);
        assertEq(fx.simTransmitter(), fxTransmitter);
        assertEq(fx.CHAIN_SELECTOR(), FX_CHAIN_SELECTOR);
        assertEq(fx.maxMoveBps(), 1_000);
        assertEq(fx.latestRoundId(), 0);
        bytes3[] memory c = fx.currencies();
        assertEq(c.length, 8);
        assertEq(c[0], bytes3("GBP"));
        assertEq(c[1], bytes3("EUR"));
        assertEq(c[2], bytes3("INR"));
        assertEq(c[3], bytes3("NGN"));
        assertEq(c[4], bytes3("JPY"));
        assertEq(c[5], bytes3("CHF"));
        assertEq(c[6], bytes3("AED"));
        assertEq(c[7], bytes3("SGD"));
    }

    function test_constructor_rejectsZeroConfig() public {
        vm.expectRevert(FxReference.ZeroAddress.selector);
        new FxReference(address(0), fxForwarder, fxTransmitter, 1);
        vm.expectRevert(FxReference.ZeroAddress.selector);
        new FxReference(fxOwner, address(0), fxTransmitter, 1);
        vm.expectRevert(FxReference.ZeroAddress.selector);
        new FxReference(fxOwner, fxForwarder, address(0), 1);
        vm.expectRevert(FxReference.InvalidConfig.selector);
        new FxReference(fxOwner, fxForwarder, fxTransmitter, 0);
    }

    function test_supportsInterface() public view {
        assertTrue(fx.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(fx.supportsInterface(IReceiver.onReport.selector));
        assertTrue(fx.supportsInterface(type(IERC165).interfaceId));
        assertFalse(fx.supportsInterface(0xffffffff));
    }

    // ─────────────── simulation mode access ───────────────

    function test_sim_writesRoundAndEmits() public {
        uint64[] memory r = _fxRates();
        uint8[] memory m = _fxMasks(r);
        uint64 t = _now64();
        vm.expectEmit(address(fx));
        emit IFxReference.RoundWritten(1, t, 20261006, 0x07, r, m);
        _deliverFx(_fxReport(t, r, m));

        IFxReference.Round memory rd = fx.latestRound();
        assertEq(rd.roundId, 1);
        assertEq(rd.scheduledTime, t);
        assertEq(rd.writtenAt, t);
        assertEq(rd.rateDate, 20261006);
        assertEq(rd.sourceMask, 0x07);
        for (uint256 i; i < 8; ++i) {
            assertEq(rd.usdPerUnitE8[i], r[i]);
            assertEq(rd.sourceMasks[i], m[i]);
            assertEq(fx.rateOf(1, rd.currencies[i]), r[i]);
        }
        assertEq(fx.rateOf(1, "USD"), 1e8, "AUSD = USD");
        assertEq(fx.rateOf(1, "XYZ"), 0, "unknown currency");
        assertEq(fx.rateOf(2, "GBP"), 0, "unknown round");
        assertEq(fx.rateOf(2, "USD"), 0, "USD only for existing rounds");
        (uint64 id, uint64 st) = fx.latestRoundTime();
        assertEq(id, 1);
        assertEq(st, t);
        assertEq(fx.roundTime(1), t);
        assertEq(fx.roundTime(2), 0);
        assertEq(fx.round(9).roundId, 0, "missing round is empty");
        assertEq(fx.lastScheduledTime(), t);
    }

    function test_sim_rejectsWrongSender() public {
        bytes memory rep = _report(_now64());
        vm.prank(makeAddr("stranger"), fxTransmitter);
        vm.expectRevert(abi.encodeWithSelector(FxReference.InvalidSender.selector, makeAddr("stranger")));
        fx.onReport(_fxMetadata(), rep);
    }

    /// @dev The simulation forwarder is permissionless: anyone can make it call onReport. Only the
    /// configured transmitter's own transactions (tx.origin) are accepted.
    function test_sim_rejectsWrongTransmitter() public {
        bytes memory rep = _report(_now64());
        address mallory = makeAddr("mallory");
        vm.prank(fxForwarder, mallory);
        vm.expectRevert(abi.encodeWithSelector(FxReference.InvalidTransmitter.selector, mallory));
        fx.onReport(_fxMetadata(), rep);
        assertEq(fx.latestRoundId(), 0);
    }

    function test_sim_ignoresPlaceholderMetadata() public {
        // The mock forwarder passes placeholder workflow id/owner; simulation mode does not check them.
        bytes memory rep = _report(_now64());
        vm.prank(fxForwarder, fxTransmitter);
        fx.onReport(hex"", rep);
        assertEq(fx.latestRoundId(), 1);
    }

    // ─────────────── production mode access ───────────────

    function test_prod_checksForwarderWorkflowIdAndOwner() public {
        _toProduction();
        assertEq(fx.forwarder(), prodForwarder);
        assertEq(fx.simTransmitter(), address(0));
        bytes memory rep = _report(_now64());

        // the old (simulation) forwarder is no longer accepted
        vm.prank(fxForwarder, fxTransmitter);
        vm.expectRevert(abi.encodeWithSelector(FxReference.InvalidSender.selector, fxForwarder));
        fx.onReport(_metadata(WF_ID, WF_OWNER), rep);

        vm.startPrank(prodForwarder, makeAddr("any DON transmitter"));
        vm.expectRevert(FxReference.InvalidMetadata.selector);
        fx.onReport(hex"1234", rep);
        vm.expectRevert(abi.encodeWithSelector(FxReference.InvalidWorkflowId.selector, bytes32(uint256(1))));
        fx.onReport(_metadata(bytes32(uint256(1)), WF_OWNER), rep);
        vm.expectRevert(abi.encodeWithSelector(FxReference.InvalidWorkflowOwner.selector, address(0xBAD)));
        fx.onReport(_metadata(WF_ID, address(0xBAD)), rep);
        // tx.origin does not matter in production mode
        fx.onReport(_metadata(WF_ID, WF_OWNER), rep);
        vm.stopPrank();
        assertEq(fx.latestRoundId(), 1);
    }

    function test_prod_cannotUseSimForwarderOrZeroConfig() public {
        vm.startPrank(fxOwner);
        vm.expectRevert(FxReference.InvalidConfig.selector);
        fx.setProductionMode(fxForwarder, WF_ID, WF_OWNER); // the mock is never a production forwarder
        vm.expectRevert(FxReference.InvalidConfig.selector);
        fx.setProductionMode(prodForwarder, bytes32(0), WF_OWNER);
        vm.expectRevert(FxReference.ZeroAddress.selector);
        fx.setProductionMode(prodForwarder, WF_ID, address(0));
        vm.expectRevert(FxReference.ZeroAddress.selector);
        fx.setProductionMode(address(0), WF_ID, WF_OWNER);
        vm.stopPrank();
    }

    function test_switchBackToSimulation() public {
        _toProduction();
        address newTransmitter = makeAddr("new transmitter");
        vm.expectEmit(address(fx));
        emit IFxReference.SimulationModeSet(fxForwarder, newTransmitter);
        vm.prank(fxOwner);
        fx.setSimulationMode(newTransmitter);
        assertEq(fx.forwarder(), fxForwarder);
        assertEq(fx.expectedWorkflowId(), 0);
        assertEq(fx.expectedWorkflowOwner(), address(0));
        bytes memory rep = _report(_now64());
        vm.prank(fxForwarder, fxTransmitter); // the old transmitter is out
        vm.expectRevert(abi.encodeWithSelector(FxReference.InvalidTransmitter.selector, fxTransmitter));
        fx.onReport(_fxMetadata(), rep);
        vm.prank(fxForwarder, newTransmitter);
        fx.onReport(_fxMetadata(), rep);
        assertEq(fx.latestRoundId(), 1);
        vm.prank(fxOwner);
        vm.expectRevert(FxReference.ZeroAddress.selector);
        fx.setSimulationMode(address(0));
    }

    // ─────────────── replay and time ───────────────

    function test_replay_sameOrOlderScheduledTimeRejected() public {
        uint64 t = _now64();
        bytes memory rep = _report(t);
        _deliverFx(rep);
        vm.prank(fxForwarder, fxTransmitter);
        vm.expectRevert(abi.encodeWithSelector(FxReference.StaleReport.selector, t, t));
        fx.onReport(_fxMetadata(), rep); // exact replay
        vm.prank(fxForwarder, fxTransmitter);
        vm.expectRevert(abi.encodeWithSelector(FxReference.StaleReport.selector, t - 1, t));
        fx.onReport(_fxMetadata(), _report(t - 1));
        _deliverFx(_report(t + 1));
        assertEq(fx.latestRoundId(), 2);
    }

    function test_futureScheduledTimeRejected() public {
        uint64 t = _now64();
        _deliverFx(_report(t + 300)); // within the skew
        vm.prank(fxForwarder, fxTransmitter);
        vm.expectRevert(abi.encodeWithSelector(FxReference.FutureReport.selector, t + 301 + 1));
        fx.onReport(_fxMetadata(), _report(t + 302));
    }

    function test_wrongChainSelectorRejected() public {
        uint64[] memory r = _fxRates();
        bytes memory rep =
            abi.encode(uint64(2183018362218727504), _now64(), uint32(20261006), _fxCurrencies(), r, _fxMasks(r));
        vm.prank(fxForwarder, fxTransmitter);
        vm.expectRevert(abi.encodeWithSelector(FxReference.WrongChain.selector, uint64(2183018362218727504)));
        fx.onReport(_fxMetadata(), rep);
    }

    function test_invalidRateDateRejected() public {
        uint64[] memory r = _fxRates();
        bytes memory rep = abi.encode(FX_CHAIN_SELECTOR, _now64(), uint32(0), _fxCurrencies(), r, _fxMasks(r));
        vm.prank(fxForwarder, fxTransmitter);
        vm.expectRevert(abi.encodeWithSelector(FxReference.InvalidRateDate.selector, uint32(0)));
        fx.onReport(_fxMetadata(), rep);
    }

    // ─────────────── report shape and sources ───────────────

    function test_currencyListMustMatch() public {
        uint64[] memory r = _fxRates();
        bytes3[] memory c = _fxCurrencies();
        assertEq(abi.encode(c), abi.encode(fx.currencies()), "local list matches the contract");
        (c[0], c[1]) = (c[1], c[0]);
        bytes memory rep = abi.encode(FX_CHAIN_SELECTOR, _now64(), uint32(20261006), c, r, _fxMasks(r));
        vm.prank(fxForwarder, fxTransmitter);
        vm.expectRevert(abi.encodeWithSelector(FxReference.CurrencyMismatch.selector, 0));
        fx.onReport(_fxMetadata(), rep);

        bytes3[] memory short = new bytes3[](7);
        rep = abi.encode(FX_CHAIN_SELECTOR, _now64(), uint32(20261006), short, r, _fxMasks(r));
        vm.prank(fxForwarder, fxTransmitter);
        vm.expectRevert(FxReference.InvalidLength.selector);
        fx.onReport(_fxMetadata(), rep);
    }

    function test_malformedReportReverts() public {
        vm.prank(fxForwarder, fxTransmitter);
        vm.expectRevert();
        fx.onReport(_fxMetadata(), hex"deadbeef");
    }

    function test_needsTwoKnownSourcesPerRate() public {
        uint64[] memory r = _fxRates();
        uint8[] memory m = _fxMasks(r);
        m[2] = 0x01; // INR from one source only
        vm.prank(fxForwarder, fxTransmitter);
        vm.expectRevert(abi.encodeWithSelector(FxReference.MissingSources.selector, bytes3("INR"), uint8(0x01)));
        fx.onReport(_fxMetadata(), _fxReport(_now64(), r, m));

        m = _fxMasks(r);
        m[0] = 0x09; // bit 3 is not a known source
        vm.prank(fxForwarder, fxTransmitter);
        vm.expectRevert(abi.encodeWithSelector(FxReference.MissingSources.selector, bytes3("GBP"), uint8(0x09)));
        fx.onReport(_fxMetadata(), _fxReport(_now64(), r, m));

        m = _fxMasks(r);
        r[3] = 0; // NGN absent but with sources claimed
        vm.prank(fxForwarder, fxTransmitter);
        vm.expectRevert(abi.encodeWithSelector(FxReference.MissingSources.selector, bytes3("NGN"), uint8(0x06)));
        fx.onReport(_fxMetadata(), _fxReport(_now64(), r, m));
    }

    function test_absentCurrencyAndEmptyReport() public {
        uint64[] memory r = _fxRates();
        r[3] = 0; // NGN absent this round
        _deliverFx(_fxReport(_now64(), r, _fxMasks(r)));
        assertEq(fx.rateOf(1, "NGN"), 0);
        assertEq(fx.rateOf(1, "GBP"), r[0]);
        assertEq(fx.latestRound().sourceMasks[3], 0);

        uint64[] memory none = new uint64[](8);
        vm.prank(fxForwarder, fxTransmitter);
        vm.expectRevert(FxReference.EmptyReport.selector);
        fx.onReport(_fxMetadata(), _fxReport(_now64() + 1, none, _fxMasks(none)));
    }

    // ─────────────── move limit ───────────────

    function test_moveLimit_boundaryAndLastKnownRate() public {
        uint64[] memory r = _fxRates();
        uint64 t = _now64();
        _deliverFx(_fxReport(t, r, _fxMasks(r)));

        // exactly +10 % is accepted
        uint64[] memory up = _fxRates();
        up[0] = r[0] + r[0] / 10;
        _deliverFx(_fxReport(++t, up, _fxMasks(up)));

        // +10 % plus one unit against the new last rate is rejected
        uint64[] memory tooFar = _fxRates();
        tooFar[0] = up[0] + up[0] / 10 + 1;
        vm.prank(fxForwarder, fxTransmitter);
        vm.expectRevert(
            abi.encodeWithSelector(FxReference.RateMoveTooLarge.selector, bytes3("GBP"), up[0], tooFar[0])
        );
        fx.onReport(_fxMetadata(), _fxReport(++t, tooFar, _fxMasks(tooFar)));

        // -10 % - 1 rejected too (downward)
        uint64[] memory down = _fxRates();
        down[0] = up[0];
        down[2] = r[2] - r[2] / 10 - 1;
        vm.prank(fxForwarder, fxTransmitter);
        vm.expectRevert(abi.encodeWithSelector(FxReference.RateMoveTooLarge.selector, bytes3("INR"), r[2], down[2]));
        fx.onReport(_fxMetadata(), _fxReport(t, down, _fxMasks(down)));

        // A currency absent from the previous round is compared with its last accepted rate.
        uint64[] memory skip = _fxRates();
        skip[0] = up[0];
        skip[3] = 0;
        _deliverFx(_fxReport(++t, skip, _fxMasks(skip)));
        uint64[] memory jump = _fxRates();
        jump[0] = up[0];
        jump[3] = r[3] * 2;
        vm.prank(fxForwarder, fxTransmitter);
        vm.expectRevert(abi.encodeWithSelector(FxReference.RateMoveTooLarge.selector, bytes3("NGN"), r[3], r[3] * 2));
        fx.onReport(_fxMetadata(), _fxReport(++t, jump, _fxMasks(jump)));
        assertEq(fx.lastRates()[3], r[3]);
    }

    function test_moveLimit_ownerCanWidenIt() public {
        uint64[] memory r = _fxRates();
        uint64 t = _now64();
        _deliverFx(_fxReport(t, r, _fxMasks(r)));
        uint64[] memory devalued = _fxRates();
        devalued[3] = r[3] / 2; // NGN halves
        vm.prank(fxForwarder, fxTransmitter);
        vm.expectRevert();
        fx.onReport(_fxMetadata(), _fxReport(t + 1, devalued, _fxMasks(devalued)));
        vm.prank(fxOwner);
        fx.setMaxMoveBps(5_000);
        _deliverFx(_fxReport(t + 1, devalued, _fxMasks(devalued)));
        assertEq(fx.rateOf(2, "NGN"), r[3] / 2);
    }

    /// @dev Fuzz: a move is accepted iff |new - prev| * 10,000 <= prev * maxMoveBps.
    function testFuzz_moveLimit(uint64 prev, uint64 next, uint16 bps) public {
        prev = uint64(bound(prev, 1, type(uint64).max / 2));
        next = uint64(bound(next, 1, type(uint64).max));
        bps = uint16(bound(bps, 1, 10_000));
        vm.prank(fxOwner);
        fx.setMaxMoveBps(bps);
        uint64[] memory r = new uint64[](8);
        r[0] = prev;
        uint64 t = _now64();
        _deliverFx(_fxReport(t, r, _fxMasks(r)));
        r[0] = next;
        uint256 diff = next > prev ? next - prev : prev - next;
        bool ok = diff * 10_000 <= uint256(prev) * bps;
        vm.prank(fxForwarder, fxTransmitter);
        if (!ok) vm.expectRevert(abi.encodeWithSelector(FxReference.RateMoveTooLarge.selector, bytes3("GBP"), prev, next));
        fx.onReport(_fxMetadata(), _fxReport(t + 1, r, _fxMasks(r)));
        assertEq(fx.latestRoundId(), ok ? 2 : 1);
    }

    /// @dev Fuzz: whatever rates and masks are written are read back unchanged.
    function testFuzz_roundTrip(uint64[8] memory raw, uint8[8] memory rawMasks, uint32 date) public {
        uint64[] memory r = new uint64[](8);
        uint8[] memory m = new uint8[](8);
        bool any;
        for (uint256 i; i < 8; ++i) {
            r[i] = raw[i] % 4 == 0 ? 0 : raw[i];
            if (r[i] != 0) {
                uint8 mm = rawMasks[i] & 0x07;
                m[i] = (mm == 1 || mm == 2 || mm == 4 || mm == 0) ? 0x03 : mm;
                any = true;
            }
        }
        if (!any) {
            r[0] = 1e8;
            m[0] = 0x03;
        }
        date = uint32(bound(date, 19700101, 99991231));
        bytes memory rep = abi.encode(FX_CHAIN_SELECTOR, _now64(), date, _fxCurrencies(), r, m);
        _deliverFx(rep);
        IFxReference.Round memory rd = fx.round(1);
        assertEq(rd.rateDate, date);
        for (uint256 i; i < 8; ++i) {
            assertEq(rd.usdPerUnitE8[i], r[i]);
            assertEq(rd.sourceMasks[i], m[i]);
        }
    }

    // ─────────────── owner ───────────────

    function test_ownerOnly() public {
        address mallory = makeAddr("mallory");
        vm.startPrank(mallory);
        vm.expectRevert(FxReference.Unauthorized.selector);
        fx.setSimulationMode(mallory);
        vm.expectRevert(FxReference.Unauthorized.selector);
        fx.setProductionMode(prodForwarder, WF_ID, WF_OWNER);
        vm.expectRevert(FxReference.Unauthorized.selector);
        fx.setMaxMoveBps(10);
        vm.expectRevert(FxReference.Unauthorized.selector);
        fx.transferOwnership(mallory);
        vm.expectRevert(FxReference.Unauthorized.selector);
        fx.acceptOwnership();
        vm.stopPrank();
    }

    function test_maxMoveBounds() public {
        vm.startPrank(fxOwner);
        vm.expectRevert(FxReference.InvalidConfig.selector);
        fx.setMaxMoveBps(0);
        vm.expectRevert(FxReference.InvalidConfig.selector);
        fx.setMaxMoveBps(10_001);
        fx.setMaxMoveBps(10_000);
        vm.stopPrank();
        assertEq(fx.maxMoveBps(), 10_000);
    }

    function test_twoStepOwnership() public {
        address next = makeAddr("next owner");
        vm.prank(fxOwner);
        fx.transferOwnership(next);
        assertEq(fx.owner(), fxOwner, "unchanged until accepted");
        vm.prank(next);
        fx.acceptOwnership();
        assertEq(fx.owner(), next);
        assertEq(fx.pendingOwner(), address(0));
        vm.prank(fxOwner);
        vm.expectRevert(FxReference.Unauthorized.selector);
        fx.setMaxMoveBps(5);
    }

    /// @dev The owner has no path to rewrite history: rounds are append-only.
    function test_ownerCannotEditRounds() public {
        uint64 id = _writeFxRound();
        uint64 before = fx.rateOf(id, "GBP");
        vm.startPrank(fxOwner);
        fx.setMaxMoveBps(10_000);
        fx.setSimulationMode(fxOwner);
        vm.stopPrank();
        assertEq(fx.rateOf(id, "GBP"), before);
        assertEq(fx.latestRoundId(), id);
    }
}
