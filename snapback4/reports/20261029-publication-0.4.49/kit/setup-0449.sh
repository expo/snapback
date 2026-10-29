#!/bin/bash
# 0.4.49 (coordinator: Integration 33 final 55a4d4e39c): reuse the clean worktree ~/sb4-pub-0444-wt (outside ~/projects, no
# snapback/ ancestor); kit ~/sb4-pub-0449 renamed from ~/sb4-pub-0446 (gate-tolerant era). The 0.4.44 stage in the worktree's
# target/publication stays untouched.
set -e
C=55a4d4e39c75a6aa5f661222b4161d0c2a623f79; S=55a4d4e39c; OLDC=67740e59754e7f7e3fb231c58412774018fc0ae9; OLDS=67740e5975
WT=$HOME/sb4-pub-0444-wt; W=$WT/snapback4; K=$HOME/sb4-pub-0449; K6=$HOME/sb4-pub-0446
export PATH=/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
[ -e $K ] && { echo "kit exists"; exit 1; }
for r in $(pgrep -f 'gate-(dryrun|lowpar|evidence|tolerant)[.]sh|chain-(gate-|pre-)?a[0-9][.]sh|publish[.]mjs|pre-darwin[.]sh|build-0446[.]sh'); do
  c=$(lsof -a -d cwd -p $r -Fn 2>/dev/null | sed -n 's/^n//p'); case "$c" in $HOME/sb4-pub-*) echo "publish process still running: $r $c"; exit 1;; esac
done
git -C $HOME/projects/snapback cat-file -t $C
git -C $HOME/projects/snapback rev-parse -q --verify refs/heads/sb4-publish-0.4.49 >/dev/null || git -C $HOME/projects/snapback branch sb4-publish-0.4.49 $C
cd $WT; git checkout -- snapback4/metrics/publish.jsonl snapback4/metrics/witness.jsonl 2>/dev/null || true
find $W -maxdepth 4 -name ".rg-matrix-*" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
[ -z "$(git status --porcelain)" ] || { echo DIRTY; git status --porcelain | head; exit 1; }
git checkout -q --detach $C; echo "HEAD=$(git rev-parse HEAD)"; [ "$(git rev-parse HEAD)" = "$C" ] || exit 1
[ -z "$(git status --porcelain)" ] || { echo "DIRTY after checkout"; git status --porcelain | head; exit 1; }
echo "-- ancestors of $W:"
for d in $W $WT $HOME /Users /; do
  s=no; [ -d "$d/snapback" ] && s=YES
  p=none; if [ -f "$d/package.json" ]; then p=$(node -e 'const p=require(process.argv[1]);console.log(["dependencies","devDependencies"].some(k=>p[k]&&typeof p[k].snapback4==="string")?"DEPENDS":"no-dep")' "$d/package.json"); fi
  echo "   $d: snapback/=$s package.json=$p"; [ "$s" = YES ] && exit 1; [ "$p" = DEPENDS ] && exit 1
done
X=$(git rev-parse --git-common-dir)/info/exclude
grep -q '20261029-publication-0.4.49' $X || printf 'snapback4/reports/20261029-publication-0.4.49/\nsnapback4/reports/20261029-expo-0.4.49/\n' >> $X
grep -h '"version"' $W/packages/*/package.json | sort | uniq -c
for d in target/publication/client-0.4.49 target/publication/snapback4-darwin-arm64-0.4.49 target/incoming/linux-0.4.49 reports/20261029-publication-0.4.49 reports/20261029-expo-0.4.49; do [ -e $W/$d ] && { echo "exists: $d"; exit 1; }; done
ls $W/target/publication/ | tr '\n' ' '; echo
mkdir -p $K/helpers-0.4.49 $K/isolated
ren() { sed -e "s#$OLDC#$C#g; s#$OLDS#$S#g" -e 's#sb4-pub-0446#sb4-pub-0449#g; s#0\.4\.46#0.4.49#g; s#0446#0449#g; s#20261028#20261029#g' "$1" > "$2"; chmod +x "$2"; }
for f in native.sh publish.sh publish-lowpar.sh pubstep.sh finish.sh finish-tail.sh kill-dryrun.sh gate-tolerant.sh expo-prep-check.py clean-install.sh hold-dryrun.sh refresh-npm-cache-a1.sh chain-a1.sh chain-gate-a1.sh pre-darwin.sh post-native.sh; do ren $K6/$f $K/$f; done
for f in $K6/helpers-0.4.46/*; do ren $f $K/helpers-0.4.49/$(basename $f); done
# kill-dryrun: also match the tolerant gate (0.4.46's version predates gate-tolerant.sh)
sed -i '' -e 's/gate-(dryrun|lowpar|evidence)\[\.\]sh/gate-(dryrun|lowpar|evidence|tolerant)[.]sh/' $K/kill-dryrun.sh
grep -c "tolerant" $K/kill-dryrun.sh
grep -rln 'sb4-pub-0446\|0\.4\.46\|67740e5975\|20261028\|11fb847329\|d6f0253bfa\|87fb2ecef4' $K && { echo "stale names"; exit 1; } || echo "no stale names"
grep -n "attempt\|$S" $K/post-native.sh | cut -c1-140 | head -4
# pre-darwin: keep files present at this commit; add Integration 29-33 changed files that relay CLI output or mention the platform
python3 - $K/pre-darwin.sh $W <<'PY'
import sys,re,os
p,w=sys.argv[1],sys.argv[2]; s=open(p).read(); m=re.search(r'^F="(.*)"$', s, re.M)
files=m.group(1).split()
for extra in ['day5-proofs','surf4','ver1-loop']:
    f='$T/'+extra+'.test.mjs'
    if f not in files: files.append(f)
keep=[f for f in files if os.path.exists(os.path.join(w, f.replace('$T','packages/snapback4/test')))]
print('pre-darwin files', len(files), '->', len(keep), 'dropped', [f for f in files if f not in keep])
open(p,'w').write(s[:m.start(1)]+' '.join(keep)+s[m.end(1):])
PY
sed -n 2p $K/pre-darwin.sh | cut -c1-120
df -h ~ | tail -1; uptime; pmset -g batt | head -1
