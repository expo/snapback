#!/bin/bash
# Archive 0.4.38 attempt 1 (cadb7c55be, Linux red from 202826334f) on the Mac and move the publish worktree to 951ecdd4df (coordinator ruling).
set -e
K=$HOME/sb4-pub-0438; WT=$HOME/projects/snapback-pub-0428; W=$WT/snapback4; A=$K/archive-a1-cadb7c55be
C=951ecdd4dfe3a42052d2227d6aec45146782816d
pgrep -f 'gate-dryrun[.]sh|publish[.]mjs' && { echo "publish process running"; exit 1; }
[ -e $A ] && { echo "archive exists"; exit 1; }
mkdir -p $A
mv $K/native-1.exit $K/prepare-1.exit $K/lean-1.exit $K/warm-1.exit $K/native-a1.log $K/prepare-a1.log $K/lean-a1.log $K/warm-a1.log $K/chain-a1.log $K/chain-runner-a1.log $K/post-native-a1.log $K/expo-prep-check-a1.log $K/witness.jsonl.native-0438.diff $A/
mv $W/reports/20261022-publication-0.4.38 $A/publication-0.4.38
mv $W/reports/20261022-expo-0.4.38 $A/expo-0.4.38
mv $W/target/publication/client-0.4.38 $W/target/publication/client-0.4.38-a1-cadb7c55be
cd $WT
git checkout -- snapback4/metrics/publish.jsonl snapback4/metrics/witness.jsonl 2>/dev/null || true
[ -z "$(git status --porcelain)" ] || { echo DIRTY; git status --porcelain; exit 1; }
git checkout -q --detach $C
echo "HEAD=$(git rev-parse HEAD)"; git status --porcelain | head -3
find $W/target -maxdepth 1 -name '*.sqlite*' -delete
sed -i '' -e 's/cadb7c55be/951ecdd4df/g; s/native attempt 1/native attempt 2/g' $K/post-native.sh
grep -c '951ecdd4df' $K/post-native.sh
sed -e 's/chain-a1/chain-a2/g; s/attempt 1 Mac chain (cadb7c55be)/attempt 2 Mac chain (951ecdd4df)/; s/ATTEMPT=1/ATTEMPT=2/g; s/native-1/native-2/g; s/prepare-1/prepare-2/g; s/lean-1/lean-2/g; s/warm-1/warm-2/g; s/-a1\.log/-a2.log/g' $K/chain-a1.sh > $K/chain-a2.sh
ls $A; ls $W/target/publication/ | grep 0.4.38; df -h ~ | tail -1; uptime
