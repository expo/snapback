#!/bin/bash
set -euo pipefail
K=$HOME/sb4-pub-0452-kit; R=$HOME/sb4-pub-0452-records
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
trap 'echo $? > "$R/early-audit-and-checks.exit"' EXIT
until [ -e "$R/publication-source-preflight-prepare.exit" ]; do sleep 10; done
[ "$(cat "$R/publication-source-preflight-prepare.exit")" = 0 ]
bash "$K/publication-source-audit.sh"
python3 "$K/log-status.py" 'Both-host draft starter audits passed; starting mandatory release affected/inventory/ref checks before release push. No upload.'
(cd "$HOME/sb4-pub-0441/snapback4/lean" && lake build quarry-oracle) > "$R/release-lean-setup.log" 2>&1
export SNAPBACK4_REQUIRE_LEAN=1
bash "$K/release-checks.sh"
