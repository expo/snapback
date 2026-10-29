#!/bin/bash
# Coordinator-requested early Mac check at 148cb4d372 (after chain-a1; plus the Integration 28 new/changed client files that mention darwin/platform): the Darwin-gated client files plus the tests that relay CLI
# output through fake CLIs / process.exit, plus proof.test.mjs (0.4.41 Mac flake), serially through the suite's runner with the
# dry run's environment (serial files, Lean required, 0.2.33 fence, codesign relay on PATH, default TMPDIR). Evidence only.
O=$HOME/sb4-pub-0449/isolated/pre; mkdir -p $O
export PATH=/Users/ccheever/sb4-03-lanes/codesign-relay:/Users/ccheever/.elan/bin:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
ulimit -n 65536
cd $HOME/sb4-pub-0444-wt/snapback4
T=packages/snapback4/test
F="$T/export-failure.test.mjs $T/export-native.test.mjs $T/expo-media-storage.test.mjs $T/export-publication.test.mjs $T/export-background.test.mjs $T/publish-linux.test.mjs $T/sync-generation.test.mjs $T/qualify-linux.test.mjs $T/linux-package.test.mjs $T/recorded-compatibility.test.mjs $T/schema-capabilities.test.mjs $T/worker-regressions.test.mjs $T/test-signals.test.mjs $T/test-processes.test.mjs $T/worker.test.mjs $T/publish-signing.test.mjs $T/server-e2e.test.mjs $T/test-file-runner.test.mjs $T/wave10-upgrade.test.mjs $T/dx12-serve.test.mjs $T/dx10-process-accounts.test.mjs $T/rel2-roster-lock.test.mjs $T/proof.test.mjs $T/dx11-picker.test.mjs $T/dx14-client-proof.test.mjs $T/dx15-proof.test.mjs $T/periphery.test.mjs $T/sec10-packed.test.mjs $T/tok1-reading.test.mjs $T/wave12-kit.test.mjs $T/calls1-proofs.test.mjs $T/dx13-proof.test.mjs $T/dx9-packed.test.mjs $T/security-packed.test.mjs $T/srv1-lifetime.test.mjs $T/tok2-output.test.mjs $T/wave14-rule-recipes.test.mjs $T/day5-proofs.test.mjs $T/surf4.test.mjs $T/ver1-loop.test.mjs"
s=$(date +%s)
env -u SNAPBACK4_BIN -u SNAPBACK4_RUST_TEST_PROCESSES SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 SNAPBACK4_REQUIRE_LEAN=1 CARGO_INCREMENTAL=0 SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33 timeout 5400 node scripts/run-client-tests.mjs 1 files $F > $O/pre.log 2>&1
echo "rc=$? $(( $(date +%s)-s )) s load=$(sysctl -n vm.loadavg)"
grep -E '^-- client file (ok|FAIL)|^-- client files:' $O/pre.log | cut -c1-200
git status --porcelain; echo pre-done
