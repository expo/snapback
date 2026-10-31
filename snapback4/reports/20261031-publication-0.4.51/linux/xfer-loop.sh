#!/bin/bash
# Re-run xfer.sh until it succeeds (the M5 is away; xfer.sh alone gives up after 120 tries). Logs to xfer-loop.out.
for i in $(seq 1 200); do
  if ~/sb4-pub-0451-kit/xfer.sh > ~/sb4-pub-0451-kit/xfer-try.out 2>&1; then echo "$(date -u +%T) $(tail -1 ~/sb4-pub-0451-kit/xfer-try.out)"; exit 0; fi
  echo "$(date -u +%T) xfer round $i failed"; sleep 60
done
exit 1
