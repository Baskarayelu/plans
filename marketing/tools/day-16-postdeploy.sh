#!/bin/bash
# Real data: the post-deploy check that scripts/deploy-site.sh ran against the public URL after the
# 7 Oct deploy (Chrome and Safari, fresh sessions, phone and laptop widths, light and dark), and the
# build the public URL serves now. Reads the recorded run; no new run.
cd "$(dirname "$0")/../.." || exit 1
export LC_ALL=en_US.UTF-8
RUN=e2e/web/.runs/postdeploy-20261007T221523Z-a80c7ab
p(){ printf '\e[38;2;245;184;61mplans $\e[0m %s\n' "$1"; sleep 0.6; }
p "jq -cM '{at: .at[0:16], passed, failed}' \$RUN/results.json"
jq -cM '{at: .at[0:16], passed, failed}' $RUN/results.json
p "jq -r '.results|group_by(.browser)[]|…' \$RUN/results.json"
jq -r '.results | group_by(.browser)[] | "\(.[0].browser)\t\(map(select(.ok))|length)/\(length)"' $RUN/results.json
p "curl -s plans.0xo.in/app/build.json | jq -r .builtAt"
curl -s "https://plans.0xo.in/app/build.json?ts=$(date +%s)" | jq -r .builtAt
sleep 1
