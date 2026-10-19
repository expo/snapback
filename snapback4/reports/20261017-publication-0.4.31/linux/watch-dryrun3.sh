#!/bin/bash
# Background watcher for Mac dry run attempt 2: exits when the exit file appears or a FAIL line shows. Logs to watch-dryrun3.out
L=reports/20261017-publication-0.4.31/attempt-3-publication-dry-run.log
for i in $(seq 1 90); do
  r=$(timeout 45 ssh -o BatchMode=yes -o ConnectTimeout=15 ccheever@charlies-macbook-pro-m5max-black "cat ~/sb4-pub-0431/dry-run-3.exit 2>/dev/null; cd ~/projects/snapback-pub-0428/snapback4; grep -E '^-- (ok|FAIL)|^== [0-9]|FAIL' $L 2>/dev/null | tail -4" 2>/dev/null)
  echo "$(date -u +%T) ${r:-unreachable}" | tr '\n' ' ' >> ~/sb4-pub-0431-kit/watch-dryrun3.out; echo >> ~/sb4-pub-0431-kit/watch-dryrun3.out
  if printf '%s\n' "$r" | grep -qE "^(done|stopped)|FAIL"; then printf '%s\n' "$r"; exit 0; fi
  sleep 240
done
echo timeout-watch
