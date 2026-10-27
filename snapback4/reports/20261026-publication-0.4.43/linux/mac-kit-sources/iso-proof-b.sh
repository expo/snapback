#!/bin/bash
# Second batch (runs 7-10) through the suite runner with a 150 s cap (rc=124 = hang; the passing file takes ~21 s).
# Flake rule step 1 on the Mac: proof.test.mjs alone x6 (dry-run-5 red: test 25 "proof command cleanup owns npm descendants and caller death": process tree npm-pids.json cleanup timed out after 5000 ms; file 928,852 ms; known from the Integration 25 report). Was: (dry-run-2 red: test 11 "an active production signup deadline
# never recommends discarding production", identity-rate.test.mjs:88 calls 0 !== 1; 10 ms timeoutMs), via the suite's runner,
# same tree the dry run built. Default TMPDIR.
O=$HOME/sb4-pub-0443/isolated/dr5; mkdir -p $O
export PATH=/Users/ccheever/.elan/bin:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
ulimit -n 65536
cd $HOME/projects/snapback-pub-0428/snapback4
for i in 7 8 9 10; do
  s=$(date +%s)
  env -u SNAPBACK4_BIN SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 timeout 150 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/proof.test.mjs > $O/proof-$i.log 2>&1
  echo "run $i rc=$? $(( $(date +%s)-s )) s load=$(sysctl -n vm.loadavg) $(grep -E '^-- client file|^-- client files:' $O/proof-$i.log | tail -2 | tr '\n' ' ' | cut -c1-220)"
done
git status --porcelain; echo iso-done
