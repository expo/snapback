#!/bin/bash
# Coordinator-requested early Mac check at 6f3ef3b0d0 (after chain-a2): the Darwin-gated client files plus the tests that relay CLI
# output through fake CLIs / process.exit, plus proof.test.mjs (0.4.41 Mac flake), serially through the suite's runner with the
# dry run's environment (serial files, Lean required, 0.2.33 fence, codesign relay on PATH, default TMPDIR). Evidence only.
O=$HOME/sb4-pub-0443/isolated/pre; mkdir -p $O
export PATH=/Users/ccheever/sb4-03-lanes/codesign-relay:/Users/ccheever/.elan/bin:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
ulimit -n 65536
cd $HOME/projects/snapback-pub-0428/snapback4
T=packages/snapback4/test
F="$T/export-failure.test.mjs $T/export-native.test.mjs $T/expo-media-storage.test.mjs $T/export-publication.test.mjs $T/export-background.test.mjs $T/publish-linux.test.mjs $T/sync-generation.test.mjs $T/qualify-linux.test.mjs $T/linux-package.test.mjs $T/recorded-compatibility.test.mjs $T/schema-capabilities.test.mjs $T/worker-regressions.test.mjs $T/test-signals.test.mjs $T/test-processes.test.mjs $T/worker.test.mjs $T/publish-signing.test.mjs $T/server-e2e.test.mjs $T/test-file-runner.test.mjs $T/wave10-upgrade.test.mjs $T/dx12-serve.test.mjs $T/dx10-process-accounts.test.mjs $T/rel2-roster-lock.test.mjs $T/proof.test.mjs"
s=$(date +%s)
env -u SNAPBACK4_BIN -u SNAPBACK4_RUST_TEST_PROCESSES SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 SNAPBACK4_REQUIRE_LEAN=1 CARGO_INCREMENTAL=0 SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33 timeout 5400 node scripts/run-client-tests.mjs 1 files $F > $O/pre.log 2>&1
echo "rc=$? $(( $(date +%s)-s )) s load=$(sysctl -n vm.loadavg)"
grep -E '^-- client file (ok|FAIL)|^-- client files:' $O/pre.log | cut -c1-200
git status --porcelain; echo pre-done
