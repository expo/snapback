#!/bin/bash
# usage: wait-pids.sh <seconds> <pidfile>...  — exits when any listed pid file's process exits, or after <seconds>
limit=$1; shift; start=$(date +%s)
while true; do
  for f in "$@"; do p=$(cat "$f" 2>/dev/null); if [ -n "$p" ] && ! ps -p "$p" >/dev/null 2>&1; then echo "EXITED $(basename $f) pid=$p after $(( $(date +%s) - start ))s"; exit 0; fi; done
  if [ $(( $(date +%s) - start )) -ge "$limit" ]; then echo "TICK after ${limit}s: $*"; exit 0; fi
  sleep 30
done
