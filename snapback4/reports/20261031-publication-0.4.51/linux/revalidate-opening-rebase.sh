#!/bin/bash
set -euo pipefail
K=$HOME/sb4-pub-0451-kit; R=$HOME/sb4-pub-0451-records; W=$HOME/sb4-pub-0441
trap 'rc=$?; echo "$rc" > "$R/opening-rebase-checks.exit"' EXIT
python3 "$K/verify-opening-qualification.py" > "$R/opening-rebase-prior-qualification-validation.json"
! systemctl --user is-active --quiet sb4-pub51-opening-broad
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_OPT_LEVEL=1
export LIBSQLITE3_FLAGS='-DHAVE_FDATASYNC=1 -USQLITE_ENABLE_MEMORY_MANAGEMENT -DSQLITE_DEFAULT_MEMSTATUS=0'
ulimit -n 65536
cd "$W"; [ -z "$(git status --porcelain)" ]; git rev-parse HEAD > "$K/opening-rebased-tested.sha"
mkdir -p "$R/opening-rebase-six" "$R/opening-rebase-fixture-three"
cd snapback4
bun install --frozen-lockfile > "$R/opening-rebase-install.log" 2>&1
cargo build --locked -p snapback4 > "$R/opening-rebase-cli-build.log" 2>&1
bash scripts/build-wasm.sh > "$R/opening-rebase-wasm-build.log" 2>&1
bun run --cwd packages/snapback4 build > "$R/opening-rebase-client-build.log" 2>&1
for i in $(seq 1 6); do
 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/asset-opening.test.mjs packages/snapback4/test/asset-avatars.test.mjs > "$R/opening-rebase-six/run-$i.log" 2>&1
 echo 0 > "$R/opening-rebase-six/run-$i.exit"
 if [ "$i" -le 3 ]; then
  node scripts/run-client-tests.mjs 1 files packages/snapback4/test/social-browser.test.mjs packages/snapback4/test/maintained-column-adoption.test.mjs > "$R/opening-rebase-fixture-three/run-$i.log" 2>&1
  echo 0 > "$R/opening-rebase-fixture-three/run-$i.exit"
 fi
done
cd "$W"
node scripts/check-inventories.mjs > "$R/opening-rebase-inventories.log" 2>&1
./ref-check > "$R/opening-rebase-ref-check.log" 2>&1
[ -z "$(git status --porcelain)" ]
python3 "$K/log-status.py" "Rebased fix stack focused revalidation PASS at $(git rev-parse HEAD): rebuilt CLI/WASM/client sequentially, opening plus original avatar files alone 6/6, social plus maintained-column fixtures alone 3/3, inventories and ref-check. Original full affected receipt retained; final fresh release will receive its mandatory full affected and publication checks. No upload."
