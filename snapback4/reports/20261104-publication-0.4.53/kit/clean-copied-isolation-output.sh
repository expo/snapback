#!/bin/bash
set -euo pipefail
K=$HOME/sb4-pub-0453; cd "$K"; [ ! -e native-final-started.sha ]
if [ -d isolated ] && [ -n "$(find isolated -type f -print -quit)" ]; then mv isolated archive-initial-draft/isolated-resynced-code; fi
mkdir -p isolated
