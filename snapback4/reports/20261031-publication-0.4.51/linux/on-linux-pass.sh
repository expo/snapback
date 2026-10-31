#!/bin/bash
# usage: on-linux-pass.sh <attempt>: wait for linux-<attempt>.exit; on 0 with a receipt, write LINUX-QUALIFY-PASSED to STATUS.md and xfer to the Mac.
A=${1:?}; R=~/sb4-pub-0451-records; Q=$R/linux-qualification-0.4.51
while [ ! -s $R/linux-$A.exit ]; do sleep 30; done
e=$(cat $R/linux-$A.exit)
if [ "$e" = 0 ] && [ -s $Q/receipt.json ]; then
  echo "- LINUX-QUALIFY-PASSED $(date -u +%FT%TZ) (linux-$A at $(git -C ~/sb4-pub-0441 rev-parse --short=10 HEAD); receipt sha256 $(sha256sum $Q/receipt.json | cut -c1-16)..., linux tgz $(sha256sum $Q/snapback4-linux-x64-0.4.51.tgz | cut -c1-16)...)" >> $R/STATUS.md
  ~/sb4-pub-0451-kit/xfer.sh > ~/sb4-pub-0451-kit/xfer-$A.out 2>&1
  echo "- $(date -u +%FT%TZ) receipt transferred to Mac target/incoming/linux-0.4.51: $(tail -1 ~/sb4-pub-0451-kit/xfer-$A.out)" >> $R/STATUS.md
else echo "linux-$A exit=$e (no pass)"; fi
