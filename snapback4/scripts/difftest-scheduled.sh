#!/usr/bin/env bash
# @ref LLP 3000.035#5.1 — calibrated rotating scheduled campaigns.
set -euo pipefail
exec python3 "$(dirname "$0")/difftest-scheduled.py" "$@"
