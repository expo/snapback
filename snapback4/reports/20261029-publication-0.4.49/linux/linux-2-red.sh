#!/bin/bash
# linux-2 (9c77333f2d) client pool red only in maintained-column-adoption #4 (TEST_HANG device watch; the known flaky test,
# passed in linux-1 at the same product code). Flake rule: stop linux-2 (no receipt is possible), archive it, run the file alone
# x6 with the qualify environment, and only if 6/6 start linux-3 as the one full rerun on the same Mac-prepared a2 bytes.
R=~/sb4-pub-0449-records; K=~/sb4-pub-0449-kit; W=~/sb4-pub-0441; C=9c77333f2da4fb6eec5c9b3fb976ecdbc03e5265
log() { echo "- $(date -u +%FT%TZ) $*" >> $R/STATUS.md; }
systemctl --user stop sb4-pub49-linux-2 sb4-pub49-onpass-2 sb4-pub49-disklog-2 2>/dev/null; sleep 3
left=$(pgrep -af 'sb4-pub-0441/snapback4' | grep -v linux-2-red | head -3)
echo "killed-after-red-suite (maintained-column-adoption #4 TEST_HANG)" > $R/linux-2.exit
A=$R/archive-linux-2; mkdir -p $A
mv $R/linux-qualification-0.4.49 $R/attempt-2-linux-* $R/linux-2.exit $R/disk.log $A/ 2>/dev/null; rm -rf $R/npm-cache-2
find $W/snapback4 -maxdepth 4 -name ".rg-matrix-*" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null
log "linux-2 stopped after its red suite and archived to $A (leftover procs: [${left}]); tree [$(git -C $W status --porcelain | tr '\n' ' ')]"
O=$K/isolated/iso-mca; mkdir -p $O; cd $W/snapback4; pass=0
export PATH=$HOME/.elan/bin:$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
for i in 1 2 3 4 5 6; do s=$(date +%s)
  env -u SNAPBACK4_BIN -u SNAPBACK4_TEST_SERIAL_CLIENT_FILES -u SNAPBACK4_RUST_TEST_PROCESSES NPM_CONFIG_CACHE=$O/npm-cache SNAPBACK4_REQUIRE_LEAN=1 CARGO_INCREMENTAL=0 timeout 900 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/maintained-column-adoption.test.mjs > $O/run-$i.log 2>&1 < /dev/null
  rc=$?; [ $rc = 0 ] && pass=$((pass+1))
  echo "$(date -u +%FT%TZ) maintained-column-adoption run $i rc=$rc $(( $(date +%s)-s )) s load=$(cut -d' ' -f1 /proc/loadavg) $(grep -E '^-- client files:' $O/run-$i.log | cut -c1-110) $(grep -E '^not ok' $O/run-$i.log | cut -c1-80 | tr '\n' ' ')" >> $O/summary.txt
done
rm -rf $O/npm-cache; find $W/snapback4 -maxdepth 4 -name ".rg-matrix-*" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null
log "maintained-column-adoption alone (qualify env): $pass/6 passed (runs in $O/summary.txt); tree [$(git -C $W status --porcelain | tr '\n' ' ')]"
[ $pass = 6 ] || { log "STOP: not 6/6 alone; no Linux rerun until triaged"; exit 1; }
for i in $(seq 1 60); do free=$(df -BG --output=avail ~ | tail -1 | tr -dc 0-9); load=$(cut -d' ' -f1 /proc/loadavg | cut -d. -f1); [ "$free" -ge 40 ] && [ "$load" -lt 30 ] && break; sleep 60; done
log "flake (6/6 alone): starting the one full rerun, Linux qualify attempt 3 (free ${free}G, load $(cut -d' ' -f1-3 /proc/loadavg))"
$K/start-linux.sh 3 $C > $K/start-linux-3.out 2>&1; rc=$?
log "start-linux.sh 3 rc=$rc: $(grep -E 'free|HEAD|dirty|exists|no prepared' $K/start-linux-3.out | head -2 | tr '\n' ' ')"
