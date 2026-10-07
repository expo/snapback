#!/usr/bin/env bash
set -euo pipefail
source target/sg/environment.sh
export SNAPBACK4_PREVIOUS_PUBLISHED_BIN="$PWD/target/sg/previous-published/snapback4"
cargo test -p snapback4-core --lib --test refused_open --test identity --test read_sessions --test bound_session --test schema_capabilities --test schema_capabilities_legacy --test revocation_history --test work_records --test expiring_adoption --test adoption_scale > target/sg-r1/core-focused.log 2>&1
cargo test -p snapback4-device --lib --test adoption --test native --test schema_capabilities --test schema_capabilities_legacy > target/sg-r1/device-focused.log 2>&1
cargo test -p snapback4-device --test schema_capabilities spill_sized -- --nocapture > target/sg-r1/spill.log 2>&1
cargo test -p snapback4 --bin snapback4 > target/sg-r1/server-tests.log 2>&1
cargo build -p snapback4 --bin snapback4 > target/sg-r1/build-cli.log 2>&1
node --test packages/snapback4/test/schema-capabilities.test.mjs packages/snapback4/test/schema-capability-refusals.test.mjs packages/snapback4/test/read-only-round4.test.mjs packages/snapback4/test/ephemeral-adoption.test.mjs packages/snapback4/test/maintained-column-adoption.test.mjs packages/snapback4/test/keep-adoption.test.mjs > target/sg-r1/client-fences-adoption.log 2>&1
node --test packages/snapback4/test/read-only*.test.mjs > target/sg-r1/read-only-clients.log 2>&1
bash scripts/test.sh > target/sg-r1/full-suite.log 2>&1
