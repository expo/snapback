#!/bin/bash
# Flake rule step 1 on Linux: social-quote-jump-browser.test.mjs alone (linux-1 red: online "absent original says unavailable and
# cannot move the list", line 315: history scrollTop 16 !== 0 after clicking the unavailable text; open ticket
# issues/20261013-snapback4-quote-jump-visible-position-flake.md), via the suite's runner, same tree linux-1 built. Default TMPDIR.
O=$HOME/sb4-pub-0443-kit/isolated/l1; mkdir -p $O
export PATH=$HOME/.elan/bin:$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
ulimit -n 65536
cd $HOME/sb4-pub-0441/snapback4
for i in 1 2 3 4 5 6; do
  s=$(date +%s)
  env -u SNAPBACK4_BIN NPM_CONFIG_CACHE=$HOME/sb4-pub-0443-records/npm-cache-iso timeout 1500 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/social-quote-jump-browser.test.mjs > $O/quote-$i.log 2>&1
  echo "run $i rc=$? $(( $(date +%s)-s )) s load=$(cut -d' ' -f1-3 /proc/loadavg) $(grep -E '^-- client file|^-- client files:' $O/quote-$i.log | tail -2 | tr '\n' ' ' | cut -c1-240)"
done
git status --porcelain; echo iso-done
