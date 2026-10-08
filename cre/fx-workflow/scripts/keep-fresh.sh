#!/usr/bin/env bash
# Keeps a fresh FxReference round on Monad testnet: if the newest round is older than MAX_AGE (default
# 3 h; the contract accepts rounds up to 6 h), runs the CRE workflow once with --broadcast. Meant to run
# every 30 minutes (scripts/install-keep-fresh.sh installs a launchd job on this Mac). Needs `cre login`
# (or CRE_API_KEY) and cre/fx-workflow/.env (CRE_ETH_PRIVATE_KEY of the simulation transmitter).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.cre/bin:$HOME/.foundry/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
RPC="${RPC:-https://testnet-rpc.monad.xyz}"
FX="${FX:-0xaB7eeDe1DA994137a340155f350A8F81358FFCa2}"
MAX_AGE="${MAX_AGE:-10800}"
now=$(date +%s)
last=$(cast call "$FX" "latestRoundTime()(uint64,uint64)" --rpc-url "$RPC" | sed -n 2p | awk '{print $1}')
age=$(( now - ${last:-0} ))
echo "$(date -u +%FT%TZ) newest round age ${age}s"
if [ "$age" -lt "$MAX_AGE" ]; then exit 0; fi
cd "$HERE"
out=$(cre workflow simulate fx-rates --target staging-settings --non-interactive --trigger-index 0 --broadcast 2>&1) || { echo "$out" | tail -20; exit 1; }
echo "$out" | grep -E "writeReport" || { echo "$out" | tail -20; exit 1; }
