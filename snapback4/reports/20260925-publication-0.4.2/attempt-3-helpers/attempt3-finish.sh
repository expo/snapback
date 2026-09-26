#!/bin/bash
# 0.4.2 publication attempt 3, after a passing dry run: publish the CLI,
# platform and client from the durable stage (the resume repeats the
# installed-consumer proof first), verify the registry bytes, then pack,
# verify, publish and verify the Expo package. Stops at the first failure.
export ATTEMPT=3
S=~/sb4-intent-pub/pubstep.sh
H=~/sb4-intent-pub/helpers-042
P=/Users/ccheever/sb4-03-lanes/codesign-relay:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
step() { "$S" "$@" || { echo "STOPPED at $1"; echo "stopped $1" > ~/sb4-intent-pub/attempt3-finish.exit; exit 1; }; }
step publication-resume . env -u SNAPBACK4_RUST_TEST_PROCESSES -u SNAPBACK4_TEST_SERIAL_CLIENT_FILES -u SNAPBACK4_BIN PATH=$P SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33 node scripts/publish.mjs --resume
step registry-cli . python3 $H/registry-verify.py cli
mkdir -p ~/projects/snapback-pub-042/snapback4/target/expo-0.4.2
step expo-pack packages/snapback4-expo npm pack --json --pack-destination ../../target/expo-0.4.2
step expo-pack-verification . python3 $H/expo-verify.py attempt-3
step expo-publish packages/snapback4-expo npm publish ../../target/expo-0.4.2/snapback4-expo-0.4.2.tgz --access public
step expo-registry-wait . node $H/expo-registry-wait.mjs
step registry-expo . python3 $H/registry-verify.py expo
echo "FINISH DONE"; echo done > ~/sb4-intent-pub/attempt3-finish.exit
