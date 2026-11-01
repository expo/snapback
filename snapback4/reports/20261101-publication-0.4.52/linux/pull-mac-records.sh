#!/bin/bash
# After finish: save the worktree's metrics/publish.jsonl diff, then pull the Mac kit ~/sb4-pub-0452 and both 20261101 report dirs.
set -euo pipefail
M=ccheever@charlies-macbook-pro-m5max-black; P=$HOME/sb4-pub-0452-records/mac-pull; mkdir -p $P
timeout 60 ssh -o BatchMode=yes $M 'cd ~/sb4-pub-0444-wt/snapback4 && git diff metrics/publish.jsonl > ~/sb4-pub-0452/publish.jsonl.diff && git status --porcelain' || exit 1
PUB52_RSYNC=(rsync -a --no-links --partial --timeout=60 -e 'ssh -o BatchMode=yes -o ConnectTimeout=15' --rsync-path=/usr/bin/rsync
  --exclude=node_modules '--exclude=npm-cache*' --exclude=.npm --exclude=.npmrc --exclude=.harness-env.json '--exclude=.env*')
copied=0
for i in $(seq 1 20); do
  if timeout 1800 "${PUB52_RSYNC[@]}" --exclude npm-refresh "$M:sb4-pub-0452/" "$P/sb4-pub-0452/" && \
     timeout 1800 "${PUB52_RSYNC[@]}" "$M:sb4-pub-0444-wt/snapback4/reports/20261101-publication-0.4.52" "$M:sb4-pub-0444-wt/snapback4/reports/20261101-expo-0.4.52" "$P/"; then
    copied=1; break
  fi
  echo "retry $i"; sleep 20
done
[ "$copied" = 1 ] || { echo 'records transfer incomplete after retries'; exit 1; }
cp "$P/sb4-pub-0452/publish.jsonl.diff" "$P/publish.jsonl.diff"
du -sh $P/*; echo "publish.jsonl +$(grep -c '^+{' $P/publish.jsonl.diff)"
