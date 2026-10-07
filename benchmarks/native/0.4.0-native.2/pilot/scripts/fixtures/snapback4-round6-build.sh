#!/bin/bash
set -euo pipefail
source ~/.snapback-env.sh
clique_node="$(volta run --node 24.18.0 node -p 'process.execPath')"
export PATH="$(dirname "$clique_node"):$PATH"
export NODE_BINARY="$clique_node"
export NODE_ENV=production
printf 'export NODE_BINARY=%s\n' "$clique_node" > ios/.xcode.env.local
export TMPDIR="$PWD/.tmp"
export EXPO_PUBLIC_SNAPBACK_URL="${CLIQUE_NATIVE_ORIGIN:-http://127.0.0.1:49540}"
destination="generic/platform=iOS Simulator"
if [[ -n "${2:-}" ]]; then destination="platform=iOS Simulator,id=$2"; fi
exec xcodebuild -workspace ios/Clique.xcworkspace -scheme Clique -configuration Release -destination "$destination" -derivedDataPath "$1" CODE_SIGNING_ALLOWED=NO ARCHS=arm64 OTHER_SWIFT_FLAGS='$(inherited) -disable-sandbox' build
