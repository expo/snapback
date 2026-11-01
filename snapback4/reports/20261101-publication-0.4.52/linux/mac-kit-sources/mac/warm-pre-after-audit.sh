#!/bin/bash
set -eu
K=$HOME/sb4-pub-0452; W=$HOME/sb4-pub-0444-wt/snapback4; C=${1:?final source}
cd "$K"
[ "$(git -C "$W" rev-parse HEAD)" = "$C" ]
[ "$(cat audit-mac-early.exit)" = 0 ]
grep -q 'gate: chain exit 0 (env-ok)' chain-a1.log
while ! pmset -g batt | head -1 | grep -q 'AC Power'; do echo "$(date -u +%FT%TZ) wait for AC before warm (600s)"; sleep 600; done
ATTEMPT=1 bash ./publish.sh lean > lean-a1.log 2>&1
[ "$(cat lean-1.exit)" = done ]
ATTEMPT=1 bash ./publish.sh warm > warm-a1.log 2>&1
[ "$(cat warm-1.exit)" = done ]
exec bash ./chain-pre-a1.sh
