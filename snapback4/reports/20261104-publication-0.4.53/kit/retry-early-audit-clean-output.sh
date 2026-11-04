#!/bin/bash
set -euo pipefail
K=$HOME/sb4-pub-0453; cd "$K"
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
A=$K/archive-copied-kit-output
mkdir -p "$A"
# The prior recursive code-only copy included starter scripts inside scratch output trees.
for d in isolated preflight-client-0.4.53 preflight-opening preflight-opening-requalified preflight-release; do
 [ ! -d "$d" ] || mv "$d" "$A/"
done
mv preflight-publication-source/audit "$A/initial-audit-output"
mkdir -p isolated
export PUB52_SOURCE=$(git -C "$HOME/sb4-pub-0453-wt" rev-parse HEAD)
export PUB52_STOCK_TEMPLATES=$K/preflight-publication-source/templates
cd preflight-publication-source
set +e
node audit-fast.mjs ~/sb4-pub-0453-wt/snapback4 client audit > "$K/early-audit-retry.log" 2>&1
rc=$?; echo "$rc" > audit.exit; exit "$rc"
