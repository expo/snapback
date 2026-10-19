#!/bin/bash
# dry-run | resume (0.4.16 kit). env: ATTEMPT
: "${ATTEMPT:?}"
export VERSION=0.4.31 PUBDATE=20261017
export ROOT=/Users/ccheever/projects/snapback-pub-0428/snapback4 H=/Users/ccheever/sb4-pub-0431/helpers-0.4.31
export REP=$ROOT/reports/$PUBDATE-publication-$VERSION
S=/Users/ccheever/sb4-pub-0431/pubstep.sh
P=/Users/ccheever/sb4-03-lanes/codesign-relay:/Users/ccheever/.elan/bin:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
ulimit -n 65536
mode=$1
step() { "$S" "$@" || { echo "STOPPED at $1"; echo "stopped $1" > /Users/ccheever/sb4-pub-0431/$mode-$ATTEMPT.exit; exit 1; }; }
case $mode in
 prepare) step publication-prepare-client . env -u SNAPBACK4_BIN PATH=$P CARGO_INCREMENTAL=0 node scripts/publish.mjs --prepare-client ;;
 lean) step lean-setup lean env PATH=$P lake build quarry-oracle ;;
 warm) step test-warm . env -u SNAPBACK4_BIN PATH=$P CARGO_INCREMENTAL=0 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test --workspace --no-run ;;
 dry-run) step publication-dry-run . env -u SNAPBACK4_RUST_TEST_PROCESSES -u SNAPBACK4_BIN SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 SNAPBACK4_REQUIRE_LEAN=1 PATH=$P CARGO_INCREMENTAL=0 SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33 node scripts/publish.mjs --dry-run --linux-receipt target/incoming/linux-0.4.31/receipt.json --linux-tarball target/incoming/linux-0.4.31/snapback4-linux-x64-0.4.31.tgz ;;
esac
echo "$mode DONE"; echo done > /Users/ccheever/sb4-pub-0431/$mode-$ATTEMPT.exit
