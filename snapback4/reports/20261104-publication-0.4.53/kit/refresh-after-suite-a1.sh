#!/bin/bash
# Re-run the shared ~/.npm starter packument refresh (0.4.43 lesson) as soon as dry run 3's suite reports its summary, so the
# Darwin starters proof that follows the suite (after receipt validation and the Darwin stage) resolves fresh packuments.
K=$HOME/sb4-pub-0453; D=$HOME/sb4-pub-0453-wt/snapback4/reports/20261104-publication-0.4.53/attempt-1-publication-dry-run.log
until /usr/bin/grep -qE "^== [0-9]+ failure" $D 2>/dev/null; do [ -e $K/dry-run-1.exit ] && exit 0; sleep 60; done
echo "$(date -u +%FT%TZ) suite summary: $(/usr/bin/grep -E "^== [0-9]+ failure" $D | tail -1)" >> $K/refresh-after-suite-a1.log
/usr/bin/grep -qE "^== 0 failure" $D || { echo "$(date -u +%FT%TZ) suite red; no refresh" >> $K/refresh-after-suite-a1.log; exit 0; }
REFRESH_TAG=a1d bash $K/refresh-npm-cache-a1.sh > $K/refresh-npm-cache-a1d.out 2>&1
echo "$(date -u +%FT%TZ) refresh after suite: $(/usr/bin/grep -c "online-resolve rc=0 prefer-offline-resolve rc=0" $K/refresh-npm-cache-a1d.out)/6 ok" >> $K/refresh-after-suite-a1.log
