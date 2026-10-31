#!/bin/bash
set -u
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
R=$HOME/sb4-pub-0451-records/isolated
cd "$HOME/sb4-pub-0441/snapback4"
for name in asset-avatars social-browser; do
 mkdir -p "$R/discovery-$name"
 for i in 1 2 3 4 5 6; do
  node scripts/run-client-tests.mjs 1 files "packages/snapback4/test/$name.test.mjs" > "$R/discovery-$name/run-$i.log" 2>&1
  rc=$?; echo "$rc" > "$R/discovery-$name/run-$i.exit"
  if [ "$rc" != 0 ]; then exit "$rc"; fi
 done
done
