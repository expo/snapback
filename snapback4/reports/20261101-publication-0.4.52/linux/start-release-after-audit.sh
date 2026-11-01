#!/bin/bash
set -eu
K=$HOME/sb4-pub-0452-kit; R=$HOME/sb4-pub-0452-records
for i in $(seq 1 120); do
 rc=$(ssh -o BatchMode=yes -o ConnectTimeout=15 ccheever@charlies-macbook-pro-m5max-black 'cat ~/sb4-pub-0452/audit-mac-preflight.exit 2>/dev/null' || true)
 if [ -n "$rc" ]; then
  [ "$rc" = 0 ] || { python3 "$K/log-status.py" "Mac preliminary audit exited $rc; HOLD release checks pending diagnosis."; exit 1; }
  rsync -a ccheever@charlies-macbook-pro-m5max-black:sb4-pub-0452/isolated/audit-mac-preflight/ "$R/audit-mac-preflight/"
  python3 "$K/log-status.py" 'Mac preliminary audit PASS (web and Expo, zero findings). Both-host early audits green; starting mandatory release affected/inventory/ref checks in capped Linux unit. Native gate still independent.'
  bash "$K/release-checks.sh"
  exit $?
 fi
 sleep 15
done
exit 75
