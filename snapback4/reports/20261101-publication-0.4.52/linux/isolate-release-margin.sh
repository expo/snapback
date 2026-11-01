#!/bin/bash
set -euo pipefail
R=$HOME/sb4-pub-0452-records; D=$R/release-live-margin-six
trap 'echo $? > "$R/release-live-margin-six.exit"' EXIT
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.cargo/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
mkdir -p "$D"; cd "$HOME/sb4-pub-0441/snapback4"
git rev-parse HEAD > "$D/source.sha"
for i in $(seq 1 6); do
 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/live-margin-settlement.test.mjs > "$D/run-$i.log" 2>&1
 echo 0 > "$D/run-$i.exit"
done
