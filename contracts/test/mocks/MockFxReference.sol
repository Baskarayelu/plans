// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice A misbehaving FxReference for Pot.settle robustness tests. Every mode answers
/// `latestRoundTime()` badly in a different way; settlement must still succeed (round 0).
contract MockFxReference {
    enum Mode {
        Ok, // (roundId, scheduledTime) as set
        Revert, // reverts with a reason
        RevertEmpty, // reverts with no data
        ShortReturn, // returns 32 bytes instead of 64
        BurnGas, // loops until it runs out of gas
        HugeValues, // returns values that do not fit uint64
        ReturnBomb // returns a very large return payload
    }

    Mode public mode;
    uint64 public roundId;
    uint64 public scheduledTime;

    function set(Mode m, uint64 id, uint64 t) external {
        mode = m;
        roundId = id;
        scheduledTime = t;
    }

    function latestRoundTime() external view returns (uint64, uint64) {
        Mode m = mode;
        if (m == Mode.Revert) revert("fx down");
        if (m == Mode.RevertEmpty) revert();
        if (m == Mode.ShortReturn) {
            assembly {
                mstore(0, 7)
                return(0, 32)
            }
        }
        if (m == Mode.BurnGas) {
            uint256 x;
            while (gasleft() > 0) {
                x = uint256(keccak256(abi.encode(x)));
            }
        }
        if (m == Mode.HugeValues) {
            assembly {
                mstore(0, not(0))
                mstore(32, not(0))
                return(0, 64)
            }
        }
        if (m == Mode.ReturnBomb) {
            assembly {
                mstore(0, 1)
                mstore(32, timestamp())
                return(0, 100000)
            }
        }
        return (roundId, scheduledTime);
    }
}
