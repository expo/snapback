#!/bin/bash
# 0.4.49 attempt 3 on DARWIN1's fix commit C (usage: setup-a3.sh <full-sha>; coordinator ruling: do not publish the
# 9c77333f2d stage, which has the Darwin root-owned-ancestor SIGTERM regression). Archives Mac attempt 2 (stage,
# client, incoming, reports, kit logs, isolated) to ~/sb4-pub-0449/archive-a2-9c77333f2d, checks out C, builds
# chain-a3/chain-gate-a3/chain-pre-a3 (pre-darwin, refresh, gate ATT=2) and refresh-after-suite-a2, and rebinds
# post-native/pre-darwin to C / native attempt 3. Push C to the Mac repo as sb4-publish-0.4.49-c first.
set -e
C=${1:?full sha}; S=${C:0:10}; OLDC=9c77333f2da4fb6eec5c9b3fb976ecdbc03e5265; OLDS=9c77333f2d
K=$HOME/sb4-pub-0449; WT=$HOME/sb4-pub-0444-wt; W=$WT/snapback4; A=$K/archive-a2-9c77333f2d
for r in $(pgrep -f 'gate-(dryrun|lowpar|evidence|tolerant)[.]sh|chain-(gate-|pre-)?a[0-9][.]sh|publish[.]mjs|pre-darwin[.]sh|iso-[a-z0-9-]*[.]sh|finish[.]sh|refresh-after-suite|run-client-tests[.]mjs'); do
  c=$(lsof -a -d cwd -p $r -Fn 2>/dev/null | sed -n 's/^n//p'); case "$c" in $K|$K/*|$WT|$WT/*) echo "publish process still running: $r $c"; exit 1;; esac
done
[ ${#C} = 40 ] || { echo "need the full sha"; exit 1; }
git -C $HOME/projects/snapback cat-file -t $C
[ -e $A ] && { echo "archive exists"; exit 1; }
mkdir -p $A/reports
for d in 20261029-publication-0.4.49 20261029-expo-0.4.49; do if [ -e $W/reports/$d ]; then mv $W/reports/$d $A/reports/; fi; done
git -C $W diff metrics/publish.jsonl > $A/publish.jsonl.a2-dry-run.diff || true
(cd $K && for f in *.exit *.env-invalid *.pid *-a2.log *-a2.out *-a2b.out *-a2c.out chain-a2.log chain-pre-a2.log chain-gate-a2.out chain-pre-a2.out pre-darwin.out witness.jsonl.native-0449.diff gate.log gate-runner-a2.log dryrun-a1.log finish-a1.log hold-dryrun.log refresh-after-suite-a1.log refresh-after-suite-a1.out setup-a2.out iso-*.out iso-*.done; do if [ -e "$f" ]; then mv "$f" $A/; fi; done)
if [ -d $K/isolated ] && [ -n "$(ls -A $K/isolated)" ]; then mv $K/isolated $A/ && mkdir -p $K/isolated; fi
for d in client-0.4.49 snapback4-darwin-arm64-0.4.49; do if [ -e $W/target/publication/$d ]; then mv $W/target/publication/$d $W/target/publication/$d-a2-$OLDS; fi; done
if [ -e $W/target/incoming/linux-0.4.49 ]; then mv $W/target/incoming/linux-0.4.49 $W/target/incoming/linux-0.4.49-a2-$OLDS; fi
if [ -e $W/target/expo-0.4.49 ]; then mv $W/target/expo-0.4.49 $W/target/expo-0.4.49-a2-$OLDS; fi
mkdir -p $W/target/incoming/linux-0.4.49
cd $WT
git checkout -- snapback4/metrics/publish.jsonl snapback4/metrics/witness.jsonl 2>/dev/null || true
find $W -maxdepth 4 -name ".rg-matrix-*" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
[ -z "$(git status --porcelain)" ] || { echo DIRTY; git status --porcelain; exit 1; }
git checkout -q --detach $C; echo "HEAD=$(git rev-parse HEAD)"; [ "$(git rev-parse HEAD)" = "$C" ] || exit 1
[ -z "$(git status --porcelain)" ] || { echo "DIRTY after checkout"; git status --porcelain | head; exit 1; }
cd $K
sed -e "s/$OLDS/$S/g; s/attempt 2/attempt 3/g; s/native-2/native-3/g; s/ATTEMPT=2/ATTEMPT=3/g; s/-a2[.]log/-a3.log/g; s/prepare-2/prepare-3/g; s/lean-2/lean-3/g; s/warm-2/warm-3/g; s/chain-a2/chain-a3/g" chain-a2.sh > chain-a3.sh
sed -e "s/chain-a2/chain-a3/g; s/native attempt 2/native attempt 3/g; s/$OLDS/$S/g" chain-gate-a2.sh > chain-gate-a3.sh
sed -e "s/chain-a2/chain-a3/g; s/chain-pre-a2/chain-pre-a3/g; s/native-2 prepare-2 lean-2 warm-2/native-3 prepare-3 lean-3 warm-3/; s/$OLDC/$C/g; s/$OLDS/$S/g; s/REFRESH_TAG=a2/REFRESH_TAG=a3/; s/refresh-npm-cache-a2[.]out/refresh-npm-cache-a3.out/g; s/gate-runner-a2[.]log/gate-runner-a3.log/; s/ATT=1 /ATT=2 /g" chain-pre-a2.sh > chain-pre-a3.sh
sed -e "s/attempt-1-publication-dry-run/attempt-2-publication-dry-run/; s/dry-run-1[.]exit/dry-run-2.exit/; s/refresh-after-suite-a1/refresh-after-suite-a2/g; s/REFRESH_TAG=a2c/REFRESH_TAG=a3c/; s/refresh-npm-cache-a2c/refresh-npm-cache-a3c/g; s/dry run 1/dry run 2/" refresh-after-suite-a1.sh > refresh-after-suite-a2.sh
sed -i '' -e "s/$OLDS/$S/g; s/native attempt 2/native attempt 3/g" post-native.sh
sed -i '' -e "s/$OLDS/$S/g" pre-darwin.sh
chmod +x chain-a3.sh chain-gate-a3.sh chain-pre-a3.sh refresh-after-suite-a2.sh
grep -rn "$OLDS" chain-a3.sh chain-gate-a3.sh chain-pre-a3.sh post-native.sh pre-darwin.sh refresh-after-suite-a2.sh && { echo "stale commit"; exit 1; } || echo "no stale commit"
grep -n "ATT=\|COMMIT=\|REFRESH_TAG\|native-3 prepare-3" chain-pre-a3.sh | cut -c1-170
grep -n "attempt-2-publication-dry-run\|dry-run-2.exit\|a3c" refresh-after-suite-a2.sh | cut -c1-150
cat chain-a3.sh | grep -n "native-3\|prepare-3\|warm-3" | cut -c1-120
find $W/target -maxdepth 1 -name '*.sqlite*' -delete
ls $W/target/publication/ | tr '\n' ' '; echo; ls $W/target/incoming/ | tr '\n' ' '; echo
df -h ~ | tail -1; uptime; pmset -g batt | head -2 | tail -1
