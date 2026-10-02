#!/bin/bash
# Execute after the restored/demoted builds, with no other owned benchmark.
set -eu
cd /home/ccheever/sb4-intent/lane-ct/snapback4
r=reports/20261001-ct-contended-reads/round2
artifacts="$PWD/target/ct-round2"
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
ulimit -n 4096
cp /tmp/ct-r2-restored "$artifacts/restored"
cp /tmp/ct-r2-demoted "$artifacts/demoted"
CARGO_TARGET_DIR="$PWD/target" cargo build --manifest-path "$artifacts/base/snapback4/Cargo.toml" --profile production > "$r/qualification/base-build.log" 2>&1
cp target/production/snapback4 "$artifacts/before"
# Finish affected checks before timed comparisons to avoid our own build load.
set +e
cargo test -p snapback4-lang --test guide > "$r/qualification/guide.log" 2>&1
printf '%s\n' "$?" > "$r/qualification/guide.exit"
cargo test -p snapback4 --test lifecycle > "$r/qualification/lifecycle.log" 2>&1
printf '%s\n' "$?" > "$r/qualification/lifecycle.exit"
node --test --test-concurrency=1 packages/snapback4/test/keepalive-retry.test.mjs packages/snapback4/test/keepalive-headers.test.mjs packages/snapback4/test/transport-http.test.mjs packages/snapback4/test/transport-outcomes.test.mjs packages/snapback4/test/keepalive-browser.test.mjs packages/snapback4/test/keepalive-reuse.test.mjs packages/snapback4/test/node-transport.test.mjs > "$r/qualification/ka-transport.log" 2>&1
printf '%s\n' "$?" > "$r/qualification/ka-transport.exit"
set -e
node scripts/contended-reads.mjs --prepare --work "$artifacts/store" --binary "$artifacts/restored" --out "$r/prepare" > "$r/prepare.log" 2>&1
node scripts/contended-reads.mjs --no-trace --work "$artifacts/store" --binary "$artifacts/restored" --out "$r/fresh-restart" > "$r/fresh-restart.log" 2>&1
# Corrected combined fixture, slow probe after advance, all four whole-host loads.
for variant in before restored demoted; do
  node scripts/contended-reads.mjs --mixed --binary "$artifacts/$variant" --out "$r/mixed-$variant" > "$r/mixed-$variant.log" 2>&1
done
# Complete suite exactly once, after all synthetic contention has stopped.
set +e
bash scripts/test.sh > "$r/qualification/test-sh.log" 2>&1
printf '%s\n' "$?" > "$r/qualification/test-sh.exit"
