#!/bin/bash
# 0.4.2 publication attempt 3, native half, in 0.4.1's attempt-3 order.
# Stops at the first failed step.
export ATTEMPT=3
S=~/sb4-intent-pub/pubstep.sh
H=~/sb4-intent-pub/helpers-042
U=81961F7D-DF85-4A7A-B376-20D9073AC101
root=~/projects/snapback-pub-042/snapback4
step() { "$S" "$@" || { echo "STOPPED at $1"; echo "stopped $1" > ~/sb4-intent-pub/attempt3-native.exit; exit 1; }; }
step bun-install . bun install --frozen-lockfile
step xcframework-build . bash scripts/build-xcframework.sh
step native-prepare . python3 $H/native-prepare.py
step cargo-build . cargo build --locked -p snapback4
step wasm-build . bash scripts/build-wasm.sh
step client-package-build . bun run --cwd packages/snapback4 build
step npm-identity . npm whoami
step simulator-boot . xcrun simctl boot $U
step simulator-ready . xcrun simctl bootstatus $U -b
step chat-backend-check apps/chat ../../target/debug/snapback4 check
step expo-release-build apps/chat-expo env EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:44441 node ../../node_modules/expo/bin/cli run:ios --configuration Release --device generic --no-bundler --output ../../target/expo-release
step root-hook-dependencies .. bun install --frozen-lockfile
step simulator-install . xcrun simctl install $U target/expo-release/Snapback4chat.app
step native-link-verification . python3 $H/native-link.py
step native-witness . env WITNESS_UDID=$U WITNESS_PORT=44441 WITNESS_ARTIFACTS=$root/reports/20260925-expo-0.4.2 node witness/expo.mjs
step native-qualification-verification . python3 $H/native-verify.py
step simulator-shutdown . xcrun simctl shutdown $U
echo "NATIVE DONE"; echo "done" > ~/sb4-intent-pub/attempt3-native.exit
