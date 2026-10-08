#!/bin/bash
# Real run: `collect(member)` is in the Pot implementation deployed and verified on Monad testnet,
# and its unit tests pass. Read-only: eth_getCode, and forge test on a local EVM.
cd "$(dirname "$0")/../.." || exit 1
export LC_ALL=en_US.UTF-8
R=https://testnet-rpc.monad.xyz
POT=$(jq -r .potImplementation contracts/deployments/10143.json)
p(){ printf '\e[38;2;245;184;61mplans $\e[0m %s\n' "$1"; sleep 0.6; }
p "cast sig 'collect(address)'"
SEL=$(cast sig 'collect(address)'); echo "$SEL"
p "cast code \$POT | grep -c \${SEL#0x}  # testnet"
cast code "$POT" --rpc-url $R | grep -c "${SEL#0x}"
p "forge test --match-path test/unit/PotCollect.t.sol"
(cd contracts && forge test --match-path test/unit/PotCollect.t.sol 2>&1) | grep -E '^\[(PASS|FAIL)|^Suite' | sed -E 's/ \(gas: [0-9]+\)//; s/test_collect_//; s/; finished in.*//'
sleep 1
