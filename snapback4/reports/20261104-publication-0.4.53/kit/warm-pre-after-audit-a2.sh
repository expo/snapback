#!/bin/bash
set -eu
K=$HOME/sb4-pub-0453; W=$HOME/sb4-pub-0453-wt/snapback4; C=${1:?final source}
cd "$K"
[ "$(git -C "$W" rev-parse HEAD)" = "$C" ]
[ "$(cat audit-mac-early.exit)" = 0 ]
/usr/bin/grep -q 'gate: chain exit 0 (env-ok)' chain-a2.log
while ! pmset -g batt | head -1 | /usr/bin/grep -q 'AC Power'; do echo "$(date -u +%FT%TZ) wait for AC before warm (600s)"; sleep 600; done
ATTEMPT=1 bash ./publish.sh lean > lean-a2.log 2>&1
[ "$(cat lean-1.exit)" = done ]
ATTEMPT=1 bash ./publish.sh warm > warm-a2.log 2>&1
[ "$(cat warm-1.exit)" = done ]
exec bash ./chain-pre-a2.sh
