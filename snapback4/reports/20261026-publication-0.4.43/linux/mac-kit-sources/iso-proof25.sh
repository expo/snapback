#!/bin/bash
# Diagnostic: proof.test.mjs test 25 only ("proof command cleanup owns npm descendants and caller death"), x3, with a 120 s cap,
# sampling the npm/hold process tree 3 s into each run. Default TMPDIR; same tree as the dry run.
export PATH=/Users/ccheever/.elan/bin:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
O=$HOME/sb4-pub-0443/isolated/dr5; cd $HOME/projects/snapback-pub-0428/snapback4
for i in 1 2 3; do
  ( timeout 120 node --test --test-name-pattern "proof command cleanup owns npm descendants" packages/snapback4/test/proof.test.mjs > $O/p25-$i.log 2>&1; echo "rc=$?" >> $O/p25-$i.log ) &
  sleep 3; echo "run $i tree@3s:"; ps -axo pid,ppid,pgid,stat,etime,command | grep -E "hold\.mjs|npm run --silent hold|setInterval\(\(\)=>\{\},1000\)" | grep -v grep | cut -c1-160
  wait; echo "run $i $(grep -E '^# (pass|fail)|^rc=|error:' $O/p25-$i.log | tr '\n' ' ' | cut -c1-250)"
done
ps -axo pid,ppid,stat,etime,command | grep -E "hold\.mjs" | grep -v grep | cut -c1-160; git status --porcelain | head -3; echo p25-done
