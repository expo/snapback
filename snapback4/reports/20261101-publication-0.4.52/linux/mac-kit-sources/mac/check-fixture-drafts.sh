#!/bin/bash
set -u
K=$HOME/sb4-pub-0452; T=$HOME/sb4-pub-0444-wt/snapback4/packages/snapback4/test
cd "$K"; [ "$(cat triage-pre.exit)" = done ] || exit 1
log() { echo "$(date -u +%FT%TZ) $*" >> "$K/fixture-check.log"; }
pass=0
for f in dx12-serve dx10-process-accounts dx17-day2-check; do
 p="$T/$f.pub52-fixed.test.mjs"
 [ ! -e "$p" ] || { log "STOP: temporary draft exists $p"; exit 1; }
 cp "$K/isolated/fixture-drafts/$f.test.mjs" "$p"
 log "$f draft alone x3 start"
 bash ./iso-file.sh "$f.pub52-fixed" 3 >> fixture-check.out 2>&1
 rm -f "$p"
 s=$(tail -1 "$K/isolated/iso-$f.pub52-fixed/summary.txt")
 log "$s"
 case "$s" in *'alone: 3/3 passed') pass=$((pass+1));; esac
done
log "$pass/3 draft files passed all three runs"
[ "$pass" = 3 ]; rc=$?; echo "$rc" > fixture-check.exit; exit "$rc"
