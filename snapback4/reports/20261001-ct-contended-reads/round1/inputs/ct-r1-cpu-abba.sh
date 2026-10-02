#!/bin/bash
set -e
cd /home/ccheever/sb4-intent/lane-ct/snapback4
for mode in cpu cpu-untraced; do
 extra=()
 if [ "$mode" = cpu-untraced ]; then extra+=(--no-trace); fi
 i=0
 for design in pool inline inline pool; do
  taskset -c 0-9 node scripts/contended-reads.mjs --work /tmp/ct-cal28 --binary "/tmp/ct-r1-$design-cpu" --out "reports/20261001-ct-contended-reads/round1/$mode-$i-$design" "${extra[@]}" > "reports/20261001-ct-contended-reads/round1/$mode-$i-$design.log" 2>&1
  i=$((i+1))
 done
done
