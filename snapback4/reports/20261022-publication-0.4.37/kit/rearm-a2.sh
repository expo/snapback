#!/bin/bash
# Archive 0.4.37 attempt 1 (ee5a053303) on the Mac and move the publish worktree to the fix commit 93ede67fe2.
set -e
K=$HOME/sb4-pub-0437; WT=$HOME/projects/snapback-pub-0428; W=$WT/snapback4; A=$K/archive-a1-ee5a053303
C=93ede67fe2b620f30e6acb141fcf9f6042705439
pgrep -f 'gate-dryrun[.]sh|publish[.]mjs' && { echo "publish process running"; exit 1; }
[ -e $A ] && { echo "archive exists"; exit 1; }
mkdir -p $A
mv $K/native-1.exit $K/prepare-1.exit $K/lean-1.exit $K/warm-1.exit $K/native-a1.log $K/prepare-a1.log $K/lean-a1.log $K/warm-a1.log $K/chain-a1.log $K/chain-runner-a1.log $K/post-native-a1.log $K/expo-prep-check-a1.log $K/witness.jsonl.native-0437.diff $A/
mv $W/reports/20261022-publication-0.4.37 $A/publication-0.4.37
mv $W/reports/20261022-expo-0.4.37 $A/expo-0.4.37
mv $W/target/publication/client-0.4.37 $W/target/publication/client-0.4.37-a1-ee5a053303
# 0.4.35 report dirs are now tracked on main (records commit 4a85340d11): move the untracked copies out before checkout.
mkdir -p $HOME/sb4-pub-0435/worktree-reports-after-records
for d in 20261021-publication-0.4.35 20261021-expo-0.4.35; do [ -e $W/reports/$d ] && mv $W/reports/$d $HOME/sb4-pub-0435/worktree-reports-after-records/; done
cd $WT
git checkout -- snapback4/metrics/publish.jsonl snapback4/metrics/witness.jsonl 2>/dev/null || true
[ -z "$(git status --porcelain)" ] || { echo DIRTY; git status --porcelain; exit 1; }
git checkout -q --detach $C
echo "HEAD=$(git rev-parse HEAD)"; git status --porcelain | head -3
find $W/target -maxdepth 1 -name '*.sqlite*' -delete
sed -i '' -e 's/ee5a053303/93ede67fe2/g; s/native attempt 1/native attempt 2/g' $K/post-native.sh
grep -c '93ede67fe2' $K/post-native.sh
ls $A; ls $W/target/publication/; df -h ~ | tail -1; uptime
