#!/bin/bash
# Flake rule step 1 on the Mac: routes.test.mjs alone, via the suite's runner, same tree the dry run built.
O=$HOME/sb4-pub-0437/isolated; mkdir -p $O
export PATH=/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
ulimit -n 65536
cd $HOME/projects/snapback-pub-0428/snapback4
uptime > $O/routes-load.txt
for i in 1 2 3 4 5 6; do
  env -u SNAPBACK4_BIN SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 timeout 900 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/routes.test.mjs > $O/routes-$i.log 2>&1
  echo "run $i rc=$? $(grep -E '^-- client files:' $O/routes-$i.log | cut -c1-160)"
done
git status --porcelain
