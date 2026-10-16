#!/bin/bash
# 0.4.29 Expo witness on Xcode 27.0 (copied from the Mac Studio) after /Applications/Xcode.app became 27.1, whose
# toolchain cannot build Expo SDK 57.0.22 modules. The xcframework packed into the prepared snapback4-expo bytes
# was built by Xcode 27.1 in attempt 4 and is NOT rebuilt here (keeps the prepared/Linux-qualified Expo bytes);
# this run builds and witnesses the Release chat-expo app with Xcode 27.0 against that exact archive.
: "${ATTEMPT:?}"
export VERSION=0.4.29 PUBDATE=20261015
export ROOT=/Users/ccheever/projects/snapback-pub-0428/snapback4 H=/Users/ccheever/sb4-pub-0429/helpers-0.4.29
export REP=$ROOT/reports/$PUBDATE-publication-$VERSION
S=/Users/ccheever/sb4-pub-0429/pubstep-xcode270.sh
U=D2C67F7F-196C-439E-AEB9-3FDA4479761E
ulimit -n 65536
step() { "$S" "$@" || { echo "STOPPED at $1"; echo "stopped $1" > /Users/ccheever/sb4-pub-0429/native-$ATTEMPT.exit; exit 1; }; }
step xcode-version . xcodebuild -version
step xcframework-unchanged . python3 -c "import json,hashlib,pathlib;q=json.load(open(\"reports/20261015-expo-0.4.29/qualified.json\"));p=pathlib.Path(\"packages/snapback4-expo\");bad=[k for k,v in q[\"xcframework\"].items() if hashlib.sha256((p/k).read_bytes()).hexdigest()!=v];print(\"xcframework unchanged since attempt 4 (Xcode 27.1):\",not bad,bad);exit(1 if bad else 0)"
step cargo-build . env CARGO_INCREMENTAL=0 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build --locked -p snapback4
step npm-identity . npm whoami
step simulator-boot . xcrun simctl boot $U
step simulator-ready . xcrun simctl bootstatus $U -b
step chat-backend-check apps/chat ../../target/debug/snapback4 check
step expo-ios-regenerate apps/chat-expo rm -rf ios
step expo-release-build apps/chat-expo env EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:44442 node ../../node_modules/expo/bin/cli run:ios --configuration Release --device generic --no-bundler --output ../../target/expo-release
step root-hook-dependencies .. bun install --frozen-lockfile
step simulator-uninstall . xcrun simctl uninstall $U dev.snapback4.chat
step simulator-install . xcrun simctl install $U target/expo-release/Snapback4chat.app
step native-link-verification . python3 $H/native-link.py
step native-witness . env WITNESS_UDID=$U WITNESS_PORT=44442 WITNESS_ARTIFACTS=$ROOT/reports/$PUBDATE-expo-$VERSION node witness/expo.mjs
step native-qualification-verification . python3 $H/native-verify.py
step simulator-shutdown . xcrun simctl shutdown $U
echo "NATIVE DONE"; echo "done" > /Users/ccheever/sb4-pub-0429/native-$ATTEMPT.exit
