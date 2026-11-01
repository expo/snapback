#!/bin/bash
# usage: macpoll.sh <regex> [max-minutes]: wait until ~/sb4-pub-0452/${CHAINLOG:-chain-a1.log} on the Mac matches regex; prints the log tail.
RE=$1; MAX=${2:-60}
for i in $(seq 1 $((MAX*2))); do
  r=$(timeout 30 ssh -o BatchMode=yes -o ConnectTimeout=10 ccheever@charlies-macbook-pro-m5max-black "cat ~/sb4-pub-0452/${CHAINLOG:-chain-a1.log} 2>/dev/null" 2>/dev/null)
  printf '%s\n' "$r" | grep -qE "$RE" && { printf '%s\n' "$r" | tail -8; exit 0; }
  sleep 30
done
printf '%s\n' "${r:-unreachable}" | tail -5; exit 1
