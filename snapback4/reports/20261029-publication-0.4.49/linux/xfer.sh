#!/bin/bash
# Resumable transfer of the Linux receipt and tarball to the Mac over a flaky link.
R=/home/ccheever/sb4-pub-0449-records/linux-qualification-0.4.49; M=ccheever@charlies-macbook-pro-m5max-black
for i in $(seq 1 120); do
  if timeout 300 rsync -a --partial --timeout=60 -e "ssh -o BatchMode=yes -o ConnectTimeout=15" --rsync-path=/usr/bin/rsync $R/receipt.json $R/snapback4-linux-x64-0.4.49.tgz $M:sb4-pub-0444-wt/snapback4/target/incoming/linux-0.4.49/ 2>/dev/null; then
    h=$(timeout 60 ssh -o BatchMode=yes -o ConnectTimeout=15 $M 'cd ~/sb4-pub-0444-wt/snapback4 && shasum -a 256 target/incoming/linux-0.4.49/receipt.json target/incoming/linux-0.4.49/*.tgz | awk "{print \$1}" | tr "\n" " "')
    echo "$(date -u +%T) transferred: $h"; exit 0
  fi
  echo "$(date -u +%T) retry $i"; sleep 30
done
exit 1
