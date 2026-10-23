#!/bin/bash
# Poll a Mac kit exit marker, tolerating Tailscale drops. usage: poll.sh <exit-file-name> <log-relpath>
for i in $(seq 1 9); do
  r=$(timeout 30 ssh -o BatchMode=yes -o ConnectTimeout=10 ccheever@charlies-macbook-pro-m5max-black "cat ~/sb4-pub-0438/$1 2>/dev/null; grep -E '^-- (ok|FAIL)|^== [0-9]|client file FAIL' ~/projects/snapback-pub-0428/snapback4/$2 2>/dev/null | tail -3" 2>/dev/null)
  if printf '%s\n' "$r" | grep -qE "^(done|stopped)"; then printf '%s\n' "$r"; exit 0; fi
  sleep 55
done
printf '%s\n' "${r:-unreachable}"
