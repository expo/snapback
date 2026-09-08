#!/bin/bash
# Kills a `node --test` child that has made no CPU progress for 5 minutes (the owner-drain hang
# after the ticketed revocation flake). Only children of my serialized package runs
# (`node --test --test-concurrency=1`). node --test marks that file failed and continues.
declare -A last_cpu last_seen
while true; do
  for p in $(pgrep -f 'node --test --test-concurrency=1'); do
    for c in $(pgrep -P "$p"); do
      cpu=$(ps -o time= -p "$c" 2>/dev/null | tr -d ' '); [ -n "$cpu" ] || continue
      now=$(date +%s)
      if [ "${last_cpu[$c]}" = "$cpu" ]; then
        if [ $((now - ${last_seen[$c]})) -ge 300 ]; then
          echo "$(date '+%H:%M:%S') killing idle test child $c ($(ps -o command= -p "$c" | awk '{print $NF}')) cpu=$cpu" >> /Users/ccheever/projects/snapback-el-20260908/log/hang-watchdog.log
          kill "$c" 2>/dev/null; sleep 3; kill -9 "$c" 2>/dev/null
          unset "last_cpu[$c]" "last_seen[$c]"
        fi
      else
        last_cpu[$c]=$cpu; last_seen[$c]=$now
      fi
    done
  done
  sleep 30
done
