#!/bin/bash
# Invoke after affected checks and all owned builds/checks have exited.
# The one full suite on final source follows timing, with no overlap.
# All controls are retained exact production binaries from round 3.
set -u
r=reports/20261001-ct-contended-reads/round4
a="$PWD/target/ct-round4"
b="$PWD/target/ct-round3"
ulimit -n 4096
run() {
  local name=$1; shift
  printf '%s %s\n' "$(date -u +%FT%TZ)" "$name" >> "$r/run-order.log"
  local status=0
  "$@" > "$r/$name.log" 2>&1 || status=$?
  printf '%s\n' "$status" > "$r/$name.exit"
  printf '%s %s exit=%s\n' "$(date -u +%FT%TZ)" "$name" "$status" >> "$r/run-order.log"
  if [ "$status" != 0 ]; then exit "$status"; fi
}
run mixed-following-paced-1.5 node scripts/contended-reads.mjs --mixed --following-backlog --levels 1.5 --binary "$a/paced" --out "$r/mixed-following-paced-1.5"
for level in 0 0.5 1 1.5; do
  case "$level" in 0|1) variants='split paced';; *) variants='paced split';; esac
  for variant in $variants; do
    if [ "$variant" = paced ]; then binary="$a/paced"; else binary="$b/$variant"; fi
    run "mixed-$variant-$level" node scripts/contended-reads.mjs --mixed --levels "$level" --binary "$binary" --out "$r/mixed-$variant-$level"
  done
done
for level in 0 0.5 1; do
  run "mixed-following-paced-$level" node scripts/contended-reads.mjs --mixed --following-backlog --levels "$level" --binary "$a/paced" --out "$r/mixed-following-paced-$level"
done
for repetition in 1 2; do
  for busy in 0 96; do
    if [ "$repetition-$busy" = 1-0 ] || [ "$repetition-$busy" = 2-96 ]; then variants='demoted ordinary split paced'; else variants='paced split ordinary demoted'; fi
    for variant in $variants; do
      if [ "$variant" = paced ]; then binary="$a/paced"; else binary="$b/$variant"; fi
      name="drain-$variant-$busy-$repetition"
      run "$name" node scripts/contended-drain.mjs --pristine "$b/pristine" --work "$a/$name" --binary "$binary" --busy "$busy" --out "$r/$name"
    done
  done
done
