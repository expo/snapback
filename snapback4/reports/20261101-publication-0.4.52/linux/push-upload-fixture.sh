#!/bin/bash
set -eu
K=$HOME/sb4-pub-0452-kit; R=$HOME/sb4-pub-0452-records
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
cd "$HOME/sb4-pub-0441"
until [ -s "$R/upload-fixture-affected.exit" ]; do sleep 5; done
[ "$(cat "$R/upload-fixture-affected.exit")" = 0 ]
mkdir -p "$R/fixture-upload-rebased"
for i in 1 2 3; do
 (cd snapback4; node scripts/run-client-tests.mjs 1 files packages/snapback4/test/upload-hooks.test.mjs) > "$R/fixture-upload-rebased/run-$i.log" 2>&1
 echo 0 > "$R/fixture-upload-rebased/run-$i.exit"
done
for i in $(seq 1 12); do
 before=$(git rev-parse HEAD)
 git fetch origin
 git rebase origin/main
 after=$(git rev-parse HEAD)
 if [ "$before" != "$after" ]; then
  python3 "$K/log-status.py" "Upload fixture push HOLD: concurrent main rebase changed $before to $after; repeat affected and alone proof before retry."
  exit 75
 fi
 if git push origin HEAD:main; then
  git rev-parse HEAD > "$K/upload-fixture-main-pushed.sha"
  python3 "$K/log-status.py" "Upload-hooks test-only fixture fix pushed to origin/main: $(cat "$K/upload-fixture-main-pushed.sha"). On current-main source, exact affected/ref check PASS and alone 3/3 PASS; initial source also passed 3/3. It retains default progressive startup, waits executable/acquired before going offline, and requires durable queued capture before reload. No runtime change."
  exit 0
 fi
 sleep 5
done
exit 1
