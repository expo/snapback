#!/bin/bash
# Build the 0.4.43 Mac kit from the 0.4.40 one and move the publish worktree to the 0.4.43 commit (5c4716af14, Integration 25 final).
set -e
O=$HOME/sb4-pub-0440; K=$HOME/sb4-pub-0443; WT=$HOME/projects/snapback-pub-0428; W=$WT/snapback4
C=5c4716af14b816eb13497c3e4a9948a1fe06ffff
[ -e $K ] && { echo "kit exists"; exit 1; }
# Refuse only if a publish gate from a kit, or a publish.mjs inside the publish worktree, is still running (other sessions' publish.mjs are not ours).
for r in $(pgrep -f 'gate-(dryrun|lowpar|evidence)[.]sh|publish[.]mjs'); do
  c=$(lsof -a -d cwd -p $r -Fn 2>/dev/null | sed -n 's/^n//p'); case "$c" in $HOME/sb4-pub-*|$WT|$WT/*) echo "publish process still running: $r $c"; exit 1;; esac
done
mkdir -p $K/helpers-0.4.43 $K/isolated
ren() { sed -e 's/0440/0443/g; s/0\.4\.40/0.4.43/g; s/20261024/20261026/g; s/0cb3de79ee/5c4716af14/g' "$1" > "$2"; chmod +x "$2"; }
for f in native.sh publish.sh publish-lowpar.sh pubstep.sh finish.sh finish-tail.sh kill-dryrun.sh gate-dryrun.sh gate-evidence.sh gate-lowpar.sh mk-lowpar.sh mk-evidence.sh expo-prep-check.py clean-install.sh iso-dr1.sh iso-social.sh post-native.sh chain-a1.sh chain-gate-a1.sh; do ren $O/$f $K/$f; done
for f in $O/helpers-0.4.40/*; do ren $f $K/helpers-0.4.43/$(basename $f); done
grep -c '5c4716af14' $K/post-native.sh $K/chain-a1.sh
grep -rln '0440\|0\.4\.40\|20261024\|0cb3de79ee' $K && { echo "stale names"; exit 1; } || echo "no stale names"
# 0.4.40 report dirs are now tracked on main (records commit 95ec6d3bd7): move the untracked copies out before checkout.
mkdir -p $O/worktree-reports-after-records
for d in 20261024-publication-0.4.40 20261024-expo-0.4.40; do if [ -e $W/reports/$d ]; then mv $W/reports/$d $O/worktree-reports-after-records/; fi; done
cd $WT
git checkout -- snapback4/metrics/publish.jsonl snapback4/metrics/witness.jsonl 2>/dev/null || true
[ -z "$(git status --porcelain)" ] || { echo DIRTY; git status --porcelain; exit 1; }
git checkout -q --detach $C
echo "HEAD=$(git rev-parse HEAD)"; git status --porcelain | head -5
X=$(git rev-parse --git-common-dir)/info/exclude
grep -q '20261026-publication-0.4.43' $X || printf 'snapback4/reports/20261026-publication-0.4.43/\nsnapback4/reports/20261026-expo-0.4.43/\n' >> $X
find $W/target -maxdepth 1 -name '*.sqlite*' -delete
du -sh $W/target; df -h ~ | tail -1; uptime
xcodebuild -version; xcode-select -p
grep -h '"version"' $W/packages/*/package.json
ls $W/target/publication/
