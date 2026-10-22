#!/bin/bash
# Resumable transfer of the Linux receipt and tarball to the Mac over a flaky link.
R=/home/ccheever/sb4-pub-0437-records/linux-qualification-0.4.37; M=ccheever@charlies-macbook-pro-m5max-black
for i in $(seq 1 120); do
  if timeout 300 rsync -a --partial --timeout=60 -e "ssh -o BatchMode=yes -o ConnectTimeout=15" --rsync-path=/usr/bin/rsync $R/receipt.json $R/snapback4-linux-x64-0.4.37.tgz $M:projects/snapback-pub-0428/snapback4/target/incoming/linux-0.4.37/ 2>/dev/null; then
    h=$(timeout 60 ssh -o BatchMode=yes -o ConnectTimeout=15 $M 'cd ~/projects/snapback-pub-0428/snapback4 && shasum -a 256 target/incoming/linux-0.4.37/receipt.json target/incoming/linux-0.4.37/*.tgz | awk "{print \$1}" | tr "\n" " "')
    echo "$(date -u +%T) transferred: $h"; exit 0
  fi
  echo "$(date -u +%T) retry $i"; sleep 30
done
exit 1
