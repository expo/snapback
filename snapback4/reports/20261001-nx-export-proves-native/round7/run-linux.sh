#!/bin/bash
set -u
export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
export CARGO_BUILD_JOBS=8
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
cd "$(dirname "$0")/snapback4"
log=../logs
run() { name="$1"; shift; "$@" > "$log/$name.log" 2>&1; status=$?; printf '%s %s\n' "$name" "$status" >> "$log/status.txt"; }
{ hostname; node -v; command -v node; rustc --version; bun --version; } > "$log/context.log"
run bun-install bun install --frozen-lockfile
run rust-witness cargo test -p snapback4 --bin snapback4 verbs::witness -- --nocapture
run rust-integration cargo test -p snapback4 --test witness -- --nocapture
run cargo-build cargo build -p snapback4
run js-export-shim node --test packages/snapback4/test/export-native.test.mjs packages/snapback4/test/export-native-round2.test.mjs packages/snapback4/test/export-publication.test.mjs packages/snapback4/test/export-failure.test.mjs
touch "$log/done"
