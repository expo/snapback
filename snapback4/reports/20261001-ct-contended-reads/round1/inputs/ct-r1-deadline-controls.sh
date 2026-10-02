#!/usr/bin/env bash
set -eu
cd /home/ccheever/sb4-intent/lane-ct/snapback4
r=reports/20261001-ct-contended-reads/round1
while [ ! -f "$r/qualification/ka-transport.exit" ]; do sleep 5; done
for design in before demoted restored; do
 case "$design" in
 before) binary=/tmp/ct-before ;;
 demoted) binary=/tmp/ct-r1-pool-cpu ;;
 restored) binary=/tmp/ct-r1-final ;;
 esac
 node scripts/contended-reads.mjs --mixed --deadline-only --binary "$binary" --out "$r/deadline-$design" > "$r/deadline-$design.log" 2>&1
done
# Exercise the corrected complete mode as well; retained old matrices remain evidence.
node scripts/contended-reads.mjs --mixed --seconds 65 --levels 0 --binary /tmp/ct-r1-final --out "$r/mixed-corrected-smoke" > "$r/mixed-corrected-smoke.log" 2>&1
