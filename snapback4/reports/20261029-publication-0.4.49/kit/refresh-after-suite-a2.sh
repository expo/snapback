#!/bin/bash
# Re-run the shared ~/.npm starter packument refresh (0.4.43 lesson) as soon as dry run 2's suite reports its summary, so the
# Darwin starters proof that follows the suite (after receipt validation and the Darwin stage) resolves fresh packuments.
K=$HOME/sb4-pub-0449; D=$HOME/sb4-pub-0444-wt/snapback4/reports/20261029-publication-0.4.49/attempt-2-publication-dry-run.log
until grep -qE "^== [0-9]+ failure" $D 2>/dev/null; do [ -e $K/dry-run-2.exit ] && exit 0; sleep 60; done
echo "$(date -u +%FT%TZ) suite summary: $(grep -E "^== [0-9]+ failure" $D | tail -1)" >> $K/refresh-after-suite-a2.log
grep -qE "^== 0 failure" $D || { echo "$(date -u +%FT%TZ) suite red; no refresh" >> $K/refresh-after-suite-a2.log; exit 0; }
REFRESH_TAG=a3c bash $K/refresh-npm-cache-a1.sh > $K/refresh-npm-cache-a3c.out 2>&1
echo "$(date -u +%FT%TZ) refresh after suite: $(grep -c "online-resolve rc=0 prefer-offline-resolve rc=0" $K/refresh-npm-cache-a3c.out)/6 ok" >> $K/refresh-after-suite-a2.log
