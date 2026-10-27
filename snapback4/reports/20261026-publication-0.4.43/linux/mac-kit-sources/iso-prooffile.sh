#!/bin/bash
# Diagnostic: whole proof.test.mjs via node --test (no suite runner), x4, 150 s cap; dry run 3 ran the file in 20.7 s.
export PATH=/Users/ccheever/.elan/bin:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
ulimit -n 65536; O=$HOME/sb4-pub-0443/isolated/dr5; cd $HOME/projects/snapback-pub-0428/snapback4
for i in 1 2 3 4; do s=$(date +%s)
  timeout 150 node --test packages/snapback4/test/proof.test.mjs > $O/pfile-$i.log 2>&1; rc=$?
  echo "run $i rc=$rc $(( $(date +%s)-s )) s load=$(sysctl -n vm.loadavg) $(grep -E '^ℹ (pass|fail) ' $O/pfile-$i.log | tr '\n' ' ') $(grep -E '^✖ ' $O/pfile-$i.log | head -3 | tr '\n' ' ' | cut -c1-200)"
  pkill -f "hold[.]mjs" 2>/dev/null
done
git status --porcelain | head -3; echo pfile-done
