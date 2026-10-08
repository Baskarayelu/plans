#!/usr/bin/env bash
# Installs (or reinstalls) a launchd job on this Mac that runs keep-fresh.sh every 30 minutes.
# Log: ~/Library/Logs/plans-fx-keep-fresh.log. Remove: launchctl bootout gui/$(id -u)/in.oxo.plans.fx-keep-fresh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/in.oxo.plans.fx-keep-fresh.plist"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>in.oxo.plans.fx-keep-fresh</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$HERE/keep-fresh.sh</string></array>
  <key>StartInterval</key><integer>1800</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/plans-fx-keep-fresh.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/plans-fx-keep-fresh.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/in.oxo.plans.fx-keep-fresh" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed: $PLIST"
