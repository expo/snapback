#!/bin/bash
# 0.4.53 Linux half (0.4.30 kit): client and Expo proof bytes prepared once on the Mac after the native build; Lean oracle built and required. env: ATTEMPT
# Attempt 3+: private fresh NPM_CONFIG_CACHE (attempt 2 hit an externally pruned shared ~/.npm cache: ENOENT in proveExpoUpgrades).
: "${ATTEMPT:?}"
unset CARGO_TARGET_DIR SNAPBACK4_BIN NPM_TOKEN NODE_AUTH_TOKEN
ulimit -n 65536
export REP=/home/ccheever/sb4-intent/0453/records ROOT=/home/ccheever/sb4-intent/0453/source/snapback4
P=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
cd /home/ccheever/sb4-intent/0453/kit
./step.sh linux-bun-install . bun install --frozen-lockfile || { echo fail-install > $REP/linux-$ATTEMPT.exit; exit 1; }
./step.sh linux-lean-setup lean env PATH=$P lake build quarry-oracle || { echo fail-lean > $REP/linux-$ATTEMPT.exit; exit 1; }
./step.sh linux-qualify . env -u SNAPBACK4_BIN -u NPM_TOKEN -u NODE_AUTH_TOKEN -u SNAPBACK4_TEST_SERIAL_CLIENT_FILES -u SNAPBACK4_RUST_TEST_PROCESSES PATH=$P NPM_CONFIG_CACHE=$REP/npm-cache-$ATTEMPT SNAPBACK4_REQUIRE_LEAN=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 node scripts/qualify-linux.mjs --client target/publication/client-0.4.53/snapback4-0.4.53.tgz --expo target/publication/client-0.4.53/snapback4-expo-0.4.53.tgz --out /home/ccheever/sb4-intent/0453/linux-qualification-0.4.53
rc=$?
echo "$rc" > $REP/linux-$ATTEMPT.exit
exit "$rc"
