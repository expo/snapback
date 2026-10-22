#!/bin/bash
# Flake rule step 1 on Linux (attempt 1 at ee5a053303): wave12-clauses alone x6, via the suite's runner, same tree/binary the suite built.
# Then wave14-rule-recipes alone x2, recording whether it leaves packages/snapback4/logs/ (untracked) behind.
O=/home/ccheever/sb4-pub-0437-records/attempt-1-ee5a053303-linux/isolated; mkdir -p $O
export PATH=$HOME/.elan/bin:$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin NPM_CONFIG_CACHE=/home/ccheever/sb4-pub-0437-records/npm-cache-1
ulimit -n 65536
cd /home/ccheever/sb4-pub-0437/snapback4
uptime > $O/load.txt
for i in 1 2 3 4 5 6; do
  env -u SNAPBACK4_BIN timeout 900 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/wave12-clauses.test.mjs > $O/wave12-clauses-$i.log 2>&1
  echo "wave12 run $i rc=$? $(grep -E '^-- client files:' $O/wave12-clauses-$i.log | cut -c1-160)"
done
echo "status after wave12: [$(git status --porcelain | tr '\n' ' ')]"
for i in 1 2; do
  env -u SNAPBACK4_BIN timeout 900 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/wave14-rule-recipes.test.mjs > $O/wave14-rule-recipes-$i.log 2>&1
  echo "wave14 run $i rc=$? $(grep -E '^-- client files:' $O/wave14-rule-recipes-$i.log | cut -c1-160) status=[$(git status --porcelain | tr '\n' ' ')]"
  [ -d packages/snapback4/logs ] && { ls packages/snapback4/logs | head -3 > $O/wave14-logs-$i.txt; mv packages/snapback4/logs $O/wave14-stray-logs-$i; }
done
echo "final status: [$(git status --porcelain | tr '\n' ' ')]"
uptime >> $O/load.txt
