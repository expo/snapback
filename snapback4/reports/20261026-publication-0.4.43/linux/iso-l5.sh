#!/bin/bash
# Flake rule step 1 on Linux for linux-5: online-journal-browser.test.mjs subtest 6 TEST_HANG (122 s guard). Alone x8 via the suite runner.
# before IndexedDB commit preserves the click": an extra earlier write id) and proof.test.mjs (tests 4 and 12: E_ADDRINUSE on the
# frontend port range / port 0). Each alone x6 via the suite runner, same tree. Default TMPDIR.
O=$HOME/sb4-pub-0443-kit/isolated/l5; mkdir -p $O
export PATH=$HOME/.elan/bin:$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
ulimit -n 65536
cd $HOME/sb4-pub-0441/snapback4
for f in online-journal-browser; do for i in 1 2 3 4 5 6 7 8; do
  s=$(date +%s)
  env -u SNAPBACK4_BIN NPM_CONFIG_CACHE=$HOME/sb4-pub-0443-records/npm-cache-iso timeout 1500 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/$f.test.mjs > $O/$f-$i.log 2>&1
  echo "$f run $i rc=$? $(( $(date +%s)-s )) s load=$(cut -d' ' -f1 /proc/loadavg) $(grep -E '^-- client files:' $O/$f-$i.log | tail -1 | cut -c1-160)"
done; done
git status --porcelain; echo iso-done
