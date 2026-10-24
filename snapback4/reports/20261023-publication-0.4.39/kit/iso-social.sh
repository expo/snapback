#!/bin/bash
# Flake rule step 1 on the Mac: social-starter.test.mjs alone (dry-run-2 red: after-hook rmSync ENOTEMPTY while the dev server's worker wrote its ledger), via the suite's runner, same tree the dry run built. Default TMPDIR.
O=$HOME/sb4-pub-0439/isolated/dr2; mkdir -p $O
export PATH=/Users/ccheever/.elan/bin:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
ulimit -n 65536
cd $HOME/projects/snapback-pub-0428/snapback4
# leftover from the dry-run-2 failure (the worker ledger written after the rm walk)
ls -d .social-test-* 2>/dev/null > $O/leftover.txt; for d in .social-test-*; do [ -d "$d" ] && rm -rf "$d"; done
for i in 1 2 3 4 5 6; do
  s=$(date +%s)
  env -u SNAPBACK4_BIN SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 timeout 1500 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/social-starter.test.mjs > $O/social-$i.log 2>&1
  echo "run $i rc=$? $(( $(date +%s)-s )) s load=$(sysctl -n vm.loadavg) $(grep -E '^-- client file|^-- client files:' $O/social-$i.log | tail -2 | tr '\n' ' ' | cut -c1-220) left=$(ls -d .social-test-* 2>/dev/null | wc -l)"
done
git status --porcelain; echo iso-done
