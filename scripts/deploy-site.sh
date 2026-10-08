#!/usr/bin/env bash
# The one way to deploy plans.0xo.in (site + web app at /app). It deploys what is COMMITTED (HEAD),
# from a clean checkout, never the working tree (which may hold someone's unfinished changes):
#   1. build the web app into site/public/app of that checkout (skip with SKIP_APP_BUILD=1),
#   2. deploy the site to Vercel production and wait until that deployment is Ready,
#   3. confirm the public URL serves THIS build (site/public/app/build.json),
#   4. run e2e/web/postdeploy.mjs against the public URL (Chrome and Safari, clean sessions, both
#      widths and themes); any console error, failed own-origin request or blank screen fails it.
# Extra arguments go to postdeploy.mjs (e.g. --signed-in). Exit code 1 if any step fails.
# PLANS_WEB_NETWORK=mainnet builds the web app for Monad mainnet (needs contracts/deployments/143.json
# committed); default testnet.
#   scripts/deploy-site.sh [--signed-in] [--browsers chrome,safari]
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BASE="${PLANS_ORIGIN:-https://plans.0xo.in}"

# A clean checkout of HEAD, sharing the repo's installed dependencies and Vercel link.
ROOT="$(mktemp -d)/plans"
git -C "$REPO" worktree add --detach --quiet "$ROOT" HEAD
trap 'git -C "$REPO" worktree remove --force "$ROOT" >/dev/null 2>&1 || true' EXIT
for d in app site e2e/web; do ln -s "$REPO/$d/node_modules" "$ROOT/$d/node_modules"; done
cp -R "$REPO/site/.vercel" "$ROOT/site/.vercel"
echo "deploy: HEAD $(git -C "$ROOT" rev-parse --short HEAD) from a clean checkout"

if [ "${SKIP_APP_BUILD:-0}" != "1" ]; then
  bash "$ROOT/app/scripts/build-web.sh" "${PLANS_WEB_NETWORK:-testnet}"
fi
BUILT_AT="$(node -p 'require(process.argv[1]).builtAt' "$ROOT/site/public/app/build.json")"

cd "$ROOT/site"
LOG="$(mktemp)"
# The CLI sometimes loses its connection while the build continues ("fetch failed"); the deployment
# URL is printed before that, so read it and wait on the deployment itself.
URL=""
for attempt in 1 2 3; do
  npx vercel deploy --prod --yes 2>&1 | tee "$LOG" || true
  URL="$(grep -oE 'https://plans-0xo-[a-z0-9]+-[a-z0-9-]+\.vercel\.app' "$LOG" | tail -1)"
  [ -n "$URL" ] && break
  echo "deploy: upload attempt $attempt failed before a deployment was created; retrying" >&2
  sleep 15
done
rm -f "$LOG"
[ -n "$URL" ] || { echo "deploy: no deployment URL from the Vercel CLI" >&2; exit 1; }
echo "deploy: waiting for $URL"
for i in $(seq 1 60); do
  # Read all of inspect's output (an early awk exit would break the pipe and, with pipefail, end the script).
  STATUS="$( (npx vercel inspect "$URL" 2>&1 || true) | awk '/^ *status/ && !s {s=$NF} END {print s}')"
  case "$STATUS" in
    Ready) break ;;
    Error | Canceled) echo "deploy: $URL is $STATUS" >&2; exit 1 ;;
  esac
  sleep 10
done
[ "$STATUS" = "Ready" ] || { echo "deploy: $URL not Ready after 10 minutes" >&2; exit 1; }

LIVE_AT="$(curl -fsS -H 'Cache-Control: no-cache' "$BASE/app/build.json?ts=$(date +%s)" | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).builtAt')"
if [ "$LIVE_AT" != "$BUILT_AT" ]; then
  echo "deploy: $BASE serves the web build from $LIVE_AT, expected $BUILT_AT" >&2
  exit 1
fi
echo "deploy: $BASE serves this build ($BUILT_AT)"

# Results and screenshots go to the repo (e2e/evidence/postdeploy, committed), not the throwaway checkout.
OUT="$REPO/e2e/evidence/postdeploy/postdeploy-$(date -u +%Y%m%dT%H%M%SZ)-$(git -C "$ROOT" rev-parse --short HEAD)"
cd "$ROOT/e2e/web"
node postdeploy.mjs --base "$BASE" --out "$OUT" "$@"
