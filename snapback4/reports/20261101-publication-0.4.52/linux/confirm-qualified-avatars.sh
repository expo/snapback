#!/bin/bash
set -euo pipefail
R=$HOME/sb4-pub-0452-records; D=$R/opening-qualified-avatars-six
trap 'rc=$?; echo "$rc" > "$R/opening-qualified-avatars-six.exit"' EXIT
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
mkdir -p "$D"
cd "$HOME/sb4-pub-0441/snapback4"; git rev-parse HEAD > "$D/source.sha"
for i in $(seq 1 6); do
 set +e
 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/asset-opening.test.mjs packages/snapback4/test/asset-avatars.test.mjs > "$D/run-$i.log" 2>&1
 rc=$?; echo "$rc" > "$D/run-$i.exit"
 set -e
 [ "$rc" = 0 ] || exit "$rc"
done
