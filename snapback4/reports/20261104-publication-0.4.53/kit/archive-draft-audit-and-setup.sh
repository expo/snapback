#!/bin/bash
set -euo pipefail
K=$HOME/sb4-pub-0453; C=${1:?}; cd "$K"
[ ! -e native-final-started.sha ]
mkdir -p archive-initial-draft
if [ -e preflight-publication-source ]; then mv preflight-publication-source archive-initial-draft/; fi
for f in early-audit-retry.log native-audits-green.sha; do [ ! -e "$f" ] || mv "$f" archive-initial-draft/; done
if [ -d isolated ]; then mv isolated archive-initial-draft/isolated-copied-scripts; fi
mkdir -p isolated
PUB52_SETUP_ONLY=1 bash ./setup-pub51.sh "$C"
