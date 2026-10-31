#!/bin/bash
set -u
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
cd "$HOME/sb4-pub-0441/snapback4"
R=$HOME/sb4-pub-0451-records/opening-pool-isolated
for name in maintained-column-adoption overload-browser; do
 mkdir -p "$R/$name"
 for i in 1 2 3 4 5 6; do
  node scripts/run-client-tests.mjs 1 files "packages/snapback4/test/$name.test.mjs" > "$R/$name/run-$i.log" 2>&1
  rc=$?; echo "$rc" > "$R/$name/run-$i.exit"
  [ "$rc" = 0 ] || exit "$rc"
 done
done
