#!/bin/bash
set -euo pipefail
K=$HOME/sb4-pub-0453; W=$HOME/sb4-pub-0453-wt/snapback4
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
trap 'echo $? > "$K/audit-mac-pre-dry-after-linux-recovery.exit"' EXIT
PUB52_STOCK_TEMPLATES=$K/preflight-publication-source/templates node "$K/audit-fast.mjs" "$W" "$W/target/publication/client-0.4.53" "$K/isolated/audit-mac-pre-dry-after-linux-recovery" > "$K/audit-mac-pre-dry-after-linux-recovery.log" 2>&1
