#!/bin/bash
# usage: waitfile.sh <mac-path-relative-to-home> [max-minutes]  -- waits until the Mac file exists, tolerating drops; prints it.
F=$1; MAX=${2:-120}
for i in $(seq 1 $((MAX*2))); do
  r=$(timeout 30 ssh -o BatchMode=yes -o ConnectTimeout=10 ccheever@charlies-macbook-pro-m5max-black "cat ~/$F 2>/dev/null" 2>/dev/null)
  [ -n "$r" ] && { echo "$r"; exit 0; }
  sleep 30
done
echo "timeout waiting for $F"; exit 1
