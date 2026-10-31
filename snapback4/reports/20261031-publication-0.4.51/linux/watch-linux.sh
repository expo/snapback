#!/bin/bash
# Exit when linux-$1 ends or its suite log shows a FAIL line. Prints the evidence.
A=${1:-1}; R=~/sb4-pub-0451-records; S=$R/linux-qualification-0.4.51/suite.log
while :; do
  [ -s $R/linux-$A.exit ] && { echo "exit=$(cat $R/linux-$A.exit)"; break; }
  grep -qE "^-- FAIL|client file FAIL|^not ok|# fail [1-9]" $S 2>/dev/null && { echo "FAIL seen"; break; }
  sleep 60
done
date -u +%T; grep -E "^-- (ok|FAIL)|^== [0-9]|FAIL" $S | tail -8 | cut -c1-250; tail -4 $R/disk.log
