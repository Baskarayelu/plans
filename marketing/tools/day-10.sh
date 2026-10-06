#!/bin/bash
# Real run on a scratch copy of the app (the repo is not touched): the copy check passes,
# then a crypto word is put into the Send screen and the APK build refuses to start.
SRC="$(cd "$(dirname "$0")/../../app" && pwd)"
W="${TMPDIR:-/tmp}/plans-copycheck/app"
rm -rf "$W"; mkdir -p "$W"; cp -R "$SRC/src" "$SRC/scripts" "$SRC/package.json" "$W/"
cd "$W" || exit 1
p(){ printf '\e[38;2;245;184;61mplans/app $\e[0m %s\n' "$1"; sleep 0.6; }
p "npm run -s lint:copy"
npm run -s lint:copy
p "sed -i '' 's/>Send</>Send to a wallet address</' 'src/app/(tabs)/send.tsx'"
sed -i '' 's/>Send</>Send to a wallet address</' 'src/app/(tabs)/send.tsx'
p "bash scripts/build-apk.sh mainnet release"
bash scripts/build-apk.sh mainnet release; printf '\e[2mexit %s\e[0m\n' "$?"
sleep 1
