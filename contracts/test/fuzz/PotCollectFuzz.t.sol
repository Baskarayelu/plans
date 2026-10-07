// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockAUSD} from "../mocks/MockAUSD.sol";
import {Pot} from "../../src/Pot.sol";
import {PotCollectHarness} from "./PotCollectHarness.sol";

/// @notice Fuzzes `Pot.collect` against its formula: a member is paid
/// `balance >= Σ positive nets ? net : floor(net * balance / Σ positive nets)`, never more than its
/// net, and nobody else's balance or net changes. Repeated collects never pay out more than the pot
/// held or more than each member was owed.
contract PotCollectFuzzTest is Test {
    MockAUSD internal ausd;
    PotCollectHarness internal pot;
    address[] internal accounts;

    function setUp() public {
        ausd = new MockAUSD();
        pot = new PotCollectHarness(address(ausd));
    }

    function _seed(int96[8] memory raw, uint8 n) internal returns (int96[] memory nets, uint256 credit) {
        n = uint8(bound(n, 1, 8));
        nets = new int96[](n);
        delete accounts;
        for (uint256 i; i < n; ++i) {
            accounts.push(address(uint160(0x1000 + i)));
            nets[i] = int96(bound(raw[i], -1e15, 1e15));
            if (nets[i] > 0) credit += uint256(int256(nets[i]));
        }
        pot.seed(accounts, nets);
    }

    function testFuzz_collect_proRata(int96[8] memory raw, uint8 n, uint256 balance, uint8 who) public {
        (int96[] memory nets, uint256 credit) = _seed(raw, n);
        balance = bound(balance, 0, credit * 2 + 1);
        ausd.mint(address(pot), balance);
        uint256 k = who % nets.length;
        int256 net = nets[k];

        uint256 expected;
        if (net > 0) expected = balance >= credit ? uint256(net) : uint256(net) * balance / credit;
        if (expected == 0) {
            vm.expectRevert(Pot.NothingToCollect.selector);
            pot.collect(accounts[k]);
            return;
        }
        uint256[] memory before = new uint256[](nets.length);
        for (uint256 i; i < nets.length; ++i) {
            before[i] = ausd.balanceOf(accounts[i]);
        }
        pot.collect(accounts[k]);
        assertLe(expected, uint256(net), "never more than net");
        assertEq(ausd.balanceOf(accounts[k]), before[k] + expected, "member paid the formula");
        assertEq(pot.netOf(accounts[k]), net - int256(expected), "net reduced by the payment");
        assertEq(ausd.balanceOf(address(pot)), balance - expected, "pot paid exactly that");
        for (uint256 i; i < nets.length; ++i) {
            if (i == k) continue;
            assertEq(ausd.balanceOf(accounts[i]), before[i], "no one else paid");
            assertEq(pot.netOf(accounts[i]), nets[i], "no one else's net changed");
        }
    }

    /// @dev Everyone collects, in a fuzzed order, several times: total paid <= the balance, each
    /// member <= its original net, and when the pot covered every claim everyone ends at 0.
    function testFuzz_collect_sequence(int96[8] memory raw, uint8 n, uint256 balance, uint256 order) public {
        (int96[] memory nets, uint256 credit) = _seed(raw, n);
        balance = bound(balance, 0, credit * 2 + 1);
        ausd.mint(address(pot), balance);
        uint256 m = nets.length;
        order = order % 1_000;
        for (uint256 round; round < 3; ++round) {
            for (uint256 j; j < m; ++j) {
                address a = accounts[(order + j + round) % m];
                try pot.collect(a) {} catch {}
            }
        }
        uint256 paid;
        for (uint256 i; i < m; ++i) {
            uint256 got = ausd.balanceOf(accounts[i]);
            paid += got;
            if (nets[i] <= 0) assertEq(got, 0, "debtors are never paid");
            else assertLe(got, uint256(int256(nets[i])), "never more than owed");
            assertEq(pot.netOf(accounts[i]), nets[i] - int256(got), "ledger matches payments");
        }
        assertLe(paid, balance, "never more than the pot held");
        assertEq(ausd.balanceOf(address(pot)), balance - paid);
        if (balance >= credit) assertEq(paid, credit, "a covered pot pays every claim in full");
    }
}
