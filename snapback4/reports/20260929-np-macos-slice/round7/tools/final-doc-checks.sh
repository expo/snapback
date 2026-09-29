#!/usr/bin/env bash
set -u
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
export TMPDIR="$HOME/sb4-np/tmp"
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
cd "$HOME/sb4-np/lane-linux-r7/snapback4"
logs="$HOME/sb4-np/round7"
run() {
  local name="$1" started=$SECONDS status=0
  shift
  "$@" >"$logs/$name.log" 2>&1 || status=$?
  echo "$name exit=$status seconds=$((SECONDS-started))" | tee -a "$logs/final-doc-status.txt"
}
run readme-examples-final node --test packages/snapback4/test/readme-examples.test.mjs
run docs-budget-final-recorded node scripts/docs-budget.mjs
run guide-final cargo test -p snapback4-lang --test guide
