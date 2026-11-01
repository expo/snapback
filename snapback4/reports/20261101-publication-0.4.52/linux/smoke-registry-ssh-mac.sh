#!/bin/bash
set -uo pipefail
R=$HOME/sb4-pub-0452-records
ssh -tt -o BatchMode=yes -o ConnectTimeout=15 ccheever@charlies-macbook-pro-m5max-black 'export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin; bash ~/sb4-pub-0452/smoke-direct.sh ~/sb4-pub-0452/registry-smoke-tgz/snapback4-darwin-arm64-0.4.52.tgz ~/sb4-pub-0452/registry-smoke-tgz/snapback4-0.4.52.tgz ~/sb4-pub-0452/isolated/smoke-registry' > "$R/smoke-registry-mac.log" 2>&1
rc=$?; echo "$rc" > "$R/smoke-registry-mac.exit"; exit "$rc"
