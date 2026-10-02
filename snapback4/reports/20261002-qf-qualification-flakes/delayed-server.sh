#!/usr/bin/env bash
set -euo pipefail
qf_root=$(cd "$(dirname "$0")/../.." && pwd)
# Delay only the target server and its children. Ordinary load servers do not
# use this wrapper. -I 2 keeps fixture SIGTERM effective when output is hidden.
exec strace -I 2 --kill-on-exit -f -qq -o /dev/null -e trace=clone3 \
  -e inject=clone3:delay_enter=100ms "$qf_root/target/debug/snapback4" "$@"
