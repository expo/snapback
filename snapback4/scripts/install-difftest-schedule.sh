#!/usr/bin/env bash
# Installs only when explicitly invoked by an operator. Never called by tests.
# @ref LLP 3000.035#5.1 — scheduled testing beside the Postgres corpus.
set -euo pipefail
exec python3 "$(dirname "$0")/install-difftest-schedule.py" "$@"
