#!/bin/bash
# 0.4.31 Linux half (0.4.30 kit): client and Expo proof bytes prepared once on the Mac after the native build; Lean oracle built and required. env: ATTEMPT
: "${ATTEMPT:?}"
ulimit -n 65536
export REP=/home/ccheever/sb4-pub-0431-records ROOT=/home/ccheever/sb4-pub-0431/snapback4
P=$HOME/.elan/bin:$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
cd /home/ccheever/sb4-pub-0431-kit
./step.sh linux-bun-install . bun install --frozen-lockfile || { echo fail-install > $REP/linux-$ATTEMPT.exit; exit 1; }
./step.sh linux-lean-setup lean env PATH=$P lake build quarry-oracle || { echo fail-lean > $REP/linux-$ATTEMPT.exit; exit 1; }
./step.sh linux-qualify . env -u SNAPBACK4_BIN -u NPM_TOKEN -u NODE_AUTH_TOKEN -u SNAPBACK4_TEST_SERIAL_CLIENT_FILES -u SNAPBACK4_RUST_TEST_PROCESSES PATH=$P SNAPBACK4_REQUIRE_LEAN=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 node scripts/qualify-linux.mjs --client target/publication/client-0.4.31/snapback4-0.4.31.tgz --expo target/publication/client-0.4.31/snapback4-expo-0.4.31.tgz --out /home/ccheever/sb4-pub-0431-records/linux-qualification-0.4.31
echo $? > $REP/linux-$ATTEMPT.exit
