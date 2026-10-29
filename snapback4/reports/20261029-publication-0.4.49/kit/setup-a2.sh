#!/bin/bash
# 0.4.49 attempt 2 on 9c77333f2da4fb6eec5c9b3fb976ecdbc03e5265 (55a4d4e39c + the macOS fixture fixes 352c18cbcc srv1-lifetime and 9c77333f2d dx10):
# archive Mac attempt 1 to ~/sb4-pub-0449/archive-a1-55a4d4e39c, move client/incoming 0.4.49 aside, check out C, build
# chain-a2/chain-gate-a2/chain-pre-a2, rebind post-native and pre-darwin to C / native attempt 2. Pushed as sb4-publish-0.4.49-b.
set -e
C=9c77333f2da4fb6eec5c9b3fb976ecdbc03e5265; S=${C:0:10}
K=$HOME/sb4-pub-0449; WT=$HOME/sb4-pub-0444-wt; W=$WT/snapback4; A=$K/archive-a1-55a4d4e39c
for r in $(pgrep -f 'gate-(dryrun|lowpar|evidence|tolerant)[.]sh|chain-(gate-|pre-)?a[0-9][.]sh|publish[.]mjs|pre-darwin[.]sh|iso-[a-z0-9-]*[.]sh|diag-dx10[a-z]*[.]sh|run-client-tests[.]mjs'); do
  c=$(lsof -a -d cwd -p $r -Fn 2>/dev/null | sed -n 's/^n//p'); case "$c" in $K|$K/*|$WT|$WT/*) echo "publish process still running: $r $c"; exit 1;; esac
done
git -C $HOME/projects/snapback cat-file -t $C
[ -e $A ] && { echo "archive exists"; exit 1; }
mkdir -p $A/reports
for d in 20261029-publication-0.4.49 20261029-expo-0.4.49; do if [ -e $W/reports/$d ]; then mv $W/reports/$d $A/reports/; fi; done
(cd $K && for f in *.exit *.env-invalid *.pid *-a1.log *-a1.out chain-a1.log chain-pre-a1.log chain-gate-a1.out chain-pre-a1.out pre-darwin.out witness.jsonl.native-0449.diff refresh-npm-cache-a1.out iso-*.out iso-*.done diag-dx10*.out dx10.exp.test.mjs srv1-lifetime.fixed.test.mjs t21.sh; do if [ -e "$f" ]; then mv "$f" $A/; fi; done)
if [ -d $K/isolated ] && [ -n "$(ls -A $K/isolated)" ]; then mv $K/isolated $A/ && mkdir -p $K/isolated; fi
for d in client-0.4.49 snapback4-darwin-arm64-0.4.49; do if [ -e $W/target/publication/$d ]; then mv $W/target/publication/$d $W/target/publication/$d-a1-55a4d4e39c; fi; done
if [ -e $W/target/incoming/linux-0.4.49 ]; then mv $W/target/incoming/linux-0.4.49 $W/target/incoming/linux-0.4.49-a1-55a4d4e39c; fi
if [ -e $W/target/expo-0.4.49 ]; then mv $W/target/expo-0.4.49 $W/target/expo-0.4.49-a1-55a4d4e39c; fi
mkdir -p $W/target/incoming/linux-0.4.49
cd $WT
git checkout -- snapback4/metrics/publish.jsonl snapback4/metrics/witness.jsonl 2>/dev/null || true
find $W -maxdepth 4 -name ".rg-matrix-*" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
[ -z "$(git status --porcelain)" ] || { echo DIRTY; git status --porcelain; exit 1; }
git checkout -q --detach $C; echo "HEAD=$(git rev-parse HEAD)"; [ "$(git rev-parse HEAD)" = "$C" ] || exit 1
[ -z "$(git status --porcelain)" ] || { echo "DIRTY after checkout"; git status --porcelain | head; exit 1; }
cd $K
sed -e "s/55a4d4e39c/$S/g; s/attempt 1/attempt 2/g; s/native-1/native-2/g; s/ATTEMPT=1/ATTEMPT=2/g; s/-a1[.]log/-a2.log/g; s/prepare-1/prepare-2/g; s/lean-1/lean-2/g; s/warm-1/warm-2/g; s/chain-a1/chain-a2/g" chain-a1.sh > chain-a2.sh
sed -e "s/chain-a1/chain-a2/g; s/native attempt 1/native attempt 2/g; s/55a4d4e39c/$S/g" chain-gate-a1.sh > chain-gate-a2.sh
sed -e "s/chain-a1/chain-a2/g; s/chain-pre-a1/chain-pre-a2/g; s/native-1 prepare-1 lean-1 warm-1/native-2 prepare-2 lean-2 warm-2/; s/55a4d4e39c75a6aa5f661222b4161d0c2a623f79/$C/g; s/55a4d4e39c/$S/g; s/REFRESH_TAG=a1/REFRESH_TAG=a2/; s/refresh-npm-cache-a1[.]out/refresh-npm-cache-a2.out/g; s/gate-runner-a1[.]log/gate-runner-a2.log/" chain-pre-a1.sh > chain-pre-a2.sh
sed -i '' -e "s/55a4d4e39c/$S/g; s/native attempt 1/native attempt 2/g" post-native.sh
sed -i '' -e "s/55a4d4e39c/$S/g" pre-darwin.sh
chmod +x chain-a2.sh chain-gate-a2.sh chain-pre-a2.sh
grep -c "$S" post-native.sh chain-a2.sh chain-gate-a2.sh chain-pre-a2.sh pre-darwin.sh
grep -rn "55a4d4e39c" chain-a2.sh chain-gate-a2.sh chain-pre-a2.sh post-native.sh pre-darwin.sh && { echo "stale commit"; exit 1; } || echo "no stale commit"
grep -n "ATT=\|COMMIT=\|REFRESH_TAG\|native-2 prepare-2" chain-pre-a2.sh | cut -c1-160
cat chain-a2.sh
find $W/target -maxdepth 1 -name '*.sqlite*' -delete
ls $W/target/publication/ | tr '\n' ' '; echo; ls $W/target/incoming/ | tr '\n' ' '; echo
df -h ~ | tail -1; uptime; pmset -g batt | head -2 | tail -1
