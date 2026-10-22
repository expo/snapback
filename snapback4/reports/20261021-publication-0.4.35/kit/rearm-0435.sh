#!/bin/bash
# Archive 0.4.35 attempt 1 (3373998583) on the Mac and move the publish worktree to the requalification commit.
set -e
K=$HOME/sb4-pub-0435; WT=$HOME/projects/snapback-pub-0428; W=$WT/snapback4; A=$K/archive-a1-3373998583
C=2e10681b327f1c473428c103483b3d42ec38434f
[ -e $A ] && { echo "archive exists"; exit 1; }
mkdir -p $A
mv $K/native-1.exit $K/prepare-1.exit $K/lean-1.exit $K/warm-1.exit $K/native-a1.log $K/prepare-a1.log $K/lean-a1.log $K/warm-a1.log $K/chain-a1.log $K/witness.jsonl.native-0435.diff $A/
mv $W/reports/20261021-publication-0.4.35 $A/publication-0.4.35
mv $W/reports/20261021-expo-0.4.35 $A/expo-0.4.35
mv $W/target/publication/client-0.4.35 $W/target/publication/client-0.4.35-a1-3373998583
cd $WT
git checkout -- snapback4/metrics/publish.jsonl snapback4/metrics/witness.jsonl 2>/dev/null || true
[ -z "$(git status --porcelain)" ] || { echo DIRTY; git status --porcelain; exit 1; }
git checkout -q --detach $C
echo "HEAD=$(git rev-parse HEAD)"; git status --porcelain | head -3
find $W/target -maxdepth 1 -name '*.sqlite*' -delete
ls $A; ls $W/target/publication/
uptime
