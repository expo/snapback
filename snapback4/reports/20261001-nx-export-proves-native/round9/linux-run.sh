#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$HOME/.bun/bin:$PATH"
export CARGO_BUILD_JOBS=8
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
mkdir -p merged main logs
sha256sum source.tar.gz main.tar.gz > logs/source-sha256.txt
tar xzf source.tar.gz -C merged
tar xzf main.tar.gz -C main
run() { local name="$1"; shift; "$@" > "$base/logs/$name.log" 2>&1; local status=$?; printf '%s %s\n' "$name" "$status" >> "$base/logs/status.txt"; }
base="$PWD"
export CARGO_TARGET_DIR="$base/target"
cd merged/snapback4
run dependencies bun install --frozen-lockfile
run build cargo build -p snapback4
run units cargo test -p snapback4 --bin snapback4 verbs::witness -- --nocapture
run integration cargo test -p snapback4 --test witness -- --nocapture
run js node --test packages/snapback4/test/export-native.test.mjs packages/snapback4/test/export-native-round2.test.mjs packages/snapback4/test/export-publication.test.mjs packages/snapback4/test/export-failure.test.mjs
cd "$base/main/snapback4"
run baseline-prefix cargo test -p snapback4-lang --test prefix_reads -- --nocapture
run baseline-membership cargo test -p snapback4-sim --test membership_search -- --nocapture
printf 'completed\n' > "$base/logs/done"
