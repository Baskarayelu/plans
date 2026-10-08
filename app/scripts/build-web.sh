#!/usr/bin/env bash
# Build the Plans web app (the same Expo codebase, react-native-web) as a static single-page app
# served by the site at https://plans.0xo.in/app.
#   [CLEAR=0] scripts/build-web.sh [testnet|mainnet] [outDir]   (clears Metro's cache unless CLEAR=0)
# Default outDir: ../site/public/app (Next serves it as static files; site/next.config.mjs rewrites
# /app/* to /app/index.html so deep links work). Contract addresses come from
# ../contracts/deployments/<chainId>.json at build time, like the APK.
set -euo pipefail
NET="${1:-testnet}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${2:-$HERE/../site/public/app}"

# Same copy rule as the APK: no crypto vocabulary in anything a person sees.
node "$HERE/scripts/check-copy.mjs"

export PLANS_WEB=1
export APP_NETWORK="$NET"
export NODE_ENV=production
# The network's relayer (its /v1/config publishes the indexer URL at runtime, as in the app).
export PLANS_RELAYER_URL_TESTNET="${PLANS_RELAYER_URL_TESTNET:-https://relayer-production-ecef.up.railway.app}"
export PLANS_RELAYER_URL_MAINNET="${PLANS_RELAYER_URL_MAINNET:-https://relayer.plans.0xo.in}"
if [ "$NET" = "mainnet" ]; then
  RELAYER="$PLANS_RELAYER_URL_MAINNET"
  # A mainnet bundle without the deployed addresses would show "not deployed yet" everywhere.
  [ -f "$HERE/../contracts/deployments/143.json" ] || { echo "web build: contracts/deployments/143.json missing (deploy mainnet first)" >&2; exit 1; }
else
  RELAYER="$PLANS_RELAYER_URL_TESTNET"
fi
export RELAYER

cd "$HERE"
rm -rf "$OUT"
npx expo export --platform web --output-dir "$OUT" $([ "${CLEAR:-1}" = "0" ] || echo --clear) >/dev/null
rm -f "$OUT/metadata.json"
# Expo exports package assets (fonts, icons) under assets/node_modules/…. Nothing under a node_modules
# path reaches production: git ignores it and the Vercel CLI does not upload it. Move every such
# directory to "pkg" and rewrite the URLs that point at it, then refuse a build that still has one.
while d="$(find "$OUT" -type d -name node_modules -print -quit)" && [ -n "$d" ]; do
  mv "$d" "$(dirname "$d")/pkg"
done
find "$OUT" -type f \( -name "*.js" -o -name "*.html" -o -name "*.css" -o -name "*.json" -o -name "*.map" \) -print0 |
  xargs -0 perl -pi -e '1 while s#(/assets/(?:[^"'"'"'\s()]*/)?)node_modules/#$1pkg/#g'
if find "$OUT" -name node_modules | grep -q . || grep -rlq "assets/[^\"' ]*node_modules" "$OUT"; then
  echo "web build: a node_modules path is still in the export (it would 404 in production)" >&2
  exit 1
fi
# The bundle must carry this app's config (contract addresses, relayer): refuse a bundle without it.
grep -q "$RELAYER" "$OUT"/_expo/static/js/web/entry-*.js || { echo "web build: app config missing from the bundle (stale Metro cache?)" >&2; exit 1; }
# Record what was built (no secrets): network, chain, relayer and contract addresses.
node -e '
const fs = require("fs");
process.env.PLANS_WEB = "1";
const out = process.argv[1];
const html = fs.readFileSync(out + "/index.html", "utf8");
const bundle = (html.match(/_expo\/static\/js\/web\/[^"]+\.js/) || [""])[0];
fs.writeFileSync(out + "/build.json", JSON.stringify({ network: process.env.APP_NETWORK, relayer: process.env.RELAYER, bundle, builtAt: new Date().toISOString() }, null, 2) + "\n");
' "$OUT"
du -sh "$OUT" | cut -f1 | xargs echo "web app →" "$OUT" "·"
