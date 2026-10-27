#!/bin/bash
# Wait until the black M5 answers ssh (up to $1 minutes, default 600); log to wait-mac.out.
MAX=${1:-600}
for i in $(seq 1 $((MAX*2))); do
  if timeout 25 ssh -o BatchMode=yes -o ConnectTimeout=10 ccheever@charlies-macbook-pro-m5max-black 'uptime' >/dev/null 2>&1; then echo "$(date -u +%T) reachable" >> ~/sb4-pub-0443-kit/wait-mac.out; exit 0; fi
  sleep 30
done
echo "$(date -u +%T) timeout" >> ~/sb4-pub-0443-kit/wait-mac.out; exit 1
