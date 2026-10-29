#!/bin/bash
# Read-only Darwin diagnosis of dx10-process-accounts test 8: run only that test once while sampling the process tree
# (pid, ppid, pgid, stat, command) of the npm/driver/native-serve processes every 250 ms.
O=$HOME/sb4-pub-0449/isolated/diag-dx10; rm -rf $O; mkdir -p $O
export PATH=/Users/ccheever/sb4-03-lanes/codesign-relay:/Users/ccheever/.elan/bin:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
cd $HOME/sb4-pub-0444-wt/snapback4
( for i in $(seq 1 400); do echo "== $(date +%T.%N 2>/dev/null || date +%T) $i"; ps -axo pid=,ppid=,pgid=,stat=,lstart=,command= | grep -E "dx10-|serve\.mjs|npm run|npm-cli|snapback4 serve|prod:serve|probe:serve" | grep -v grep | cut -c1-260; sleep 0.25; [ -e $O/stop ] && break; done ) > $O/ps.log 2>&1 &
S=$!
env -u SNAPBACK4_BIN SNAPBACK4_REQUIRE_LEAN=1 CARGO_INCREMENTAL=0 timeout 300 node --test --test-name-pattern="native store releases on npm death" packages/snapback4/test/dx10-process-accounts.test.mjs > $O/test.log 2>&1
echo "test rc=$?" >> $O/test.log; touch $O/stop; wait $S
grep -E "^# (pass|fail)|^not ok|^ok" $O/test.log | head -5
awk '/^== /{n++} END{print n" samples"}' $O/ps.log
echo diag-done
