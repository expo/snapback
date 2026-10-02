#!/bin/bash
# Run once after the sole full suite exits; no other CT tests/builds overlap.
set -u
cd /home/ccheever/sb4-intent/lane-ct/snapback4
r=reports/20261001-ct-contended-reads/round3
a="$PWD/target/ct-round3"
ulimit -n 4096
while [ ! -f "$a/final-ready" ] || [ ! -f "$a/post-suite-ready" ] || [ ! -f "$a/baseline-ready" ]; do sleep 5; done
run() {
  local name=$1; shift
  printf '%s %s\n' "$(date -u +%FT%TZ)" "$name" >> "$r/run-order.log"
  "$@" > "$r/$name.log" 2>&1
  local status=$?
  printf '%s\n' "$status" > "$r/$name.exit"
  printf '%s %s exit=%s\n' "$(date -u +%FT%TZ)" "$name" "$status" >> "$r/run-order.log"
}
# Same corrected round-2 active-maintenance read A/B, now three ways.
for level in 0 0.5 1 1.5; do
  case "$level" in
    0) variants='demoted ordinary split';;
    0.5) variants='ordinary split demoted';;
    1) variants='split demoted ordinary';;
    1.5) variants='ordinary demoted split';;
  esac
  for variant in $variants; do
    run "mixed-$variant-$level" node scripts/contended-reads.mjs --mixed --levels "$level" --binary "$a/$variant" --out "$r/mixed-$variant-$level"
  done
done
# Add live Following delivery to the split's combined real-clock qualification.
run mixed-following-split node scripts/contended-reads.mjs --mixed --following-backlog --binary "$a/split" --out "$r/mixed-following-split"
# Actual identical stopped calibration checkpoint: two reversed-order trials
# for each design at idle and 96 busy processes. Restore before every trial.
for repetition in 1 2; do
  for busy in 0 96; do
    if [ "$repetition-$busy" = 1-0 ] || [ "$repetition-$busy" = 2-96 ]; then variants='demoted ordinary split'; else variants='split ordinary demoted'; fi
    for variant in $variants; do
      name="drain-$variant-$busy-$repetition"
      run "$name" node scripts/contended-drain.mjs --pristine "$a/pristine" --work "$a/$name" --binary "$a/$variant" --busy "$busy" --out "$r/$name"
    done
  done
done
