#!/bin/bash
# 0.4.2 publication attempt 3: dry run, then (only on success) the resume
# that publishes the CLI, platform and client packages.
export ATTEMPT=3
S=~/sb4-intent-pub/pubstep.sh
P=/Users/ccheever/sb4-03-lanes/codesign-relay:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
mode=$1
step() { "$S" "$@" || { echo "STOPPED at $1"; echo "stopped $1" > ~/sb4-intent-pub/attempt3-$mode.exit; exit 1; }; }
case $mode in
 dry-run|dry-run-*) step publication-$mode . env -u SNAPBACK4_RUST_TEST_PROCESSES -u SNAPBACK4_TEST_SERIAL_CLIENT_FILES -u SNAPBACK4_BIN PATH=$P SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33 node scripts/publish.mjs --dry-run ;;
 resume) step publication-resume . env -u SNAPBACK4_RUST_TEST_PROCESSES -u SNAPBACK4_TEST_SERIAL_CLIENT_FILES -u SNAPBACK4_BIN PATH=$P SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33 node scripts/publish.mjs --resume ;;
esac
echo "$mode DONE"; echo done > ~/sb4-intent-pub/attempt3-$mode.exit
