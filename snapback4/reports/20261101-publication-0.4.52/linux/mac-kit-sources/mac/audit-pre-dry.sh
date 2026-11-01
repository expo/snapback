#!/bin/bash
set -euo pipefail
K=$HOME/sb4-pub-0452; W=$HOME/sb4-pub-0444-wt/snapback4
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
trap 'echo $? > "$K/audit-mac-pre-dry.exit"' EXIT
PUB52_STOCK_TEMPLATES=$K/preflight-publication-source/templates node "$K/audit-fast.mjs" "$W" "$W/target/publication/client-0.4.52" "$K/isolated/audit-mac-pre-dry" > "$K/audit-mac-pre-dry.log" 2>&1
