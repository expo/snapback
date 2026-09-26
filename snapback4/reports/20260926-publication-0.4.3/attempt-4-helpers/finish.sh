#!/bin/bash
# After a passing dry run: resume (publishes CLI+platform+client), verify registry, pack/verify/publish/verify Expo.
# env: VERSION, PUBDATE, ROOT, H, ATTEMPT
export REP=$ROOT/reports/$PUBDATE-publication-$VERSION
S=~/projects/snapback-eph-program/pub/pubstep.sh
P=/Users/ccheever/sb4-03-lanes/codesign-relay:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
step() { "$S" "$@" || { echo "STOPPED at $1"; echo "stopped $1" > ~/projects/snapback-eph-program/pub/finish-$ATTEMPT.exit; exit 1; }; }
step publication-resume . env -u SNAPBACK4_RUST_TEST_PROCESSES -u SNAPBACK4_TEST_SERIAL_CLIENT_FILES -u SNAPBACK4_BIN PATH=$P SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33 node scripts/publish.mjs --resume
step registry-cli . python3 $H/registry-verify.py cli
mkdir -p $ROOT/target/expo-$VERSION
step expo-pack packages/snapback4-expo npm pack --json --pack-destination ../../target/expo-$VERSION
step expo-pack-verification . python3 $H/expo-verify.py attempt-$ATTEMPT
step expo-publish packages/snapback4-expo npm publish ../../target/expo-$VERSION/snapback4-expo-$VERSION.tgz --access public
step expo-registry-wait . node $H/expo-registry-wait.mjs
step registry-expo . python3 $H/registry-verify.py expo
echo "FINISH DONE"; echo done > ~/projects/snapback-eph-program/pub/finish-$ATTEMPT.exit
