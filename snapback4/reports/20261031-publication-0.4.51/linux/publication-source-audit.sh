#!/bin/bash
set -eu
K=$HOME/sb4-pub-0451-kit; R=$HOME/sb4-pub-0451-records; W=$HOME/sb4-pub-0441/snapback4
M=ccheever@charlies-macbook-pro-m5max-black
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
[ "$(cat "$R/publication-source-preflight-prepare.exit")" = 0 ]
[ "$(ssh "$M" 'git -C ~/sb4-pub-0444-wt rev-parse HEAD')" = "$(git -C "$W" rev-parse HEAD)" ]
C=$(git -C "$W" rev-parse HEAD); printf '%s\n' "$C" > "$K/publication-source-source.sha"
mkdir -p "$K/publication-source-audit-inputs/packages/snapback4" "$K/publication-source-audit-templates"
cp -a "$W/scripts" "$K/publication-source-audit-inputs/"
cp "$W/packages/snapback4/package.json" "$K/publication-source-audit-inputs/packages/snapback4/"
for kind in web expo; do
 mkdir -p "$K/publication-source-audit-templates/$kind"
 printf '{"private":true}\n' > "$K/publication-source-audit-templates/$kind/package.json"
 (cd "$K/publication-source-audit-templates/$kind"; "$W/target/debug/snapback4" init --no-install "--$kind") > "$R/publication-source-template-$kind.log" 2>&1
done
ssh "$M" 'mkdir -p ~/sb4-pub-0451/preflight-publication-source/client ~/sb4-pub-0451/preflight-publication-source/inputs ~/sb4-pub-0451/preflight-publication-source/templates'
rsync -a "$K/publication-source-audit-inputs/" "$M:sb4-pub-0451/preflight-publication-source/inputs/"
rsync -a "$K/publication-source-audit-templates/" "$M:sb4-pub-0451/preflight-publication-source/templates/"
rsync -a "$R/preflight-publication-source-client-0.4.51/" "$M:sb4-pub-0451/preflight-publication-source/client/"
rsync -a "$K/audit-fast.mjs" "$M:sb4-pub-0451/preflight-publication-source/audit-fast.mjs"
sha256sum "$R/preflight-publication-source-client-0.4.51/"*.tgz > "$R/publication-source-audit-tarballs-linux.sha256"
ssh "$M" 'shasum -a 256 ~/sb4-pub-0451/preflight-publication-source/client/*.tgz' > "$R/publication-source-audit-tarballs-mac.sha256"
python3 - "$R" <<'HASH_CHECK'
from pathlib import Path
import sys
r=Path(sys.argv[1])
def hashes(p):return sorted(line.split()[0] for line in p.read_text().splitlines())
assert hashes(r/'publication-source-audit-tarballs-linux.sha256')==hashes(r/'publication-source-audit-tarballs-mac.sha256')
HASH_CHECK
set +e
ssh "$M" "export PATH=\$HOME/.volta/tools/image/node/24.18.0/bin:\$HOME/.bun/bin:/opt/homebrew/bin:\$PATH; export PUB51_SOURCE=$C; export PUB51_STOCK_TEMPLATES=\$HOME/sb4-pub-0451/preflight-publication-source/templates; cd ~/sb4-pub-0451/preflight-publication-source; node audit-fast.mjs ~/sb4-pub-0444-wt/snapback4 client audit; rc=\$?; echo \"\$rc\" > audit.exit; exit \"\$rc\"" > "$R/publication-source-audit-mac.log" 2>&1 &
macpid=$!
node "$K/audit-fast.mjs" "$W" "$R/preflight-publication-source-client-0.4.51" "$R/audit-publication-source-linux" > "$R/publication-source-audit-linux.log" 2>&1
linuxrc=$?; echo "$linuxrc" > "$R/publication-source-audit-linux.exit"
wait "$macpid"; macrc=$?; echo "$macrc" > "$R/publication-source-audit-mac.exit"
set -e
rsync -a "$M:sb4-pub-0451/preflight-publication-source/audit/" "$R/audit-publication-source-mac/"
if [ "$linuxrc" != 0 ] || [ "$macrc" != 0 ]; then
 python3 "$K/log-status.py" "HOLD: final publication-source audit failed linux=$linuxrc mac=$macrc; native not started; classify before proceeding."
 exit 1
fi
python3 "$K/log-status.py" "Final pushed-source 0.4.51 preflight audits PASS on both hosts (web/Expo zero findings), exact tarball SHA256 matched across hosts; source $C. These are publication-source preflight bytes only. Final pushed-source preflight is green; native may start after SSH source setup. No upload."
ssh "$M" "printf '%s\n' '$C' > ~/sb4-pub-0451/native-audits-green.sha"
