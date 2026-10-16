#!/bin/bash
# Xcode 27.1 (Swift 6.4) cannot import Expo precompiled XCFrameworks built with Swift 6.3.1, so build Expo modules from source for the Release witness app.
# Native half, in the 0.4.16 order. Stops at the first failed step.
: "${ATTEMPT:?}"
export VERSION=0.4.29 PUBDATE=20261015
export ROOT=/Users/ccheever/projects/snapback-pub-0428/snapback4 H=/Users/ccheever/sb4-pub-0429/helpers-0.4.29
export REP=$ROOT/reports/$PUBDATE-publication-$VERSION
S=/Users/ccheever/sb4-pub-0429/pubstep.sh
U=D2C67F7F-196C-439E-AEB9-3FDA4479761E
ulimit -n 65536
step() { "$S" "$@" || { echo "STOPPED at $1"; echo "stopped $1" > /Users/ccheever/sb4-pub-0429/native-$ATTEMPT.exit; exit 1; }; }
step bun-install . bun install --frozen-lockfile
step xcframework-build . env CARGO_INCREMENTAL=0 bash scripts/build-xcframework.sh
step native-prepare . python3 $H/native-prepare.py
step cargo-build . env CARGO_INCREMENTAL=0 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build --locked -p snapback4
step wasm-build . env CARGO_INCREMENTAL=0 bash scripts/build-wasm.sh
step client-package-build . bun run --cwd packages/snapback4 build
step npm-identity . npm whoami
step simulator-boot . xcrun simctl boot $U
step simulator-ready . xcrun simctl bootstatus $U -b
step chat-backend-check apps/chat ../../target/debug/snapback4 check
step expo-ios-regenerate apps/chat-expo rm -rf ios
step expo-release-build apps/chat-expo env EXPO_USE_PRECOMPILED_MODULES=0 EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:44442 node ../../node_modules/expo/bin/cli run:ios --configuration Release --device generic --no-bundler --output ../../target/expo-release
step root-hook-dependencies .. bun install --frozen-lockfile
step simulator-uninstall . xcrun simctl uninstall $U dev.snapback4.chat
step simulator-install . xcrun simctl install $U target/expo-release/Snapback4chat.app
step native-link-verification . python3 $H/native-link.py
step native-witness . env WITNESS_UDID=$U WITNESS_PORT=44442 WITNESS_ARTIFACTS=$ROOT/reports/$PUBDATE-expo-$VERSION node witness/expo.mjs
step native-qualification-verification . python3 $H/native-verify.py
step simulator-shutdown . xcrun simctl shutdown $U
echo "NATIVE DONE"; echo "done" > /Users/ccheever/sb4-pub-0429/native-$ATTEMPT.exit
