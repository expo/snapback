#!/bin/bash
# Build the 0.4.38 Mac kit from the 0.4.37 one and move the publish worktree to the 0.4.38 commit.
set -e
O=$HOME/sb4-pub-0437; K=$HOME/sb4-pub-0438; WT=$HOME/projects/snapback-pub-0428; W=$WT/snapback4
C=cadb7c55be13054036cc724786f0b9a9fe3b9bdc
[ -e $K ] && { echo "kit exists"; exit 1; }
pgrep -f 'gate-dryrun[.]sh|publish[.]mjs' && { echo "publish process still running"; exit 1; }
mkdir -p $K/helpers-0.4.38 $K/isolated
ren() { sed -e 's/0437/0438/g; s/0\.4\.37/0.4.38/g' "$1" > "$2"; chmod +x "$2"; }
for f in native.sh publish.sh publish-lowpar.sh pubstep.sh finish.sh finish-tail.sh kill-dryrun.sh gate-dryrun.sh gate-evidence.sh gate-lowpar.sh mk-lowpar.sh mk-evidence.sh expo-prep-check.py clean-install.sh iso-routes.sh iso-runadm.sh iso-screen.sh iso-vite.sh post-native.sh; do ren $O/$f $K/$f; done
for f in $O/helpers-0.4.37/*; do ren $f $K/helpers-0.4.38/$(basename $f); done
sed -i '' -e 's/93ede67fe2/cadb7c55be/g; s/native attempt 2/native attempt 1/g' $K/post-native.sh
grep -c 'cadb7c55be' $K/post-native.sh
grep -rln '0437\|0\.4\.37\|93ede67fe2' $K && { echo "stale names"; exit 1; } || echo "no stale names"
# 0.4.37 report dirs are now tracked on main (records commit bfe435467c): move the untracked copies out before checkout.
mkdir -p $O/worktree-reports-after-records
for d in 20261022-publication-0.4.37 20261022-expo-0.4.37; do [ -e $W/reports/$d ] && mv $W/reports/$d $O/worktree-reports-after-records/; done
cd $WT
git checkout -- snapback4/metrics/publish.jsonl snapback4/metrics/witness.jsonl 2>/dev/null || true
[ -z "$(git status --porcelain)" ] || { echo DIRTY; git status --porcelain; exit 1; }
git checkout -q --detach $C
echo "HEAD=$(git rev-parse HEAD)"; git status --porcelain | head -5
X=$(git rev-parse --git-common-dir)/info/exclude
grep -q '20261022-publication-0.4.38' $X || printf 'snapback4/reports/20261022-publication-0.4.38/\nsnapback4/reports/20261022-expo-0.4.38/\n' >> $X
find $W/target -maxdepth 1 -name '*.sqlite*' -delete
du -sh $W/target; df -h ~ | tail -1; uptime
xcodebuild -version; xcode-select -p
