#!/bin/bash
# Read-only handoff of the completed durable Darwin publication stage.
set -euo pipefail
K=$HOME/sb4-pub-0452-kit
R=$HOME/sb4-pub-0452-records
W=$HOME/sb4-pub-0441
M=ccheever@charlies-macbook-pro-m5max-black
S=sb4-pub-0444-wt/snapback4/target/publication/snapback4-darwin-arm64-0.4.52
D=$R/staged-0.4.52
C=$(git -C "$W" rev-parse HEAD)
test "$C" = "$(cat "$K/source.sha")"
test ! -e "$D"
timeout 45 ssh -o BatchMode=yes -o ConnectTimeout=10 "$M" 'test "$(cat ~/sb4-pub-0452/dry-run-1.exit)" = done && test ! -e ~/sb4-pub-0452/dry-run-1.env-invalid'
mkdir "$D"
timeout 300 rsync -a --no-links --timeout=60 --include='*.tgz' --include=resume.json --include=linux-receipt.json --exclude='*' -e 'ssh -o BatchMode=yes -o ConnectTimeout=15' --rsync-path=/usr/bin/rsync "$M:$S/" "$D/"
(cd "$D" && sha256sum *.tgz) > "$R/staged-linux.sha256"
timeout 45 ssh -o BatchMode=yes -o ConnectTimeout=10 "$M" 'cd ~/sb4-pub-0444-wt/snapback4/target/publication/snapback4-darwin-arm64-0.4.52 && shasum -a 256 *.tgz' > "$R/staged-mac.sha256"
diff -u "$R/staged-linux.sha256" "$R/staged-mac.sha256"
node "$K/validate-staged.mjs" "$D"
