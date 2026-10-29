#!/bin/bash
# After finish: save the worktree's metrics/publish.jsonl diff, then pull the Mac kit ~/sb4-pub-0449 and both 20261029 report dirs.
M=ccheever@charlies-macbook-pro-m5max-black; P=$HOME/sb4-pub-0449-records/mac-pull; mkdir -p $P
timeout 60 ssh -o BatchMode=yes $M 'cd ~/sb4-pub-0444-wt/snapback4 && git diff metrics/publish.jsonl > ~/sb4-pub-0449/publish.jsonl.diff && git status --porcelain' || exit 1
R="rsync -a --partial --timeout=60 -e 'ssh -o BatchMode=yes -o ConnectTimeout=15' --rsync-path=/usr/bin/rsync"
for i in $(seq 1 20); do
  eval timeout 1800 $R --exclude npm-refresh $M:sb4-pub-0449/ $P/sb4-pub-0449/ && \
  eval timeout 1800 $R $M:sb4-pub-0444-wt/snapback4/reports/20261029-publication-0.4.49 $M:sb4-pub-0444-wt/snapback4/reports/20261029-expo-0.4.49 $P/ && break
  echo "retry $i"; sleep 20
done
cp $P/sb4-pub-0449/publish.jsonl.diff $P/publish.jsonl.diff
du -sh $P/*; echo "publish.jsonl +$(grep -c '^+{' $P/publish.jsonl.diff)"
