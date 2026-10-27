#!/bin/bash
# Flake rule step 1 on Linux: proof-contract.test.mjs alone x6 (linux-1 red: test 4 "DX6 composed RN text and wrapping labels
# preserve scope, exactness and ambiguity", proof-contract.test.mjs:83: waitForFresh(visible,'Visible composed',50) rejected with
# "no fresh signal after 50 ms ... last count=0, text=null; absent" instead of /present but unchanged/; Linux load 40-60),
# via the suite's runner, same tree linux-1 built. Default TMPDIR.
O=$HOME/sb4-pub-0443-kit/isolated/l1; mkdir -p $O
export PATH=$HOME/.elan/bin:$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
ulimit -n 65536
cd $HOME/sb4-pub-0441/snapback4
for i in 1 2 3 4 5 6; do
  s=$(date +%s)
  env -u SNAPBACK4_BIN NPM_CONFIG_CACHE=$HOME/sb4-pub-0443-records/npm-cache-iso timeout 1500 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/proof-contract.test.mjs > $O/pc-$i.log 2>&1
  echo "run $i rc=$? $(( $(date +%s)-s )) s load=$(cut -d' ' -f1-3 /proc/loadavg) $(grep -E '^-- client file|^-- client files:' $O/pc-$i.log | tail -2 | tr '\n' ' ' | cut -c1-240)"
done
git status --porcelain; echo iso-done
