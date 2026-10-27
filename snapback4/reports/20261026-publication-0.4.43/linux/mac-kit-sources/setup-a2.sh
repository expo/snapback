#!/bin/bash
# 0.4.43 attempt 2 on a new commit C (usage: setup-a2.sh <full-sha>): archive Mac attempt 1 (f032742ac8), move client-0.4.43
# aside, check out C, build chain-a2/chain-gate-a2, rebind post-native to C / native attempt 2. Run from ~/sb4-pub-0443 on the Mac
# after pushing C to refs/heads/sb4-publish-0.4.43-b and after dry run 1's gate has exited.
set -e
C=${1:?full sha}; S=${C:0:10}
K=$HOME/sb4-pub-0443; WT=$HOME/projects/snapback-pub-0428; W=$WT/snapback4
A=$K/archive-a1-f032742ac8  # archive-a1.sh may already have run; leftovers are moved in too
for r in $(pgrep -f 'gate-(dryrun|lowpar|evidence)[.]sh|chain-(gate-)?a[0-9][.]sh|publish[.]mjs'); do
  c=$(lsof -a -d cwd -p $r -Fn 2>/dev/null | sed -n 's/^n//p'); case "$c" in $HOME/sb4-pub-*|$WT|$WT/*) echo "publish process still running: $r $c"; exit 1;; esac
done
mkdir -p $A/reports
for d in 20261026-publication-0.4.43 20261026-expo-0.4.43; do if [ -e $W/reports/$d ]; then mv $W/reports/$d $A/reports/; fi; done
(cd $K && for f in *.exit *.env-invalid *.pid *.note *-a1.log dryrun-a*.log gate.log gate-runner*.log chain-gate-a1.out witness.jsonl.native-0443.diff refresh-npm-cache.out; do if [ -e "$f" ]; then mv "$f" $A/; fi; done)
if [ -d $K/isolated ] && [ -n "$(ls -A $K/isolated)" ]; then mv $K/isolated $A/ && mkdir -p $K/isolated; fi
for d in client-0.4.43 snapback4-darwin-arm64-0.4.43; do if [ -e $W/target/publication/$d ]; then mv $W/target/publication/$d $W/target/publication/$d-a1-f032742ac8; fi; done
if [ -e $W/target/incoming/linux-0.4.43 ]; then mv $W/target/incoming/linux-0.4.43 $W/target/incoming/linux-0.4.43-a1-f032742ac8; fi
mkdir -p $W/target/incoming/linux-0.4.43
cd $WT
git checkout -- snapback4/metrics/publish.jsonl snapback4/metrics/witness.jsonl 2>/dev/null || true
find $W -maxdepth 4 -name ".rg-matrix-*" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
[ -z "$(git status --porcelain)" ] || { echo DIRTY; git status --porcelain; exit 1; }
git checkout -q --detach $C; echo "HEAD=$(git rev-parse HEAD)"; git status --porcelain | head -5
cd $K
sed -e "s/f032742ac8/$S/g; s/attempt 1/attempt 2/g; s/native-1/native-2/g; s/ATTEMPT=1/ATTEMPT=2/g; s/native-a1/native-a2/g; s/post-native-a1/post-native-a2/g; s/prepare-1/prepare-2/g; s/prepare-a1/prepare-a2/g; s/expo-prep-check-a1/expo-prep-check-a2/g; s/lean-1/lean-2/g; s/lean-a1/lean-a2/g; s/warm-1/warm-2/g; s/warm-a1/warm-a2/g; s/chain-a1/chain-a2/g" chain-a1.sh > chain-a2.sh
sed -e "s/chain-a1/chain-a2/g; s/for chain-a2 (native/for chain-a2 (native attempt 2 at $S;/" chain-gate-a1.sh > chain-gate-a2.sh
sed -i '' -e "s/f032742ac8/$S/g; s/native attempt 1/native attempt 2/g" post-native.sh
chmod +x chain-a2.sh chain-gate-a2.sh
grep -c "$S" post-native.sh chain-a2.sh; grep -n 'attempt' post-native.sh | cut -c1-140; cat chain-a2.sh
find $W/target -maxdepth 1 -name '*.sqlite*' -delete; ls $W/target/debug/deps | grep '^libsnapback4_native-' || true
df -h ~ | tail -1; uptime; pmset -g batt | head -2 | tail -1; ioreg -r -k AppleClamshellState | grep '"AppleClamshellState"'
