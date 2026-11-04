#!/bin/bash
set -euo pipefail
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$HOME/.bun/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
K=$HOME/sb4-pub-0453; W=$HOME/sb4-pub-0453-wt; C=${1:?}; cd "$K"
[ ! -e native-final-started.sha ]
old=$(git -C "$W" rev-parse --short=12 HEAD)
A=$K/archive-preflight-$old; mkdir -p "$A"
[ ! -d preflight-publication-source ] || mv preflight-publication-source "$A/"
[ ! -f native-audits-green.sha ] || mv native-audits-green.sha "$A/"
PUB52_SETUP_ONLY=1 bash ./setup-pub51.sh "$C"
