#!/bin/bash
# Archive 0.4.35 attempt 2 (2e10681b32, incl. the evidence-only Mac suite) and move the publish worktree to f0eed70bb3.
set -e
K=$HOME/sb4-pub-0435; WT=$HOME/projects/snapback-pub-0428; W=$WT/snapback4; A=$K/archive-a2-2e10681b32
C=f0eed70bb36705b08c0c065fa154b386b9ad0504
pgrep -f 'gate-evidence[.]sh|publish[.]mjs --dry-run' && { echo "evidence still running"; exit 1; }
[ -e $A ] && { echo "archive exists"; exit 1; }
mkdir -p $A
mv $K/native-2.exit $K/prepare-2.exit $K/lean-2.exit $K/warm-2.exit $K/native-a2.log $K/prepare-a2.log $K/lean-a2.log $K/warm-a2.log $K/chain-a2.log $K/witness.jsonl.native-0435.diff $A/
mv $K/dry-run-evidence-1.exit $K/dry-run-evidence-1.pid $K/dryrun-evidence-a1.log $K/gate-evidence.log $K/gate-evidence-runner.log $A/
mv $W/reports/20261021-publication-0.4.35 $A/publication-0.4.35
mv $W/reports/20261021-expo-0.4.35 $A/expo-0.4.35
mv $W/target/publication/client-0.4.35 $W/target/publication/client-0.4.35-a2-2e10681b32
[ -e $W/target/publication/snapback4-darwin-arm64-0.4.35 ] && mv $W/target/publication/snapback4-darwin-arm64-0.4.35 $W/target/publication/snapback4-darwin-arm64-0.4.35-evidence-2e10681b32 || echo "no darwin stage (suite red before staging)"
cd $W && find . -maxdepth 4 -name ".rg-matrix-*" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
cd $WT
git status --porcelain
git checkout -- snapback4/metrics/publish.jsonl snapback4/metrics/witness.jsonl 2>/dev/null || true
[ -z "$(git status --porcelain)" ] || { echo DIRTY; git status --porcelain; exit 1; }
git checkout -q --detach $C
echo "HEAD=$(git rev-parse HEAD)"; git status --porcelain | head -3
find $W/target -maxdepth 1 -name '*.sqlite*' -delete
ls $A; ls $W/target/publication/; df -h ~ | tail -1; uptime
