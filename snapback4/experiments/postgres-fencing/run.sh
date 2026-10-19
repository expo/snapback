#!/usr/bin/env bash
# One command per witness:   ./run.sh w2        (or: ./run.sh all, ./run.sh w1 w3)
# Starts the private cluster if needed (scripts/cluster.sh up), builds, runs,
# and tees the transcript to results/<witness>.txt. Stop it with
# scripts/cluster.sh down.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
cd "$here"
envfile=$(scripts/cluster.sh up)
. "$envfile"
cargo build --release --offline -q
gcc -O2 -shared -fPIC -o target/release/../skewclock.so shim/skewclock.c -ldl
mkdir -p results
name=$(IFS=-; echo "${*:-all}")
target/release/witness "${@:-all}" 2>&1 | tee "results/$name.txt"
