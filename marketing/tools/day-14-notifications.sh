#!/bin/bash
# Real run: browser notifications are live. The relayer has web push (VAPID) on, publishes its
# public key, and the web app serves its service worker scoped to /app. Read-only HTTP GETs.
cd "$(dirname "$0")/../.." || exit 1
export LC_ALL=en_US.UTF-8
R=https://relayer-production-ecef.up.railway.app
p(){ printf '\e[38;2;245;184;61mplans $\e[0m %s\n' "$1"; sleep 0.6; }
p "curl -s \$R/v1/health | jq -c '.push.web'"
curl -s $R/v1/health | jq -c '.push.web'
p "curl -s \$R/v1/config | jq -r '.webPushPublicKey|length'"
curl -s $R/v1/config | jq -r '.webPushPublicKey|length'
p "curl -sI plans.0xo.in/app/sw.js | grep -iE '^(HTTP|content-type|service-worker)'"
curl -sI https://plans.0xo.in/app/sw.js | grep -iE '^(HTTP|content-type|service-worker)' | tr -d '\r'
sleep 1
