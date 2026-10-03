#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$HOME/.bun/bin:$PATH"
export CARGO_BUILD_JOBS=8 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
mkdir -p source logs
tar xzf source-final.tar.gz -C source
base="$PWD"
run() { local name="$1"; shift; "$@" > "$base/logs/$name.log" 2>&1; local status=$?; printf '%s %s\n' "$name" "$status" >> "$base/logs/status.txt"; }
cd source/snapback4
run dependencies bun install --frozen-lockfile
run build cargo build -p snapback4
run units cargo test -p snapback4 --bin snapback4 verbs::witness -- --nocapture
run integration cargo test -p snapback4 --test witness -- --nocapture
run js node --test --test-timeout=120000 packages/snapback4/test/export-native.test.mjs packages/snapback4/test/export-native-round2.test.mjs packages/snapback4/test/export-publication.test.mjs packages/snapback4/test/export-failure.test.mjs
printf 'completed\n' > "$base/logs/done"
