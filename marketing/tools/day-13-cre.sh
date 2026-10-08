#!/bin/bash
# Real run: the two Chainlink CRE rounds on FxReference (Monad testnet). Both were written by
# `cre workflow simulate --broadcast` through Chainlink's MockKeystoneForwarder (simulation),
# not by a deployed DON workflow. Read-only: receipts and view calls only.
cd "$(dirname "$0")/../.." || exit 1
export LC_ALL=en_US.UTF-8
R=https://testnet-rpc.monad.xyz
FX=$(jq -r .fxReference contracts/deployments/10143.json)
FWD=$(jq -r .fxConfig.simForwarder contracts/deployments/10143.json)
p(){ printf '\e[38;2;245;184;61mplans $\e[0m %s\n' "$1"; sleep 0.6; }
p "cast call \$FWD 'typeAndVersion()(string)'"
cast call "$FWD" 'typeAndVersion()(string)' --rpc-url $R
p "# simulate --broadcast txs, rounds 1 and 2"
for h in 0x66ad55a247afa377891003740866303791aaa41edfcff9c161e35015de16f8a6 0x94f2071fe1d1b2afc4e999552d106f5dd5158d64355cd13bfac10c445920c1b3; do
  j=$(cast receipt $h --rpc-url $R --json)
  printf '%s… %s  block %d  RoundWritten×%s\n' "${h:0:10}" "$(jq -r '.status' <<<"$j" | sed 's/0x1/ok/')" "$(jq -r .blockNumber <<<"$j")" \
    "$(jq --arg fx "$(echo "$FX" | tr A-F a-f)" '[.logs[]|select(.address==$fx)]|length' <<<"$j")"
done
p "cast call \$FX 'latestRoundTime()(uint64,uint64)'"
cast call "$FX" 'latestRoundTime()(uint64,uint64)' --rpc-url $R | head -1 | sed 's/^/round /'
p "# lastRates(): USD per 1 unit"
cast call "$FX" 'lastRates()(uint64[8])' --rpc-url $R | tr -d '[]' | tr ',' '\n' | awk '{print $1}' |
  paste -d' ' <(cast call "$FX" 'currencies()(bytes3[])' --rpc-url $R | tr -d '[] ' | tr ',' '\n' | while read -r c; do cast --to-ascii "$c"; done) - | awk '{printf "%s  %.6f\n", $1, $2/1e8}'
sleep 1
