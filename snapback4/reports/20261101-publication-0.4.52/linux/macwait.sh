#!/bin/bash
# usage: macwait.sh <file-on-mac relative to ~/sb4-pub-0452> <regex> [max-minutes]: poll until it matches; print tail.
F=$1; RE=$2; MAX=${3:-240}
for i in $(seq 1 $((MAX*2))); do
  r=$(timeout 30 ssh -o BatchMode=yes -o ConnectTimeout=10 ccheever@charlies-macbook-pro-m5max-black "cat ~/sb4-pub-0452/$F 2>/dev/null" 2>/dev/null)
  printf '%s\n' "$r" | grep -qE "$RE" && { printf '%s\n' "$r" | tail -6; exit 0; }
  sleep 30
done
printf '%s\n' "${r:-unreachable}" | tail -4; exit 1
