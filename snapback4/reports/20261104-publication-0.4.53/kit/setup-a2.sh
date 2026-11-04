#!/bin/bash
set -e
C=${1:?new source}; K=$HOME/sb4-pub-0453; WT=$HOME/sb4-pub-0453-wt; W=$WT/snapback4
old=$(git -C "$WT" rev-parse --short=10 HEAD); A=$K/archive-a1-$old
[ ! -e "$A" ]; [ -z "$(git -C "$WT" status --porcelain)" ]
mkdir -p "$A"
for d in reports/20261104-publication-0.4.53 reports/20261104-expo-0.4.53; do [ ! -e "$W/$d" ] || mv "$W/$d" "$A/"; done
for d in target/publication/client-0.4.53 target/publication/snapback4-darwin-arm64-0.4.53 target/incoming/linux-0.4.53 target/expo-0.4.53; do [ ! -e "$W/$d" ] || mv "$W/$d" "$W/$d-a1-$old"; done
for d in isolated deferred-identity-a1 env-invalid-resource-wait-a1; do [ ! -e "$K/$d" ] || mv "$K/$d" "$A/"; done
for f in "$K"/*.log "$K"/*.out "$K"/*.diff "$K"/*.exit "$K"/*.pid "$K"/*.env-invalid "$K"/*sha256.txt; do [ ! -e "$f" ] || mv "$f" "$A/"; done
cd "$WT"; git checkout --detach "$C"; [ "$(git rev-parse HEAD)" = "$C" ]; [ -z "$(git status --porcelain)" ]
mkdir -p "$K/isolated" "$W/target/incoming/linux-0.4.53" "$W/reports/20261104-publication-0.4.53"
python3 - "$C" "$W" <<'JSON'
import json,sys,pathlib,datetime
c,w=sys.argv[1:];p=pathlib.Path(w)/'reports/20261104-publication-0.4.53/npm-identity-deferred.json';p.write_text(json.dumps({'source':c,'status':'deferred','ruling':'2026-10-30T17:10Z','recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'requirement':'npm whoami must succeed immediately before finish; 15-minute checks for at most 12 hours if unavailable'},indent=2))
JSON
cd "$K"
nohup caffeinate -ims bash ./chain-gate-a2.sh > chain-gate-a2.out 2>&1 < /dev/null &
echo "native-2 gate pid=$!"
nohup caffeinate -ims bash ./chain-pre-a2.sh > chain-pre-a2.out 2>&1 < /dev/null &
echo "pre-a2 chain pid=$!"
