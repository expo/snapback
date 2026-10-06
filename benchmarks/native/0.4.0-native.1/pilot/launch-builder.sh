#!/bin/bash
set -euo pipefail
source "$HOME/.snapback-env.sh"
export PATH="$HOME/.volta/tools/image/node/24.18.0/bin:$PATH"
export PYTHONDONTWRITEBYTECODE=1
cd "$(dirname "$0")"
exec python3 scripts/builder.py launch "$@"
