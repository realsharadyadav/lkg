#!/usr/bin/env bash
# Bump the app build number everywhere it appears. Run before EVERY push to main:
#   scripts/bump-build.sh
# Updates: sw.js cache name (forces phones to pick up the new version),
#          ?v= on the CSS/JS tags in index.html, and "build N" in Settings.
set -euo pipefail
cd "$(dirname "$0")/.."
cur=$(sed -n "s/.*lkg-shell-v\([0-9]*\).*/\1/p" sw.js)
next=$((cur + 1))
sed -i "s/lkg-shell-v$cur/lkg-shell-v$next/" sw.js
sed -i -E "s/\?v=[0-9]+\"/?v=$next\"/g; s/build [0-9]+ ·/build $next ·/" index.html
echo "build $cur -> $next"
grep -c "v=$next\"" index.html >/dev/null
