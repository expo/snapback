#!/bin/bash
# usage: wait-tick.sh <seconds> <lane>...  — exits when any lane's codex pid exits or after <seconds>
D=/Users/ccheever/projects/snapback-el-20260908; limit=$1; shift; start=$(date +%s)
while true; do
  for l in "$@"; do p=$(cat $D/pids/codex-$l 2>/dev/null); if [ -n "$p" ] && ! ps -p "$p" >/dev/null 2>&1; then echo "EXITED lane=$l pid=$p after $(( $(date +%s) - start ))s"; exit 0; fi; done
  if [ $(( $(date +%s) - start )) -ge "$limit" ]; then echo "TICK after ${limit}s; all still running: $*"; exit 0; fi
  sleep 30
done
