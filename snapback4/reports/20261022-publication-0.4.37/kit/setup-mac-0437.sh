#!/bin/bash
# Build the 0.4.37 Mac kit from the 0.4.35 one and move the publish worktree to the 0.4.37 commit.
set -e
O=$HOME/sb4-pub-0435; K=$HOME/sb4-pub-0437; WT=$HOME/projects/snapback-pub-0428; W=$WT/snapback4
C=ee5a0533034e55db9adfd3a5eba4d783d5a511fb
[ -e $K ] && { echo "kit exists"; exit 1; }
pgrep -f 'gate-dryrun[.]sh|publish[.]mjs' && { echo "publish process still running"; exit 1; }
mkdir -p $K/helpers-0.4.37 $K/isolated
ren() { sed -e 's/0435/0437/g; s/0\.4\.35/0.4.37/g; s/20261021/20261022/g' "$1" > "$2"; chmod +x "$2"; }
for f in native.sh publish.sh publish-lowpar.sh pubstep.sh finish.sh finish-tail.sh kill-dryrun.sh gate-dryrun.sh gate-evidence.sh gate-lowpar.sh mk-lowpar.sh mk-evidence.sh expo-prep-check.py clean-install.sh iso-routes.sh iso-runadm.sh iso-screen.sh iso-vite.sh post-native-a3.sh; do ren $O/$f $K/$f; done
for f in $O/helpers-0.4.35/*; do ren $f $K/helpers-0.4.37/$(basename $f); done
mv $K/post-native-a3.sh $K/post-native.sh
grep -rln '0435\|0\.4\.35\|20261021' $K && { echo "stale names"; exit 1; } || echo "no stale names"
cd $WT
git checkout -- snapback4/metrics/publish.jsonl snapback4/metrics/witness.jsonl 2>/dev/null || true
[ -z "$(git status --porcelain)" ] || { echo DIRTY; git status --porcelain; exit 1; }
git checkout -q --detach $C
echo "HEAD=$(git rev-parse HEAD)"; git status --porcelain | head -5
X=$(git rev-parse --git-common-dir)/info/exclude
grep -q '20261022-publication-0.4.37' $X || printf 'snapback4/reports/20261022-publication-0.4.37/\nsnapback4/reports/20261022-expo-0.4.37/\n' >> $X
find $W/target -maxdepth 1 -name '*.sqlite*' -delete
du -sh $W/target; df -h ~ | tail -1; uptime
xcodebuild -version; xcode-select -p
