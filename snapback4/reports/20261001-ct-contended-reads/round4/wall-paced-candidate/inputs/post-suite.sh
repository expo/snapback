#!/bin/bash
# Recover inherited cross-checkout web artifacts only after the sole suite exits.
# No source edit or ratchet change. The complete suite is not repeated.
set -u
r=reports/20261001-ct-contended-reads/round4/qualification
ulimit -n 4096
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
while [ ! -f "$r/test-sh.exit" ]; do sleep 2; done
run() { local name=$1; shift; "$@" > "$r/$name.log" 2>&1; local status=$?; printf '%s\n' "$status" > "$r/$name.exit"; return "$status"; }
run wasm-cache-clean cargo clean -p snapback4-core -p snapback4-device --profile wasm --target wasm32-unknown-unknown || exit
run wasm-final bash scripts/build-wasm.sh || exit
run client-rebuild bun run --cwd packages/snapback4 build || exit
# Artifact-custody repair justifies repeating clients against this lane's wasm.
# Same pool width as test.sh: min(24, floor(availableParallelism / 3)).
width=$(node -p 'Math.max(1,Math.min(24,Math.floor(require("node:os").availableParallelism()/3)))')
files=()
for path in packages/snapback4/test/*.test.mjs; do
  case "$(basename "$path")" in app-session-model.test.mjs|online-client-model.test.mjs) ;; *) files+=("$path");; esac
done
run client-final node --test --test-concurrency="$width" "${files[@]}"
run models-final node --test --test-concurrency=1 packages/snapback4/test/app-session-model.test.mjs packages/snapback4/test/online-client-model.test.mjs
# The known follow injection flake may recur under the complete file pool.
# One isolated matrix run records reachability without changing the fixture.
run fault-matrix-final node --test packages/snapback4/test/delivery-fault-matrix.test.mjs
