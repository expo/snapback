#!/bin/bash
# Read-only Darwin diagnosis of dx10-process-accounts test 8 through the suite runner (dry-run env): sample the process rows of
# npm / sh / the serve.mjs driver / proof-command.js wrapper / native serve every 200 ms while the file runs.
O=$HOME/sb4-pub-0449/isolated/diag-dx10b; rm -rf $O; mkdir -p $O
export PATH=/Users/ccheever/sb4-03-lanes/codesign-relay:/Users/ccheever/.elan/bin:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
ulimit -n 65536
cd $HOME/sb4-pub-0444-wt/snapback4
( while [ ! -e $O/stop ]; do echo "== $(perl -MTime::HiRes=time -e 'printf "%.2f", time')"; ps -axo pid=,ppid=,pgid=,stat=,command= | awk '/dx10-|serve\.mjs|npm run|npm-cli|proof-command|snapback4 serve|prod:serve/ && !/awk|grep|ps -axo/' | cut -c1-220; sleep 0.2; done ) > $O/ps.log 2>&1 &
S=$!
env -u SNAPBACK4_BIN -u SNAPBACK4_RUST_TEST_PROCESSES SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 SNAPBACK4_REQUIRE_LEAN=1 CARGO_INCREMENTAL=0 SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33 timeout 600 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/dx10-process-accounts.test.mjs > $O/run.log 2>&1
echo "run rc=$?" >> $O/run.log; touch $O/stop; wait $S
grep -E "^not ok|^-- client files:" $O/run.log | cut -c1-160; grep -c "^== " $O/ps.log; ls -la $O/ps.log | awk '{print $5}'
git -C $HOME/sb4-pub-0444-wt status --porcelain | head -3; echo diag-done
