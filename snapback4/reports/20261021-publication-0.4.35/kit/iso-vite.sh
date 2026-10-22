#!/bin/bash
# Flake-rule step 1 for social-quote-jump-browser (alone x6) + pair repro with socket sampling.
O=$HOME/sb4-pub-0435/isolated; mkdir -p $O
export PATH=/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
ulimit -n 65536
cd $HOME/projects/snapback-pub-0428/snapback4
for i in 1 2 3 4 5 6; do
  env -u SNAPBACK4_BIN SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 timeout 900 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/social-quote-jump-browser.test.mjs > $O/social-quote-jump-browser-$i.log 2>&1
  echo "alone $i rc=$? $(grep -E '^-- client files:' $O/social-quote-jump-browser-$i.log | cut -c1-140)"
done
sample() { while :; do n=$(netstat -an -p tcp 2>/dev/null); echo "$(date +%T) tw=$(echo "$n" | grep -c TIME_WAIT) est=$(echo "$n" | grep -c ESTABLISHED) listen=$(echo "$n" | grep -c LISTEN)"; sleep 2; done; }
for i in 1 2 3; do
  sample > $O/pair-sockets-$i.txt & sp=$!
  env -u SNAPBACK4_BIN SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 timeout 1200 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/social-browser.test.mjs packages/snapback4/test/social-quote-jump-browser.test.mjs > $O/pair-$i.log 2>&1; rc=$?
  kill $sp
  echo "pair $i rc=$rc $(grep -E '^-- client files:' $O/pair-$i.log | cut -c1-140) maxTW=$(sed 's/.*tw=\([0-9]*\).*/\1/' $O/pair-sockets-$i.txt | sort -n | tail -1) $(grep -c 'No available ephemeral port' $O/pair-$i.log) vite-port-errors"
done
git status --porcelain; uptime
