#!/bin/bash
# Build the 0.4.40 Mac kit from the 0.4.39 one and move the publish worktree to the 0.4.40 commit (0cb3de79ee, Integration 24 final).
set -e
O=$HOME/sb4-pub-0439; K=$HOME/sb4-pub-0440; WT=$HOME/projects/snapback-pub-0428; W=$WT/snapback4
C=0cb3de79eefbdf79e12fe375cd919be29e999c6b
[ -e $K ] && { echo "kit exists"; exit 1; }
# Refuse only if a publish gate from a kit, or a publish.mjs inside the publish worktree, is still running (other sessions' publish.mjs are not ours).
for r in $(pgrep -f 'gate-(dryrun|lowpar|evidence)[.]sh|publish[.]mjs'); do
  c=$(lsof -a -d cwd -p $r -Fn 2>/dev/null | sed -n 's/^n//p'); case "$c" in $HOME/sb4-pub-*|$WT|$WT/*) echo "publish process still running: $r $c"; exit 1;; esac
done
mkdir -p $K/helpers-0.4.40 $K/isolated
ren() { sed -e 's/0439/0440/g; s/0\.4\.39/0.4.40/g; s/20261023/20261024/g' "$1" > "$2"; chmod +x "$2"; }
for f in native.sh publish.sh publish-lowpar.sh pubstep.sh finish.sh finish-tail.sh kill-dryrun.sh gate-dryrun.sh gate-evidence.sh gate-lowpar.sh mk-lowpar.sh mk-evidence.sh expo-prep-check.py clean-install.sh iso-dr1.sh iso-social.sh post-native.sh chain-a1.sh; do ren $O/$f $K/$f; done
for f in $O/helpers-0.4.39/*; do ren $f $K/helpers-0.4.40/$(basename $f); done
sed -i '' -e 's/d4441c83b6/0cb3de79ee/g' $K/post-native.sh $K/chain-a1.sh $K/iso-dr1.sh
# 0.4.39 lesson: clean-install.sh printed tail's exit code as "check rc"; capture check's own exit code.
python3 - $K/clean-install.sh <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='npx --no-install snapback4 check 2>&1 | tail -2; echo "check rc=$?"'
assert s.count(old)==1, s
s=s.replace(old,'npx --no-install snapback4 check > check.log 2>&1; rc=$?; tail -2 check.log; echo "check rc=$rc"')
old2='npx --no-install snapback4 init 2>&1 | tail -2;'
assert s.count(old2)==1
s=s.replace(old2,'npx --no-install snapback4 init > init.log 2>&1; irc=$?; tail -2 init.log; echo "init rc=$irc";')
open(p,'w').write(s)
PY
grep -c '0cb3de79ee' $K/post-native.sh
grep -rln '0439\|0\.4\.39\|20261023\|d4441c83b6' $K && { echo "stale names"; exit 1; } || echo "no stale names"
# 0.4.39 report dirs are now tracked on main (records commit 6cbe3869da): move the untracked copies out before checkout.
mkdir -p $O/worktree-reports-after-records
for d in 20261023-publication-0.4.39 20261023-expo-0.4.39; do if [ -e $W/reports/$d ]; then mv $W/reports/$d $O/worktree-reports-after-records/; fi; done
cd $WT
git checkout -- snapback4/metrics/publish.jsonl snapback4/metrics/witness.jsonl 2>/dev/null || true
[ -z "$(git status --porcelain)" ] || { echo DIRTY; git status --porcelain; exit 1; }
git checkout -q --detach $C
echo "HEAD=$(git rev-parse HEAD)"; git status --porcelain | head -5
X=$(git rev-parse --git-common-dir)/info/exclude
grep -q '20261024-publication-0.4.40' $X || printf 'snapback4/reports/20261024-publication-0.4.40/\nsnapback4/reports/20261024-expo-0.4.40/\n' >> $X
find $W/target -maxdepth 1 -name '*.sqlite*' -delete
du -sh $W/target; df -h ~ | tail -1; uptime
xcodebuild -version; xcode-select -p
grep -h '"version"' $W/packages/*/package.json
