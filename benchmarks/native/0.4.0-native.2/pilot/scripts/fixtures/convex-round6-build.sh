#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source "$HOME/.snapback-env.sh"
export EXPO_PUBLIC_CONVEX_URL="${CLIQUE_NATIVE_ORIGIN:-http://127.0.0.1:49560}"
export TMPDIR="$PWD/.tmp"
exec xcodebuild -workspace ios/Clique.xcworkspace -scheme Clique -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$1" CODE_SIGNING_ALLOWED=NO build
