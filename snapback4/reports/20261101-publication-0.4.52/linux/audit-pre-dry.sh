#!/bin/bash
set -euo pipefail
K=$HOME/sb4-pub-0452-kit; R=$HOME/sb4-pub-0452-records; W=$HOME/sb4-pub-0441/snapback4
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH
trap 'echo $? > "$R/audit-linux-pre-dry.exit"' EXIT
PUB52_STOCK_TEMPLATES=$K/publication-source-audit-templates node "$K/audit-fast.mjs" "$W" "$W/target/publication/client-0.4.52" "$R/audit-linux-pre-dry" > "$R/audit-linux-pre-dry.log" 2>&1
