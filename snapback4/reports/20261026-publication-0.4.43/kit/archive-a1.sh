#!/bin/bash
# Archive Mac attempt 1 (f032742ac8: native-1/prepare-1/warm-1 + dry run 1 red in wave10-upgrade) to ~/sb4-pub-0443/archive-a1-f032742ac8/.
set -e
K=$HOME/sb4-pub-0443; WT=$HOME/projects/snapback-pub-0428; W=$WT/snapback4; A=$K/archive-a1-f032742ac8
for r in $(pgrep -f 'gate-(dryrun|lowpar|evidence)[.]sh|chain-(gate-)?a[0-9][.]sh|publish[.]mjs|iso-wave10[.]sh'); do
  c=$(lsof -a -d cwd -p $r -Fn 2>/dev/null | sed -n 's/^n//p'); case "$c" in $HOME/sb4-pub-*|$WT|$WT/*) echo "publish process still running: $r $c"; exit 1;; esac
done
mkdir -p $A/reports
for d in 20261026-publication-0.4.43 20261026-expo-0.4.43; do if [ -e $W/reports/$d ]; then mv $W/reports/$d $A/reports/; fi; done
(cd $K && for f in *.exit *.env-invalid *.pid *.note *-a1.log dryrun-a*.log gate.log gate-runner*.log chain-gate-a1.out witness.jsonl.native-0443.diff refresh-npm-cache.out iso-wave10.out; do if [ -e "$f" ]; then mv "$f" $A/; fi; done)
if [ -d $K/isolated ] && [ -n "$(ls -A $K/isolated)" ]; then mv $K/isolated $A/ && mkdir -p $K/isolated; fi
for d in client-0.4.43 snapback4-darwin-arm64-0.4.43; do if [ -e $W/target/publication/$d ]; then mv $W/target/publication/$d $W/target/publication/$d-a1-f032742ac8; fi; done
if [ -e $W/target/incoming/linux-0.4.43 ]; then mv $W/target/incoming/linux-0.4.43 $W/target/incoming/linux-0.4.43-a1-f032742ac8; fi
cd $WT; git checkout -- snapback4/metrics/publish.jsonl snapback4/metrics/witness.jsonl 2>/dev/null || true
git status --porcelain; git rev-parse HEAD; ls $A $A/reports; ls $W/target/publication | grep 0.4.43
