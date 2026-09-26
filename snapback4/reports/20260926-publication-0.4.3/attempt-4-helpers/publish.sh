#!/bin/bash
# dry-run | resume. env: VERSION, PUBDATE, ROOT, ATTEMPT
export REP=$ROOT/reports/$PUBDATE-publication-$VERSION
S=~/projects/snapback-eph-program/pub/pubstep.sh
P=/Users/ccheever/sb4-03-lanes/codesign-relay:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
mode=$1
step() { "$S" "$@" || { echo "STOPPED at $1"; echo "stopped $1" > ~/projects/snapback-eph-program/pub/$mode-$ATTEMPT.exit; exit 1; }; }
case $mode in
 dry-run|dry-run-*) step publication-$mode . env -u SNAPBACK4_RUST_TEST_PROCESSES -u SNAPBACK4_TEST_SERIAL_CLIENT_FILES -u SNAPBACK4_BIN PATH=$P SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33 node scripts/publish.mjs --dry-run ;;
esac
echo "$mode DONE"; echo done > ~/projects/snapback-eph-program/pub/$mode-$ATTEMPT.exit
