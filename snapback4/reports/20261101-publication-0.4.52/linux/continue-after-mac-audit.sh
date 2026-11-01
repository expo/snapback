#!/bin/bash
set -euo pipefail
K=$HOME/sb4-pub-0452-kit; R=$HOME/sb4-pub-0452-records
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
trap 'echo $? > "$R/continue-after-mac-audit.exit"' EXIT
[ "$(cat "$R/publication-source-audit-linux.exit")" = 0 ]
ssh ccheever@charlies-macbook-pro-m5max-black 'cat ~/sb4-pub-0452/preflight-publication-source/audit.exit' > "$R/publication-source-audit-mac.exit"
[ "$(cat "$R/publication-source-audit-mac.exit")" = 0 ]
rsync -a ccheever@charlies-macbook-pro-m5max-black:sb4-pub-0452/preflight-publication-source/audit/ "$R/audit-publication-source-mac/"
ssh ccheever@charlies-macbook-pro-m5max-black 'cat ~/sb4-pub-0452/early-audit-retry.log' > "$R/publication-source-audit-mac-retry.log"
node --input-type=module - "$R" <<'JS'
import assert from 'node:assert/strict';import{readFileSync}from'node:fs';const r=process.argv[2];for(const h of ['linux','mac']){const q=JSON.parse(readFileSync(r+'/audit-publication-source-'+h+'/summary.json'));assert(q.status==='passed'&&q.cases.length===2&&q.cases.every(c=>c.status==='passed'&&c.vulnerabilities.total===0&&c.warnings.length===0));}
JS
C=$(git -C ~/sb4-pub-0441 rev-parse HEAD)
ssh ccheever@charlies-macbook-pro-m5max-black "printf '%s\n' '$C' > ~/sb4-pub-0452/native-audits-green.sha"
python3 "$K/log-status.py" "Both-host early starter audits PASS zero findings/warnings at release draft $C, exact tarball SHA256 equal. Fresh Mac retry supersedes only launcher refusal, whose raw evidence remains. Starting release affected/inventory/ref checks. No native build or upload."
(cd "$HOME/sb4-pub-0441/snapback4/lean" && lake build quarry-oracle) > "$R/release-lean-setup.log" 2>&1
export SNAPBACK4_REQUIRE_LEAN=1
bash "$K/release-checks.sh"
