#!/bin/bash
# Run only qualification and staged installation; publication is deliberately absent.
set -euo pipefail
C=${1:?expected frozen source}
B=$HOME/sb4-intent/0453
K=$B/kit
export ROOT=$B/source/snapback4 REP=$B/records ATTEMPT=2
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
unset CARGO_TARGET_DIR SNAPBACK4_BIN NPM_TOKEN NODE_AUTH_TOKEN PUB52_SOURCE PUB52_STOCK_TEMPLATES
export SNAPBACK4_WAVE21_ROOT=$B/fixtures/wave21/apps
ulimit -n 65536
[ ! -e "$REP/run-2.exit" ] || exit 98
trap 'rc=$?; echo "$rc" > "$REP/run-2.exit"' EXIT
[ "$(git -C "$ROOT" rev-parse HEAD)" = "$C" ]
[ -z "$(git -C "$ROOT" status --porcelain)" ]
cd "$ROOT"
node --input-type=module - "$C" <<'JS'
import {loadPrepared} from './scripts/prepare-client.mjs';
const p=loadPrepared('target/publication/client-0.4.53','0.4.53');
if(p.source!==process.argv[2])throw new Error('transferred prepared source differs');
console.log('PREPARED READY: exact source and client/Expo integrity verified');
JS
cd "$K"
./step.sh linux-early-install . bun install --frozen-lockfile
./step.sh linux-early-cli . env LIBSQLITE3_FLAGS='-DHAVE_FDATASYNC=1 -USQLITE_ENABLE_MEMORY_MANAGEMENT -DSQLITE_DEFAULT_MEMSTATUS=0' cargo build --locked -p snapback4
./step.sh linux-early-audit . node "$K/audit-fast.mjs" "$ROOT" "$ROOT/target/publication/client-0.4.53" "$REP/audit-linux-early-attempt2"
bash ./linux-a2.sh
./step.sh linux-clean-install . bash "$K/clean-install-linux.sh"
echo 'LINUX QUALIFICATION AND STAGED CLEAN INSTALL DONE'
