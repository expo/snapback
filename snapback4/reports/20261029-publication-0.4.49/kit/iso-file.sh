#!/bin/bash
# usage: iso-file.sh <test file basename> <runs>: flake rule isolation on the Mac - run one client test file alone N times through the
# suite's runner with the dry run's environment (serial files, Lean required, 0.2.33 fence, codesign relay on PATH, default TMPDIR).
F=${1:?file}; N=${2:-6}; O=$HOME/sb4-pub-0449/isolated/iso-$F; mkdir -p $O
export PATH=/Users/ccheever/sb4-03-lanes/codesign-relay:/Users/ccheever/.elan/bin:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
ulimit -n 65536
cd $HOME/sb4-pub-0444-wt/snapback4
pass=0
for i in $(seq 1 $N); do
  s=$(date +%s)
  env -u SNAPBACK4_BIN -u SNAPBACK4_RUST_TEST_PROCESSES SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 SNAPBACK4_REQUIRE_LEAN=1 CARGO_INCREMENTAL=0 SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33 timeout 1800 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/$F.test.mjs > $O/run-$i.log 2>&1
  rc=$?; [ $rc = 0 ] && pass=$((pass+1))
  echo "$(date -u +%FT%TZ) $F run $i rc=$rc $(( $(date +%s)-s )) s load=$(sysctl -n vm.loadavg | awk '{print $2}') $(grep -E '^-- client files:' $O/run-$i.log | cut -c1-110) $(grep -E '^not ok' $O/run-$i.log | cut -c1-80 | tr '\n' ' ')" | tee -a $O/summary.txt
done
echo "$F alone: $pass/$N passed" | tee -a $O/summary.txt
git status --porcelain; echo iso-done
