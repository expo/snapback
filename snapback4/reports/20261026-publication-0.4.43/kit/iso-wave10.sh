#!/bin/bash
# Flake rule step 1 on the Mac: wave10-upgrade.test.mjs alone x3 via the suite runner (dry-run-1 red at f032742ac8: tests 2,4,5,7,9,
# the human-output upgrade cases, miss /Ops\.roomCount\.result: number → number \| null/ after the long 0.4.24→0.4.43 runtime
# changelog; Linux passes 14/14). Default TMPDIR. Also measures the size of the new CLI's `check` output the fake relay forwards.
O=$HOME/sb4-pub-0443/isolated/dr1; mkdir -p $O
export PATH=/Users/ccheever/.elan/bin:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
ulimit -n 65536
cd $HOME/projects/snapback-pub-0428/snapback4
for i in 1 2 3; do
  s=$(date +%s)
  env -u SNAPBACK4_BIN SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 timeout 1500 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/wave10-upgrade.test.mjs > $O/wave10-$i.log 2>&1
  echo "run $i rc=$? $(( $(date +%s)-s )) s load=$(sysctl -n vm.loadavg) $(grep -E '^not ok' $O/wave10-$i.log | cut -c1-60 | tr '\n' ';') $(grep -E '^-- client files:' $O/wave10-$i.log | tail -1 | cut -c1-160)"
done
git status --porcelain; echo iso-done
