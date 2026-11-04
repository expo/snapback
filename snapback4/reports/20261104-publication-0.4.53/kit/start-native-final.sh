#!/bin/bash
# Start only after source setup and both-host final-source audit.
set -euo pipefail
C=${1:?publication source}; K=$HOME/sb4-pub-0453; W=$HOME/sb4-pub-0453-wt
[ "$(git -C "$W" rev-parse HEAD)" = "$C" ]
[ -z "$(git -C "$W" status --porcelain)" ]
[ "$(cat "$K/native-audits-green.sha")" = "$C" ]
[ "$(cat "$K/preflight-publication-source/audit.exit")" = 0 ]
[ ! -e "$K/native-1.exit" ]
[ ! -e "$K/chain-a1.env-invalid" ]
# Prevent a retry after a lost SSH response from starting a duplicate gate.
(set -o noclobber; printf '%s\n' "$C" > "$K/native-final-started.sha")
cd "$K"
nohup caffeinate -ims bash ./chain-gate-a1.sh > chain-gate-a1.out 2>&1 < /dev/null &
echo "native gate pid=$!; source $C; resource/AC/lid watch active"
nohup caffeinate -ims bash ./audit-after-prepare.sh > audit-after-prepare.out 2>&1 < /dev/null &
echo "canonical audit waiter pid=$!"
