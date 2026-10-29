#!/bin/bash
# Flake rule for dry run 2's Rust red (snapback4::clock clock_advance_preserves_a_live_effect_claim_and_settlement, 1 ms off):
# run the exact test alone x6 and the whole clock target x3 with the built test executable, the dry-run environment and the
# suite runner's arguments (cwd = workspace root, --quiet --test-threads=2).
O=$HOME/sb4-pub-0449/isolated/iso-clock; mkdir -p $O
export PATH=/Users/ccheever/sb4-03-lanes/codesign-relay:/Users/ccheever/.elan/bin:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
export SNAPBACK4_REQUIRE_LEAN=1 CARGO_INCREMENTAL=0 SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33; unset SNAPBACK4_BIN
ulimit -n 65536
cd $HOME/sb4-pub-0444-wt/snapback4
X=$(ls -t target/debug/deps/clock-* | grep -v "\.d$" | head -1); echo "executable $X $(stat -f %Sm $X)" | tee $O/summary.txt
pass=0
for i in 1 2 3 4 5 6; do s=$(date +%s); $X --quiet --test-threads=2 --exact clock_advance_preserves_a_live_effect_claim_and_settlement > $O/single-$i.log 2>&1; rc=$?; [ $rc = 0 ] && pass=$((pass+1)); echo "$(date -u +%FT%TZ) single run $i rc=$rc $(( $(date +%s)-s )) s load=$(sysctl -n vm.loadavg | awk "{print \$2}") $(grep -E "test result" $O/single-$i.log | tail -1) $(grep -E "left:|right:" $O/single-$i.log | tr -s " " | tr "\n" " ")" | tee -a $O/summary.txt; done
echo "clock_advance_preserves_a_live_effect_claim_and_settlement alone: $pass/6 passed" | tee -a $O/summary.txt
tp=0
for i in 1 2 3; do s=$(date +%s); $X --quiet --test-threads=2 > $O/target-$i.log 2>&1; rc=$?; [ $rc = 0 ] && tp=$((tp+1)); echo "$(date -u +%FT%TZ) clock target run $i rc=$rc $(( $(date +%s)-s )) s $(grep -E "test result" $O/target-$i.log | tail -1)" | tee -a $O/summary.txt; done
echo "clock target: $tp/3 passed" | tee -a $O/summary.txt
git -C $HOME/sb4-pub-0444-wt status --porcelain | head -3; echo iso-clock-done > $O/done
