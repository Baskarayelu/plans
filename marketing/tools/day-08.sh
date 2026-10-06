#!/bin/bash
# Real run: the invariant suite, the regression tests for the bug it caught, and the full contract suite.
cd "$(dirname "$0")/../../contracts" || exit 1
p(){ printf '\e[38;2;245;184;61mplans/contracts $\e[0m %s\n' "$1"; sleep 0.6; }
p "forge test --match-contract PotInvariants | grep -E 'PASS|result'"
forge test --color always --match-contract PotInvariants 2>&1 | grep -E 'PASS|result'
p "forge test --match-contract PotBugRepro | grep PASS"
forge test --color always --match-contract PotBugRepro 2>&1 | grep PASS
p "forge test | tail -1"
forge test --color always 2>&1 | tail -1
sleep 1
