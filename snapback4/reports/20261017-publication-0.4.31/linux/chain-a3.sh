#!/bin/bash
# Waits for the Mac, transfers the Linux attempt-3 receipt + tarball, verifies Mac-side hashes, then starts Mac dry run attempt 3 via the AC/lid gate. Log: chain-a3.out
M=ccheever@charlies-macbook-pro-m5max-black; R=/home/ccheever/sb4-pub-0431-records/linux-qualification-0.4.31
want="$(sha256sum $R/receipt.json $R/snapback4-linux-x64-0.4.31.tgz | awk '{print $1}' | tr '\n' ' ')"
for i in $(seq 1 1440); do
  timeout 30 ssh -o BatchMode=yes -o ConnectTimeout=15 $M true 2>/dev/null && break
  [ $((i % 10)) = 1 ] && echo "$(date -u +%T) mac unreachable"; sleep 60
done
echo "$(date -u +%T) mac reachable"
for i in $(seq 1 200); do
  if timeout 300 rsync -a --partial --timeout=60 -e "ssh -o BatchMode=yes -o ConnectTimeout=15" --rsync-path=/usr/bin/rsync $R/receipt.json $R/snapback4-linux-x64-0.4.31.tgz $M:projects/snapback-pub-0428/snapback4/target/incoming/linux-0.4.31/ 2>/dev/null; then
    got=$(timeout 60 ssh -o BatchMode=yes -o ConnectTimeout=15 $M 'cd ~/projects/snapback-pub-0428/snapback4 && shasum -a 256 target/incoming/linux-0.4.31/receipt.json target/incoming/linux-0.4.31/snapback4-linux-x64-0.4.31.tgz | awk "{print \$1}" | tr "\n" " "')
    [ -n "$got" ] && break
  fi
  echo "$(date -u +%T) xfer retry $i"; sleep 30
done
echo "$(date -u +%T) mac hashes: $got"
[ "$got" = "$want" ] || { echo "HASH MISMATCH want=$want"; exit 1; }
for i in $(seq 1 100); do
  out=$(timeout 60 ssh -o BatchMode=yes -o ConnectTimeout=15 $M 'cd ~/projects/snapback-pub-0428/snapback4 && [ "$(git rev-parse HEAD)" = ccb9f752d198adb392e0b9def727de3a0ee17450 ] && [ -z "$(git status --porcelain)" ] && cd ~/sb4-pub-0431 && [ ! -e dry-run-3.exit ] && ! pgrep -f gate-dryrun.sh >/dev/null && { ATT=3 nohup bash ./gate-dryrun.sh > gate-runner-3.log 2>&1 < /dev/null & sleep 3; echo started; tail -2 gate-3.log; }' 2>&1)
  if printf '%s' "$out" | grep -q started; then echo "$(date -u +%T) gate started: $out"; exit 0; fi
  echo "$(date -u +%T) gate start failed: $out"; sleep 60
done
exit 1
