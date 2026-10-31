#!/bin/bash
set -eu
K=$HOME/sb4-pub-0451-kit; R=$HOME/sb4-pub-0451-records; W=$HOME/sb4-pub-0441/snapback4
M=ccheever@charlies-macbook-pro-m5max-black
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
[ "$(cat "$R/opening-requalified-preflight-prepare.exit")" = 0 ]
C=$(git -C "$W" rev-parse HEAD); printf '%s\n' "$C" > "$K/opening-requalified-source.sha"
mkdir -p "$K/opening-requalified-audit-inputs/packages/snapback4" "$K/opening-requalified-audit-templates"
cp -a "$W/scripts" "$K/opening-requalified-audit-inputs/"
cp "$W/packages/snapback4/package.json" "$K/opening-requalified-audit-inputs/packages/snapback4/"
for kind in web expo; do
 mkdir -p "$K/opening-requalified-audit-templates/$kind"
 printf '{"private":true}\n' > "$K/opening-requalified-audit-templates/$kind/package.json"
 (cd "$K/opening-requalified-audit-templates/$kind"; "$W/target/debug/snapback4" init --no-install "--$kind") > "$R/opening-requalified-template-$kind.log" 2>&1
done
ssh "$M" 'mkdir -p ~/sb4-pub-0451/preflight-opening-requalified/client ~/sb4-pub-0451/preflight-opening-requalified/inputs ~/sb4-pub-0451/preflight-opening-requalified/templates'
rsync -a "$K/opening-requalified-audit-inputs/" "$M:sb4-pub-0451/preflight-opening-requalified/inputs/"
rsync -a "$K/opening-requalified-audit-templates/" "$M:sb4-pub-0451/preflight-opening-requalified/templates/"
rsync -a "$R/preflight-opening-requalified-client-0.4.50/" "$M:sb4-pub-0451/preflight-opening-requalified/client/"
rsync -a "$K/audit-fast.mjs" "$M:sb4-pub-0451/preflight-opening-requalified/audit-fast.mjs"
sha256sum "$R/preflight-opening-requalified-client-0.4.50/"*.tgz > "$R/opening-requalified-audit-tarballs-linux.sha256"
ssh "$M" 'shasum -a 256 ~/sb4-pub-0451/preflight-opening-requalified/client/*.tgz' > "$R/opening-requalified-audit-tarballs-mac.sha256"
python3 - "$R" <<'HASH_CHECK'
from pathlib import Path
import sys
r=Path(sys.argv[1])
def hashes(p):return sorted(line.split()[0] for line in p.read_text().splitlines())
assert hashes(r/'opening-requalified-audit-tarballs-linux.sha256')==hashes(r/'opening-requalified-audit-tarballs-mac.sha256')
HASH_CHECK
set +e
ssh "$M" "export PATH=\$HOME/.volta/tools/image/node/24.18.0/bin:\$HOME/.bun/bin:/opt/homebrew/bin:\$PATH; export PUB51_SOURCE=$C; export PUB51_STOCK_TEMPLATES=\$HOME/sb4-pub-0451/preflight-opening-requalified/templates; cd ~/sb4-pub-0451/preflight-opening-requalified; node audit-fast.mjs inputs client audit; rc=\$?; echo \"\$rc\" > audit.exit; exit \"\$rc\"" > "$R/opening-requalified-audit-mac.log" 2>&1 &
macpid=$!
node "$K/audit-fast.mjs" "$W" "$R/preflight-opening-requalified-client-0.4.50" "$R/audit-opening-requalified-linux" > "$R/opening-requalified-audit-linux.log" 2>&1
linuxrc=$?; echo "$linuxrc" > "$R/opening-requalified-audit-linux.exit"
wait "$macpid"; macrc=$?; echo "$macrc" > "$R/opening-requalified-audit-mac.exit"
set -e
rsync -a "$M:sb4-pub-0451/preflight-opening-requalified/audit/" "$R/audit-opening-requalified-mac/"
if [ "$linuxrc" != 0 ] || [ "$macrc" != 0 ]; then
 python3 "$K/log-status.py" "HOLD: refreshed opening-requalified-fix audit failed linux=$linuxrc mac=$macrc; broad selector not started; classify before proceeding."
 exit 1
fi
python3 "$K/log-status.py" "Refreshed prepared opening-requalified-fix 0.4.50 preflight audits PASS on both hosts (web/Expo zero findings), exact tarball SHA256 matched across hosts; source $C. These are landing preflight bytes only. Starting conservatively broad final fix-stack affected rerun, which also supplies the required full rerun for isolated flakes; no uploads."
"$HOME/sb4-loop/unit.sh" pub51-opening-broad 80G "$HOME/sb4-pub-0441" "bash $K/check-opening-fix.sh"
"$HOME/sb4-loop/unit.sh" pub51-opening-disk-watch 1G "$HOME/sb4-pub-0441" "bash $K/watch-opening-broad.sh sb4-pub51-opening-broad $R/opening-requalified-broad-disk.log"
