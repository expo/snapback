#!/usr/bin/env bash
# The native module for Apple: the two iOS targets on the production
# profile with size optimization, packed with the C header and a module map,
# so Swift imports `Snapback4Device`. Writes packages/snapback4-expo/ios/.
set -euo pipefail
cd "$(dirname "$0")/.."
# @ref LLP 3000#7-decisions-during-execution — the shipped device must honor the Expo podspec's iOS minimum.
# rustc and cc (bundled SQLite) both use this for device and simulator;
# without it cc defaults to the installed SDK's version, not the podspec.
export IPHONEOS_DEPLOYMENT_TARGET=16.4
out=packages/snapback4-expo/ios/Snapback4Device.xcframework
headers=$(mktemp -d)
cp crates/snapback4-device/include/snapback4.h "$headers/"
printf 'module Snapback4Device {\n  header "snapback4.h"\n  export *\n}\n' > "$headers/module.modulemap"
# The crate is also an rlib (the CLI's `device` verb, the tests); a build
# of every crate type at once leaves the staticlib un-optimised across
# crates, 37 MB of bitcode. Asked for as a staticlib alone it is one
# optimised object beside SQLite and the builtins; stripped, about 6.6 MB a slice with the native-read host.
stripped=$(mktemp -d)
for target in aarch64-apple-ios aarch64-apple-ios-sim; do
  cargo rustc -p snapback4-device --crate-type staticlib --profile production --config 'profile.production.opt-level="z"' --target "$target" --quiet
  mkdir -p "$stripped/$target"
  strip -S -x "target/$target/production/libsnapback4_device.a" -o "$stripped/$target/libsnapback4_device.a"
done
rm -rf "$out"
xcodebuild -create-xcframework \
  -library "$stripped/aarch64-apple-ios/libsnapback4_device.a" -headers "$headers" \
  -library "$stripped/aarch64-apple-ios-sim/libsnapback4_device.a" -headers "$headers" \
  -output "$out" | tail -1
rm -rf "$headers" "$stripped"
du -sh "$out" | awk '{print "xcframework " $1}'
