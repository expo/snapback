#!/usr/bin/env bash
set -u
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
export TMPDIR="$HOME/sb4-np/tmp"
export BUN_INSTALL_CACHE_DIR="$HOME/sb4-np/bun-cache"
export CARGO_BUILD_JOBS=16
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
cd "$HOME/sb4-np/lane-linux-r7/snapback4"
logs="$HOME/sb4-np/round7"
run() {
  local name="$1" started=$SECONDS status=0
  shift
  "$@" >"$logs/$name.log" 2>&1 || status=$?
  echo "$name exit=$status seconds=$((SECONDS-started))" | tee -a "$logs/status.txt"
  return "$status"
}
{
  uname -a
  node --version
  bun --version
  rustc --version
  cargo --version
  git rev-parse HEAD
  git diff --stat
  node -p 'require("node:os").availableParallelism()'
} > "$logs/pins.txt"
run bun-install bun install --frozen-lockfile || exit 1
run cargo-build cargo build --workspace --quiet || exit 1
# No core/device/build input changed since the supervisor's compiled wasm.
# Retain the artifact hash and source comparison; this is reuse, not a fresh measurement.
git diff --exit-code cbb44e37fa HEAD -- crates/snapback4-core crates/snapback4-device Cargo.toml Cargo.lock scripts/build-wasm.sh > "$logs/wasm-source-diff.log" || exit 1
cp -a "$HOME/sb4-intent/land-np/snapback4/packages/snapback4/src/wasm" packages/snapback4/src/wasm
sha256sum packages/snapback4/src/wasm/* > "$logs/wasm-inputs.sha256"
run package-typecheck bun run --cwd packages/snapback4 typecheck || exit 1
run package-build bun run --cwd packages/snapback4 build || exit 1
run chat-check bash -c 'cd apps/chat && ../../target/debug/snapback4 check' || exit 1
run readme-examples node --test packages/snapback4/test/readme-examples.test.mjs
run smoke-replacement node --test --test-name-pattern='native smoke observes only' packages/snapback4/test/app.test.mjs
run docs-budget node scripts/docs-budget.mjs
run guide cargo test -p snapback4-lang --test guide
run witness-unit cargo test -p snapback4 --bin snapback4 verbs::witness::
run witness-driver cargo test -p snapback4 --test witness -- --test-threads=1
files=()
for file in packages/snapback4/test/*.test.mjs; do
  case "$(basename "$file")" in
    app-session-model.test.mjs|online-client-model.test.mjs) ;;
    *) files+=("$file") ;;
  esac
done
concurrency=$(node -p 'Math.max(1, Math.min(24, Math.floor(require("node:os").availableParallelism() / 3)))')
echo "client files=${#files[@]} concurrency=$concurrency" | tee -a "$logs/status.txt"
run client-tests node --test --test-concurrency="$concurrency" "${files[@]}"
run client-models node --test --test-concurrency=1 packages/snapback4/test/app-session-model.test.mjs packages/snapback4/test/online-client-model.test.mjs
echo complete | tee -a "$logs/status.txt"
