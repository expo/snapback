#!/bin/bash
set -e
cd /home/ccheever/sb4-intent/lane-ct/snapback4
for mode in traced untraced; do
  extra=()
  if [ "$mode" = untraced ]; then extra+=(--no-trace); fi
  i=0
  for design in pool inline inline pool; do
    binary=/tmp/ct-after
    if [ "$design" = inline ]; then binary=/tmp/ct-r1-inline; fi
    node scripts/contended-reads.mjs --work /tmp/ct-cal28 --binary "$binary" --out "reports/20261001-ct-contended-reads/round1/$mode-$i-$design" "${extra[@]}" > "reports/20261001-ct-contended-reads/round1/$mode-$i-$design.log" 2>&1
    i=$((i+1))
  done
done
