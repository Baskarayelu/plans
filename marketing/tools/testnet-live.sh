#!/bin/bash
# Real run: the testnet deployment record, MonadVision's verification status for each contract,
# and the Stage A end-to-end result.
cd "$(dirname "$0")/../.." || exit 1
export LC_ALL=en_US.UTF-8
p(){ printf '\e[38;2;245;184;61mplans $\e[0m %s\n' "$1"; sleep 0.6; }
D=contracts/deployments/10143.json
p "# deployed on Monad testnet: gas estimate → limit"
jq -r '.transactions[] | select(.blockNumber >= 68940999) | "\(.contract)\t\(.address[0:6])…\(.address[-4:])\t\(.estimate|tonumber)\t\(.gasLimit|tonumber)"' $D |
  while IFS=$'\t' read -r c a e l; do printf '%-12s %s %9s → %s\n' "$c" "$a" "$(printf "%'d" $e)" "$(printf "%'d" $l)"; done
p "# MonadVision verification"
for k in keyRegistry fxReference plansSend plansFactory claimEscrow potImplementation; do
  a=$(jq -r .$k $D)
  s=$(curl -s "https://sourcify-api-monad.blockvision.org/v2/contract/10143/$a" | jq -r '.match // .runtimeMatch // "none"')
  printf '%-18s %s\n' "$k" "$s"
done
p "npm --prefix e2e/stage-a test | tail -1"
npm --prefix e2e/stage-a test 2>&1 | tail -1
sleep 1
