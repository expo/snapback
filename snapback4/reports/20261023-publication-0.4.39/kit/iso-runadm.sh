#!/bin/bash
# Flake rule step 1: run_admission live_dev_forwards... alone x12 + whole binary, same dry-run-built binary.
O=$HOME/sb4-pub-0439/isolated; mkdir -p $O
export PATH=/Users/ccheever/.elan/bin:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
ulimit -n 65536
W=$HOME/projects/snapback-pub-0428/snapback4; B=$W/target/debug/deps/run_admission-859061732a13e81d; T=live_dev_forwards_run_refuses_other_offline_writers_with_its_address_and_releases_on_exit
cd $W/crates/snapback4
uptime > $O/run-admission-load.txt
for i in $(seq 1 12); do s=$(python3 -c 'import time;print(time.time())'); timeout 600 $B --exact $T > $O/run-admission-alone-$i.log 2>&1; rc=$?; e=$(python3 -c "import time;print(round(time.time()-$s,1))"); echo "alone $i rc=$rc ${e}s $(grep -E '^test result' $O/run-admission-alone-$i.log)"; done
timeout 1200 $B > $O/run-admission-whole.log 2>&1; echo "whole rc=$? $(grep -E '^test result' $O/run-admission-whole.log)"
cd $W && git status --porcelain; uptime
