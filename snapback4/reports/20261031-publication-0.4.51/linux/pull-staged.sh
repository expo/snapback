#!/bin/bash
# Read-only handoff of the completed durable Darwin publication stage.
set -euo pipefail
K=$HOME/sb4-pub-0451-kit
R=$HOME/sb4-pub-0451-records
W=$HOME/sb4-pub-0441
M=ccheever@charlies-macbook-pro-m5max-black
S=sb4-pub-0444-wt/snapback4/target/publication/snapback4-darwin-arm64-0.4.51
D=$R/staged-0.4.51
C=$(git -C "$W" rev-parse HEAD)
test "$C" = "$(cat "$K/source.sha")"
test ! -e "$D"
timeout 45 ssh -o BatchMode=yes -o ConnectTimeout=10 "$M" 'test "$(cat ~/sb4-pub-0451/dry-run-2.exit)" = done && test ! -e ~/sb4-pub-0451/dry-run-2.env-invalid'
mkdir "$D"
timeout 300 rsync -a --no-links --timeout=60 --include='*.tgz' --include=resume.json --include=linux-receipt.json --exclude='*' -e 'ssh -o BatchMode=yes -o ConnectTimeout=15' --rsync-path=/usr/bin/rsync "$M:$S/" "$D/"
(cd "$D" && sha256sum *.tgz) > "$R/staged-linux.sha256"
timeout 45 ssh -o BatchMode=yes -o ConnectTimeout=10 "$M" 'cd ~/sb4-pub-0444-wt/snapback4/target/publication/snapback4-darwin-arm64-0.4.51 && shasum -a 256 *.tgz' > "$R/staged-mac.sha256"
diff -u "$R/staged-linux.sha256" "$R/staged-mac.sha256"
node "$K/validate-staged.mjs" "$D"
