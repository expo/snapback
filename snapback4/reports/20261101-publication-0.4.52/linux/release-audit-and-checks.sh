#!/bin/bash
set -eu
K=$HOME/sb4-pub-0452-kit; R=$HOME/sb4-pub-0452-records; W=$HOME/sb4-pub-0441/snapback4
M=ccheever@charlies-macbook-pro-m5max-black
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
[ "$(cat "$R/release-preflight-prepare.exit")" = 0 ]
C=$(git -C "$W" rev-parse HEAD); printf '%s\n' "$C" > "$K/release-source.sha"
mkdir -p "$K/release-audit-inputs/packages/snapback4" "$K/release-audit-templates"
cp -a "$W/scripts" "$K/release-audit-inputs/"
cp "$W/packages/snapback4/package.json" "$K/release-audit-inputs/packages/snapback4/"
for kind in web expo; do
 mkdir -p "$K/release-audit-templates/$kind"
 printf '{"private":true}\n' > "$K/release-audit-templates/$kind/package.json"
 (cd "$K/release-audit-templates/$kind"; "$W/target/debug/snapback4" init --no-install "--$kind") > "$R/release-template-$kind.log" 2>&1
done
ssh "$M" 'mkdir -p ~/sb4-pub-0452/preflight-release/client ~/sb4-pub-0452/preflight-release/inputs ~/sb4-pub-0452/preflight-release/templates'
rsync -a "$K/release-audit-inputs/" "$M:sb4-pub-0452/preflight-release/inputs/"
rsync -a "$K/release-audit-templates/" "$M:sb4-pub-0452/preflight-release/templates/"
rsync -a "$R/preflight-release-client-0.4.52/" "$M:sb4-pub-0452/preflight-release/client/"
rsync -a "$K/audit-fast.mjs" "$M:sb4-pub-0452/preflight-release/audit-fast.mjs"
sha256sum "$R/preflight-release-client-0.4.52/"*.tgz > "$R/release-audit-tarballs-linux.sha256"
ssh "$M" 'shasum -a 256 ~/sb4-pub-0452/preflight-release/client/*.tgz' > "$R/release-audit-tarballs-mac.sha256"
python3 - "$R" <<'HASH_CHECK'
from pathlib import Path
import sys
r=Path(sys.argv[1])
def hashes(p):return sorted(line.split()[0] for line in p.read_text().splitlines())
assert hashes(r/'release-audit-tarballs-linux.sha256')==hashes(r/'release-audit-tarballs-mac.sha256')
HASH_CHECK
set +e
ssh "$M" "export PATH=\$HOME/.volta/tools/image/node/24.18.0/bin:\$HOME/.bun/bin:/opt/homebrew/bin:\$PATH; export PUB52_SOURCE=$C; export PUB52_STOCK_TEMPLATES=\$HOME/sb4-pub-0452/preflight-release/templates; cd ~/sb4-pub-0452/preflight-release; node audit-fast.mjs inputs client audit; rc=\$?; echo \"\$rc\" > audit.exit; exit \"\$rc\"" > "$R/release-audit-mac.log" 2>&1 &
macpid=$!
node "$K/audit-fast.mjs" "$W" "$R/preflight-release-client-0.4.52" "$R/audit-release-linux" > "$R/release-audit-linux.log" 2>&1
linuxrc=$?; echo "$linuxrc" > "$R/release-audit-linux.exit"
wait "$macpid"; macrc=$?; echo "$macrc" > "$R/release-audit-mac.exit"
set -e
rsync -a "$M:sb4-pub-0452/preflight-release/audit/" "$R/audit-release-mac/"
if [ "$linuxrc" != 0 ] || [ "$macrc" != 0 ]; then
 python3 "$K/log-status.py" "HOLD: refreshed release-fix audit failed linux=$linuxrc mac=$macrc; broad selector not started; classify before proceeding."
 exit 1
fi
python3 "$K/log-status.py" "Refreshed prepared release-fix 0.4.52 preflight audits PASS on both hosts (web/Expo zero findings), exact tarball SHA256 matched across hosts; source $C. These are release preflight bytes only. Starting mandatory release affected/inventory/ref checks; no uploads."
"$HOME/sb4-loop/unit.sh" pub52-release-checks-final 80G "$HOME/sb4-pub-0441" "bash $K/release-checks.sh"
