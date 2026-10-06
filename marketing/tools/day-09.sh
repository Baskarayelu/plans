#!/bin/bash
# Real run: the recorded live check (44 transactions) and a fresh live estimate on Monad mainnet.
cd "$(dirname "$0")/../../contracts" || exit 1
p(){ printf '\e[38;2;245;184;61mplans/contracts $\e[0m %s\n' "$1"; sleep 0.6; }
p "node tools/live-check.mjs"
node tools/live-check.mjs
p "node tools/ausd-relay-baseline.mjs"
node tools/ausd-relay-baseline.mjs
sleep 1
