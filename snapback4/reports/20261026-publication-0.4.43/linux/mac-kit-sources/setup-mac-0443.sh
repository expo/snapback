#!/bin/bash
# Build the 0.4.43 Mac kit from the 0.4.41 one, archive 0.4.41 attempt 2 (ba886e7be0) state, and move the publish
# worktree to f032742ac8 (Integration 27 final). Prunes the reused target's stale target/debug/deps entries (stale
# libsnapback4_native-*.rlib broke 0.4.41 dry run 1: column_reads takes the first match in read_dir order).
set -e
O=$HOME/sb4-pub-0441; K=$HOME/sb4-pub-0443; WT=$HOME/projects/snapback-pub-0428; W=$WT/snapback4
C=f032742ac80ff05e6f389ae18cdbbeed8c82d2a8; A=$O/archive-a2-ba886e7be0
[ -e $K ] && { echo "kit exists"; exit 1; }
[ -e $A ] && { echo "archive exists"; exit 1; }
for r in $(pgrep -f 'gate-(dryrun|lowpar|evidence)[.]sh|chain-(gate-)?a[0-9][.]sh|publish[.]mjs'); do
  c=$(lsof -a -d cwd -p $r -Fn 2>/dev/null | sed -n 's/^n//p'); case "$c" in $HOME/sb4-pub-*|$WT|$WT/*) echo "publish process still running: $r $c"; exit 1;; esac
done
marker=$(mktemp); touch $marker
# --- archive 0.4.41 attempt 2
mkdir -p $A/reports $A/kit-state $A/target-publication $A/target-incoming
for d in 20261025-publication-0.4.41 20261025-expo-0.4.41; do if [ -e $W/reports/$d ]; then mv $W/reports/$d $A/reports/; fi; done
(cd $O && for f in *.exit *.env-invalid *.pid *.note dryrun-a*.log gate.log gate-runner*.log chain-a2.log chain-gate-a2.out native-a2.log post-native-a2.log prepare-a2.log expo-prep-check-a2.log lean-a2.log warm-a2.log witness.jsonl.native-0441.diff isolated; do if [ -e "$f" ]; then mv "$f" $A/kit-state/; fi; done)
for d in client-0.4.41 client-0.4.41-a1-5c4716af14 snapback4-darwin-arm64-0.4.41-dr3-ba886e7be0 snapback4-darwin-arm64-0.4.41; do if [ -e $W/target/publication/$d ]; then mv $W/target/publication/$d $A/target-publication/; fi; done
if [ -e $W/target/incoming/linux-0.4.41 ]; then mv $W/target/incoming/linux-0.4.41 $A/target-incoming/; fi
if [ -e $W/target/expo-0.4.41 ]; then mv $W/target/expo-0.4.41 $A/target-incoming/; fi
echo "archived:"; ls $A $A/*
# --- kit
mkdir -p $K/helpers-0.4.43 $K/isolated
ren() { sed -e 's/0441/0443/g; s/0\.4\.41/0.4.43/g; s/20261025/20261026/g; s/ba886e7be0/f032742ac8/g; s/5c4716af14/f032742ac8/g' "$1" > "$2"; chmod +x "$2"; }
for f in native.sh publish.sh publish-lowpar.sh pubstep.sh finish.sh finish-tail.sh kill-dryrun.sh gate-dryrun.sh gate-evidence.sh gate-lowpar.sh mk-lowpar.sh mk-evidence.sh expo-prep-check.py clean-install.sh iso-dr1.sh iso-social.sh kill-iso.sh chain-a1.sh chain-gate-a1.sh; do ren $O/$f $K/$f; done
ren $O/post-native.sh $K/post-native.sh; sed -i '' -e 's/native attempt 2/native attempt 1/g' $K/post-native.sh
for f in $O/helpers-0.4.41/*; do ren $f $K/helpers-0.4.43/$(basename $f); done
# npm packument refresh: starter dependency pins are unchanged ba886e7be0..f032742ac8, so it uses the archived 0.4.41 dr3 stage bytes.
sed -e "s#^S=.*#S=$A/target-publication/snapback4-darwin-arm64-0.4.41-dr3-ba886e7be0#; s#sb4-pub-0441/#sb4-pub-0443/#g; 2i\\
# 0.4.43 setup: one --prefer-online refresh of the starter packuments (0.4.30 / 0.4.41 dr3 lesson), using the archived 0.4.41 stage (same starter pins).
" $O/refresh-npm-cache.sh > $K/refresh-npm-cache.sh; chmod +x $K/refresh-npm-cache.sh
grep -c 'f032742ac8' $K/post-native.sh $K/chain-a1.sh; grep -n 'attempt' $K/post-native.sh | cut -c1-120
grep -rln '0441\|0\.4\.41\|20261025\|ba886e7be0\|5c4716af14' $K --exclude=refresh-npm-cache.sh && { echo "stale names"; exit 1; } || echo "no stale names"
# --- worktree
cd $WT
git checkout -- snapback4/metrics/publish.jsonl snapback4/metrics/witness.jsonl 2>/dev/null || true
[ -z "$(git status --porcelain)" ] || { echo DIRTY; git status --porcelain; exit 1; }
git checkout -q --detach $C
echo "HEAD=$(git rev-parse HEAD)"; git status --porcelain | head -5
X=$(git rev-parse --git-common-dir)/info/exclude
grep -q '20261026-publication-0.4.43' $X || printf 'snapback4/reports/20261026-publication-0.4.43/\nsnapback4/reports/20261026-expo-0.4.43/\n' >> $X
find $W/target -maxdepth 1 -name '*.sqlite*' -delete
# --- prune stale deps (everything built before this setup)
echo "deps before: $(ls $W/target/debug/deps | wc -l) entries, $(du -sh $W/target/debug/deps | cut -f1); native rlibs: $(ls $W/target/debug/deps | grep -c '^libsnapback4_native-')"
find $W/target/debug/deps -mindepth 1 -maxdepth 1 ! -newer $marker -exec rm -rf {} +
echo "deps after: $(ls $W/target/debug/deps | wc -l) entries"; rm -f $marker
du -sh $W/target; df -h ~ | tail -1; uptime; pmset -g batt | head -2 | tail -1; ioreg -r -k AppleClamshellState | grep '"AppleClamshellState"'
xcodebuild -version; xcode-select -p
grep -h '"version"' $W/packages/*/package.json
ls $W/target/publication/
