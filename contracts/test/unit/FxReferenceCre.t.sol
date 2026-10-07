// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {FxReference} from "../../src/FxReference.sol";
import {IFxReference} from "../../src/interfaces/IFxReference.sol";

/// @notice Cross-checks the CRE workflow's report encoder (cre/fx-workflow) against FxReference's
/// decoder. The golden vector cre/fx-workflow/test/fixtures/report-vector.json holds the report
/// inputs and the exact bytes the TypeScript encoder must produce (asserted by `npm test` there);
/// this test delivers those bytes the way the MockKeystoneForwarder does and checks every stored value.
contract FxReferenceCreTest is Test {
    string internal constant VECTOR = "../cre/fx-workflow/test/fixtures/report-vector.json";
    uint64 internal constant SELECTOR = 31337;

    address internal owner = makeAddr("owner");
    address internal forwarder = makeAddr("mockKeystoneForwarder");
    address internal transmitter = makeAddr("simTransmitter");
    FxReference internal fx;

    // vector
    uint64 internal chainSelector;
    uint64 internal scheduledTime;
    uint32 internal rateDate;
    string[] internal codes;
    uint64[] internal rates;
    uint8[] internal masks;
    bytes internal encoded;

    function setUp() public {
        string memory json = vm.readFile(VECTOR);
        chainSelector = uint64(vm.parseUint(vm.parseJsonString(json, ".chainSelector")));
        scheduledTime = uint64(vm.parseUint(vm.parseJsonString(json, ".scheduledTime")));
        rateDate = uint32(vm.parseJsonUint(json, ".rateDate"));
        codes = vm.parseJsonStringArray(json, ".currencies");
        string[] memory rateStrings = vm.parseJsonStringArray(json, ".usdPerUnitE8");
        uint256[] memory maskValues = vm.parseJsonUintArray(json, ".sourceMasks");
        encoded = vm.parseJsonBytes(json, ".encoded");
        for (uint256 i; i < rateStrings.length; ++i) {
            rates.push(uint64(vm.parseUint(rateStrings[i])));
            masks.push(uint8(maskValues[i]));
        }

        fx = new FxReference(owner, forwarder, transmitter, SELECTOR);
        vm.warp(scheduledTime + 60);
    }

    /// @dev What the forwarder passes as metadata: workflowId | workflowName | workflowOwner | reportId.
    function _metadata() internal pure returns (bytes memory) {
        return abi.encodePacked(bytes32(uint256(0x11)), bytes10("5bc2e6405f"), address(0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa), bytes2(0x0001));
    }

    function _deliver(bytes memory report) internal {
        vm.prank(forwarder, transmitter);
        fx.onReport(_metadata(), report);
    }

    function _code(uint256 i) internal view returns (bytes3) {
        return bytes3(bytes(codes[i]));
    }

    function test_vector_shape() public view {
        assertEq(chainSelector, SELECTOR, "vector chain selector");
        assertEq(codes.length, 8);
        assertEq(rates.length, 8);
        assertEq(masks.length, 8);
        bytes3[] memory list = fx.currencies();
        bool hasAbsent;
        for (uint256 i; i < 8; ++i) {
            assertEq(_code(i), list[i], "currency order");
            if (rates[i] == 0) hasAbsent = true;
        }
        assertTrue(hasAbsent, "vector must include an absent currency");
        // The vector's bytes are the canonical ABI encoding of its inputs.
        bytes3[] memory ccys = new bytes3[](8);
        for (uint256 i; i < 8; ++i) ccys[i] = _code(i);
        assertEq(keccak256(abi.encode(chainSelector, scheduledTime, rateDate, ccys, rates, masks)), keccak256(encoded));
    }

    function test_onReport_decodesWorkflowVector() public {
        uint8 roundMask;
        for (uint256 i; i < 8; ++i) roundMask |= masks[i];

        vm.expectEmit(address(fx));
        emit IFxReference.RoundWritten(1, scheduledTime, rateDate, roundMask, rates, masks);
        _deliver(encoded);

        assertEq(fx.latestRoundId(), 1);
        assertEq(fx.lastScheduledTime(), scheduledTime);
        (uint64 id, uint64 t) = fx.latestRoundTime();
        assertEq(id, 1);
        assertEq(t, scheduledTime);
        assertEq(fx.roundTime(1), scheduledTime);

        IFxReference.Round memory r = fx.latestRound();
        assertEq(r.roundId, 1);
        assertEq(r.scheduledTime, scheduledTime);
        assertEq(r.writtenAt, block.timestamp);
        assertEq(r.rateDate, rateDate);
        assertEq(r.sourceMask, roundMask);
        assertEq(r.currencies.length, 8);
        assertEq(r.usdPerUnitE8.length, 8);
        assertEq(r.sourceMasks.length, 8);

        uint64[8] memory last = fx.lastRates();
        for (uint256 i; i < 8; ++i) {
            assertEq(r.currencies[i], _code(i), "currency");
            assertEq(r.usdPerUnitE8[i], rates[i], codes[i]);
            assertEq(r.sourceMasks[i], masks[i], codes[i]);
            assertEq(fx.rateOf(1, _code(i)), rates[i], codes[i]);
            assertEq(last[i], rates[i], "last rate");
        }
        assertEq(fx.rateOf(1, "USD"), 1e8);
        assertEq(fx.rateOf(2, _code(0)), 0, "no round 2");

        IFxReference.Round memory same = fx.round(1);
        assertEq(keccak256(abi.encode(same)), keccak256(abi.encode(r)));
    }

    function test_onReport_vectorReplayRejected() public {
        _deliver(encoded);
        vm.prank(forwarder, transmitter);
        vm.expectRevert(abi.encodeWithSelector(FxReference.StaleReport.selector, scheduledTime, scheduledTime));
        fx.onReport(_metadata(), encoded);
    }

    function test_onReport_vectorOnOtherChainRejected() public {
        FxReference monadTestnet = new FxReference(owner, forwarder, transmitter, 2183018362218727504);
        vm.prank(forwarder, transmitter);
        vm.expectRevert(abi.encodeWithSelector(FxReference.WrongChain.selector, SELECTOR));
        monadTestnet.onReport(_metadata(), encoded);
    }

    function test_onReport_vectorFromStrangerRejected() public {
        address stranger = makeAddr("stranger");
        vm.prank(forwarder, stranger);
        vm.expectRevert(abi.encodeWithSelector(FxReference.InvalidTransmitter.selector, stranger));
        fx.onReport(_metadata(), encoded);
    }
}
