#!/bin/bash
# One fresh attempt after invalid attempt1; invoked only after the ten-minute AC check.
set -euo pipefail
C=${1:?publication source}; K=$HOME/sb4-pub-0453; W=$HOME/sb4-pub-0453-wt
[ "$(git -C "$W" rev-parse HEAD)" = "$C" ]
[ -z "$(git -C "$W" status --porcelain)" ]
[ "$(cat "$K/native-final-started.sha")" = "$C" ]
[ "$(cat "$K/native-a1-power-cleanup.sha")" = "$C" ]
[ -e "$K/chain-a1.env-invalid" ]
[ "$(cat "$K/native-audits-green.sha")" = "$C" ]
[ "$(cat "$K/preflight-publication-source/audit.exit")" = 0 ]
[ ! -e "$K/native-2.exit" ] && [ ! -e "$K/chain-a2.log" ]
[ ! -e "$K/chain-a2.env-invalid" ] && [ ! -e "$K/audit-mac-early.exit" ]
[ ! -e "$W/snapback4/reports/20261104-expo-0.4.53/qualified.json" ]
[ ! -e "$W/snapback4/target/publication/client-0.4.53/prepare.json" ]
pmset -g batt | /usr/bin/grep 'AC Power' > /dev/null
ioreg -r -k AppleClamshellState | /usr/bin/grep '"AppleClamshellState" = No' > /dev/null
(set -o noclobber; printf '%s\n' "$C" > "$K/native-a2-started.sha")
cd "$K"
nohup caffeinate -ims bash ./chain-gate-a2.sh > chain-gate-a2.out 2>&1 < /dev/null &
echo "native attempt2 gate pid=$! source=$C"
nohup caffeinate -ims bash ./audit-after-prepare-a2.sh > audit-after-prepare-a2.out 2>&1 < /dev/null &
echo "canonical audit waiter pid=$!"
