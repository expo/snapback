#!/bin/bash
# dx10-process-accounts alone x3 in the wfix worktree (node 24.13.1, the Linux suite's node) with the test 8 fixture fix.
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
O=~/sb4-pub-0449-kit/isolated/wfix; cd ~/sb4-pub-0449-kit/wfix/snapback4
for i in 1 2 3; do s=$(date +%s); env -u SNAPBACK4_BIN timeout 900 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/dx10-process-accounts.test.mjs > $O/dx10-$i.log 2>&1 < /dev/null
  echo "dx10 alone #$i rc=$? $(( $(date +%s)-s )) s $(grep -E '^-- client files:' $O/dx10-$i.log | tail -1 | cut -c1-120) $(grep -E '^not ok' $O/dx10-$i.log | cut -c1-90 | tr '\n' ' ')"; done
echo dx10-done
