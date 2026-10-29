#!/bin/bash
# Flake rule for the pre-darwin a2 reds at 9c77333f2d: server-e2e and export-background each alone x6 (dry-run env). Only if
# every run passes (both 6/6) does this start gate-after-triage-a2.sh (refresh + tolerant gate); otherwise it stops for triage.
cd $HOME/sb4-pub-0449; L=$HOME/sb4-pub-0449/chain-pre-a2.log
log() { echo "$(date -u +%FT%TZ) $*" >> $L; }
log "flake-rule isolation start: server-e2e x6, export-background x6"
for f in server-e2e export-background; do bash ./iso-file.sh $f 6 > iso-$f-a2.out 2>&1; log "$(grep -h "alone:" isolated/iso-$f/summary.txt | tail -1)"; done
ok=1; for f in server-e2e export-background; do grep -q "$f alone: 6/6 passed" isolated/iso-$f/summary.txt || ok=0; done
if [ "$ok" = 1 ]; then log "both 6/6 alone: flakes; starting gate-after-triage-a2.sh"; bash ./gate-after-triage-a2.sh; else log "STOP: isolation not 6/6; no dry run until triaged"; fi
