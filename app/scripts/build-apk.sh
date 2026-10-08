#!/usr/bin/env bash
# Build a signed Plans APK locally.
#   scripts/build-apk.sh <testnet|mainnet> <debug|release>
# Both variants are signed with the Plans release keystore (passkeys and App Links are verified
# against that certificate). The keystore path/password are read from the environment, or from
# ../../secrets (outside the repo) when not set. Nothing secret is written into the repository.
set -euo pipefail
NET="${1:-testnet}"
VARIANT="${2:-debug}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS="${PLANS_SECRETS_DIR:-$HERE/../../secrets}"

# Refuse to build if any user-visible string uses crypto vocabulary (wallet, address, gas, transaction, …).
node "$HERE/scripts/check-copy.mjs"

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

export PLANS_KEYSTORE_PATH="${PLANS_KEYSTORE_PATH:-$SECRETS/plans-release.keystore}"
if [ -z "${PLANS_KEYSTORE_PASSWORD:-}" ] && [ -f "$SECRETS/keys.env" ]; then
  PLANS_KEYSTORE_PASSWORD="$(grep -E '^ANDROID_KEYSTORE_PASSWORD=' "$SECRETS/keys.env" | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
  export PLANS_KEYSTORE_PASSWORD
fi
if [ ! -f "$PLANS_KEYSTORE_PATH" ] || [ -z "${PLANS_KEYSTORE_PASSWORD:-}" ]; then
  echo "warning: no keystore/password; the APK will use the debug key and passkeys will not work" >&2
  unset PLANS_KEYSTORE_PATH
fi

export APP_NETWORK="$NET"
export PLANS_ABIS="${PLANS_ABIS:-arm64-v8a}"
export NODE_ENV=production
# The network's relayer, the same defaults as scripts/build-web.sh (app.config.ts's own testnet default,
# relayer-testnet.plans.0xo.in, has no DNS record). PLANS_RELAYER_URL[_TESTNET|_MAINNET] override it.
export PLANS_RELAYER_URL_TESTNET="${PLANS_RELAYER_URL_TESTNET:-${PLANS_RELAYER_URL:-https://relayer-production-ecef.up.railway.app}}"
export PLANS_RELAYER_URL_MAINNET="${PLANS_RELAYER_URL_MAINNET:-${PLANS_RELAYER_URL:-https://relayer.plans.0xo.in}}"
if [ "$NET" = "mainnet" ]; then RELAYER="$PLANS_RELAYER_URL_MAINNET"; else RELAYER="$PLANS_RELAYER_URL_TESTNET"; fi

cd "$HERE"
npx expo prebuild --platform android --clean --no-install >/dev/null
cd android
TASK="assemble$(tr '[:lower:]' '[:upper:]' <<< "${VARIANT:0:1}")${VARIANT:1}"
./gradlew "$TASK" -PreactNativeArchitectures="$PLANS_ABIS" --no-daemon -q
OUT="app/build/outputs/apk/$VARIANT/app-$VARIANT.apk"
mkdir -p "$HERE/dist"
DEST="$HERE/dist/plans-$NET-$VARIANT.apk"
cp "$OUT" "$DEST"
# The APK must carry this network's relayer in its app config (assets/app.config), or nothing it does reaches the chain.
unzip -p "$DEST" assets/app.config | grep -qF "\"relayerUrl\":\"$RELAYER\"" || { echo "apk build: the APK's app config doesn't name the relayer $RELAYER" >&2; exit 1; }
echo "$DEST"
"$ANDROID_HOME"/build-tools/36*/apksigner verify --print-certs "$DEST" 2>/dev/null | grep -i "SHA-256" | head -1 || true
