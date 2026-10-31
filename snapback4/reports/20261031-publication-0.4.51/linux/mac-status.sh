#!/bin/bash
ssh -o BatchMode=yes -o ConnectTimeout=15 ccheever@charlies-macbook-pro-m5max-black 'bash -s' <<'REMOTE'
K=$HOME/sb4-pub-0451; W=$HOME/sb4-pub-0444-wt/snapback4
for f in chain-a1.log chain-pre-a1.log gate.log native-continue-a1.log prepare-a1.log; do if [ -e "$K/$f" ]; then echo "$f: $(tail -2 "$K/$f" | tr '\n' ' ')"; fi; done
for f in "$K"/dry-run-*.exit "$K"/finish-*.exit; do [ ! -e "$f" ] || echo "$(basename "$f"): $(cat "$f")"; done
for f in "$W"/reports/20261031-publication-0.4.51/attempt-*-publication-dry-run.log; do [ ! -e "$f" ] || { echo "$(basename "$f"): $(tail -3 "$f" | cut -c1-180 | tr '\n' ' ')"; }; done
df -h "$HOME" | tail -1; uptime
REMOTE
