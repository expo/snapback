#!/bin/bash
set -uo pipefail
R=$HOME/sb4-pub-0452-records
ssh -tt -o BatchMode=yes -o ConnectTimeout=15 localhost 'export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin; bash ~/sb4-pub-0452-kit/smoke-direct.sh ~/sb4-pub-0452-records/staged-0.4.52/snapback4-linux-x64-0.4.52.tgz ~/sb4-pub-0452-records/staged-0.4.52/snapback4-0.4.52.tgz ~/sb4-pub-0452-kit/isolated/smoke-staged' > "$R/smoke-staged-linux.log" 2>&1
rc=$?; echo "$rc" > "$R/smoke-staged-linux.exit"; exit "$rc"
