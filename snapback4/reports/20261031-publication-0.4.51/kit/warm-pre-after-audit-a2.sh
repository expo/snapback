#!/bin/bash
set -eu
K=$HOME/sb4-pub-0451; W=$HOME/sb4-pub-0444-wt/snapback4; C=${1:?final source}
cd "$K"
[ "$(git -C "$W" rev-parse HEAD)" = "$C" ]
[ "$(cat audit-mac-early.exit)" = 0 ]
grep -q 'gate: chain exit 0 (env-ok)' chain-a2.log
while ! pmset -g batt | head -1 | grep -q 'AC Power'; do echo "$(date -u +%FT%TZ) wait for AC before warm (600s)"; sleep 600; done
ATTEMPT=2 bash ./publish.sh lean > lean-a2.log 2>&1
[ "$(cat lean-2.exit)" = done ]
ATTEMPT=2 bash ./publish.sh warm > warm-a2.log 2>&1
[ "$(cat warm-2.exit)" = done ]
exec bash ./chain-pre-a2.sh
