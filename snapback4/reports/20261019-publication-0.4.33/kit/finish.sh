#!/bin/bash
# After a passing dry run: resume (publishes platforms then client), verify registry, pack/verify/publish/verify Expo. env: ATTEMPT
: "${ATTEMPT:?}"
export VERSION=0.4.33 PUBDATE=20261019
export ROOT=/Users/ccheever/projects/snapback-pub-0428/snapback4 H=/Users/ccheever/sb4-pub-0433/helpers-0.4.33
export REP=$ROOT/reports/$PUBDATE-publication-$VERSION
S=/Users/ccheever/sb4-pub-0433/pubstep.sh
P=/Users/ccheever/sb4-03-lanes/codesign-relay:/Users/ccheever/.elan/bin:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
ulimit -n 65536
step() { "$S" "$@" || { echo "STOPPED at $1"; echo "stopped $1" > /Users/ccheever/sb4-pub-0433/finish-$ATTEMPT.exit; exit 1; }; }
step publication-resume . env -u SNAPBACK4_RUST_TEST_PROCESSES -u SNAPBACK4_TEST_SERIAL_CLIENT_FILES -u SNAPBACK4_BIN PATH=$P SNAPBACK4_REQUIRE_LEAN=1 CARGO_INCREMENTAL=0 SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33 node scripts/publish.mjs --resume
step registry-cli . bash $H/registry-retry.sh cli
mkdir -p $ROOT/target/expo-$VERSION
step expo-pack packages/snapback4-expo npm pack --json --pack-destination ../../target/expo-$VERSION
step expo-pack-verification . python3 $H/expo-verify.py attempt-$ATTEMPT
step expo-proof-bytes . python3 -c "import json,sys;s=json.load(open('reports/20261019-publication-0.4.33/expo-staged.json'));p=json.load(open('target/publication/client-0.4.33/prepare.json'));print(s['integrity'],p['expo']['integrity']);sys.exit(0 if s['integrity']==p['expo']['integrity'] else 1)"
step expo-publish packages/snapback4-expo npm publish ../../target/expo-$VERSION/snapback4-expo-$VERSION.tgz --access public
step expo-registry-wait . node $H/expo-registry-wait.mjs
step registry-expo . bash $H/registry-retry.sh expo
echo "FINISH DONE"; echo done > /Users/ccheever/sb4-pub-0433/finish-$ATTEMPT.exit
