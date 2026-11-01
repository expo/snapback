#!/bin/bash
set -eu
R=$HOME/sb4-pub-0452-records
until [ -s "$R/upload-fixture-affected.exit" ]; do sleep 3; done
[ "$(cat "$R/upload-fixture-affected.exit")" = 0 ]
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
cd "$HOME/sb4-pub-0441/snapback4"
set +e
node --test --test-name-pattern='message authors and feed avatars' "$R/diagnosis/asset-avatars/startup-probe.test.mjs" > "$R/diagnosis/asset-avatars/current-main-probe.log" 2>&1
rc=$?; echo "$rc" > "$R/diagnosis/asset-avatars/current-main-probe.exit"
exit "$rc"
