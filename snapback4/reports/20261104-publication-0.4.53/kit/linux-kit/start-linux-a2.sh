#!/bin/bash
# Same transient service isolation and memory bounds as the prior release kit.
set -euo pipefail
C=${1:?expected frozen source}
B=$HOME/sb4-intent/0453
[ "$(git -C "$B/source" rev-parse HEAD)" = "$C" ]
[ -z "$(git -C "$B/source" status --porcelain)" ]
[ ! -e "$B/records/run-2.exit" ] && [ ! -e "$B/kit/linux-2.out" ]
[ -s "$B/source/snapback4/target/publication/client-0.4.53/prepare.json" ]
[ -s "$B/records/wave21-environment-check.json" ]
[ -d "$B/archives/linux-attempt-1" ]
echo "free $(df -BG --output=avail "$B" | tail -1 | tr -d ' ') load $(cut -d' ' -f1-3 /proc/loadavg)"
systemd-run --user --unit=sb4-pub53-linux-2 --collect \
 -p OOMPolicy=continue -p MemoryMax=80G -p MemorySwapMax=2G \
 -p StandardOutput="append:$B/kit/linux-2.out" -p StandardError=inherit \
 --working-directory="$B/kit" /bin/bash "$B/kit/run-all-a2.sh" "$C"
