#!/bin/bash
set -eu
K=$HOME/sb4-pub-0452-kit; R=$HOME/sb4-pub-0452-records; W=$HOME/sb4-pub-0441/snapback4
M=ccheever@charlies-macbook-pro-m5max-black
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
[ "$(cat "$R/opening-preflight-prepare.exit")" = 0 ]
C=$(git -C "$W" rev-parse HEAD); printf '%s\n' "$C" > "$K/opening-source.sha"
mkdir -p "$K/opening-audit-inputs/packages/snapback4" "$K/opening-audit-templates"
cp -a "$W/scripts" "$K/opening-audit-inputs/"
cp "$W/packages/snapback4/package.json" "$K/opening-audit-inputs/packages/snapback4/"
for kind in web expo; do
 mkdir -p "$K/opening-audit-templates/$kind"
 printf '{"private":true}\n' > "$K/opening-audit-templates/$kind/package.json"
 (cd "$K/opening-audit-templates/$kind"; "$W/target/debug/snapback4" init --no-install "--$kind") > "$R/opening-template-$kind.log" 2>&1
done
ssh "$M" 'mkdir -p ~/sb4-pub-0452/preflight-opening/client ~/sb4-pub-0452/preflight-opening/inputs ~/sb4-pub-0452/preflight-opening/templates'
rsync -a "$K/opening-audit-inputs/" "$M:sb4-pub-0452/preflight-opening/inputs/"
rsync -a "$K/opening-audit-templates/" "$M:sb4-pub-0452/preflight-opening/templates/"
rsync -a "$R/preflight-opening-client-0.4.50/" "$M:sb4-pub-0452/preflight-opening/client/"
rsync -a "$K/audit-fast.mjs" "$M:sb4-pub-0452/preflight-opening/audit-fast.mjs"
sha256sum "$R/preflight-opening-client-0.4.50/"*.tgz > "$R/opening-audit-tarballs-linux.sha256"
ssh "$M" 'shasum -a 256 ~/sb4-pub-0452/preflight-opening/client/*.tgz' > "$R/opening-audit-tarballs-mac.sha256"
python3 - "$R" <<'HASH_CHECK'
from pathlib import Path
import sys
r=Path(sys.argv[1])
def hashes(p):return sorted(line.split()[0] for line in p.read_text().splitlines())
assert hashes(r/'opening-audit-tarballs-linux.sha256')==hashes(r/'opening-audit-tarballs-mac.sha256')
HASH_CHECK
set +e
ssh "$M" "export PATH=\$HOME/.volta/tools/image/node/24.18.0/bin:\$HOME/.bun/bin:/opt/homebrew/bin:\$PATH; export PUB52_SOURCE=$C; export PUB52_STOCK_TEMPLATES=\$HOME/sb4-pub-0452/preflight-opening/templates; cd ~/sb4-pub-0452/preflight-opening; node audit-fast.mjs inputs client audit; rc=\$?; echo \"\$rc\" > audit.exit; exit \"\$rc\"" > "$R/opening-audit-mac.log" 2>&1 &
macpid=$!
node "$K/audit-fast.mjs" "$W" "$R/preflight-opening-client-0.4.50" "$R/audit-opening-linux" > "$R/opening-audit-linux.log" 2>&1
linuxrc=$?; echo "$linuxrc" > "$R/opening-audit-linux.exit"
wait "$macpid"; macrc=$?; echo "$macrc" > "$R/opening-audit-mac.exit"
set -e
rsync -a "$M:sb4-pub-0452/preflight-opening/audit/" "$R/audit-opening-mac/"
if [ "$linuxrc" != 0 ] || [ "$macrc" != 0 ]; then
 python3 "$K/log-status.py" "HOLD: refreshed opening-fix audit failed linux=$linuxrc mac=$macrc; broad selector not started; classify before proceeding."
 exit 1
fi
python3 "$K/log-status.py" "Refreshed prepared opening-fix 0.4.50 preflight audits PASS on both hosts (web/Expo zero findings), exact tarball SHA256 matched across hosts; source $C. These are landing preflight bytes only. Starting conservatively broad final fix-stack affected rerun, which also supplies the required full rerun for isolated flakes; no uploads."
"$HOME/sb4-loop/unit.sh" pub52-opening-broad 80G "$HOME/sb4-pub-0441" "bash $K/check-opening-fix.sh"
