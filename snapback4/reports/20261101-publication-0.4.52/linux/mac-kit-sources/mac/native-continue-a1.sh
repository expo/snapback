#!/bin/bash
# Native half, in the 0.4.16 order. Stops at the first failed step.
: "${ATTEMPT:?}"
export VERSION=0.4.52 PUBDATE=20261101
export ROOT=/Users/ccheever/sb4-pub-0444-wt/snapback4 H=/Users/ccheever/sb4-pub-0452/helpers-0.4.52
export REP=$ROOT/reports/$PUBDATE-publication-$VERSION
S=/Users/ccheever/sb4-pub-0452/pubstep.sh
U=D2C67F7F-196C-439E-AEB9-3FDA4479761E
ulimit -n 65536
step() { "$S" "$@" || { echo "STOPPED at $1"; echo "stopped $1" > /Users/ccheever/sb4-pub-0452/native-$ATTEMPT.exit; exit 1; }; }
# Continue attempt 1 after its successful native builds; original npm-identity E401 retained.
while :; do
  free=$(df -g "$HOME" | tail -1 | awk '{print $4}')
  [ "$free" -ge 45 ] && break
  echo "$(date -u +%FT%TZ) DISK WAIT: ${free}GiB free; require 45GiB; recheck in 15 minutes"
  sleep 900
done
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
echo "NATIVE DONE"; echo "done" > /Users/ccheever/sb4-pub-0452/native-$ATTEMPT.exit
