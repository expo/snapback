#!/bin/bash
# Polls the Mac gate every 4 min. Logs to watch-gate.out; writes watch-gate.result and exits on: gate finished/refused/MAXATT, or a "-- FAIL" line in the current attempt log.
O=~/sb4-pub-0437-kit/watch-gate.out
for i in $(seq 1 300); do
  r=$(timeout 60 ssh -o BatchMode=yes -o ConnectTimeout=15 ccheever@charlies-macbook-pro-m5max-black 'K=~/sb4-pub-0437; tail -1 $K/gate.log; a=$(ls -t $K/dryrun-a*.log 2>/dev/null | head -1 | sed "s/.*dryrun-a\([0-9]*\).log/\1/"); echo "att=$a"; { grep -E "^-- (ok|FAIL)" ~/projects/snapback-pub-0428/snapback4/reports/20261022-publication-0.4.37/attempt-$a-publication-dry-run.log 2>/dev/null | tail -1; grep -E "^-- FAIL|^== [0-9]" ~/projects/snapback-pub-0428/snapback4/reports/20261022-publication-0.4.37/attempt-$a-publication-dry-run.log 2>/dev/null; }; ls $K/*.env-invalid 2>/dev/null' 2>/dev/null)
  echo "$(date -u +%T) $(echo "${r:-unreachable}" | tr '\n' ' ')" >> $O
  if printf '%s\n' "$r" | grep -qE "finished:|REFUSE|MAXATT|-- FAIL|already exists"; then printf '%s\n' "$r" > ~/sb4-pub-0437-kit/watch-gate.result; exit 0; fi
  sleep 240
done
echo timeout > ~/sb4-pub-0437-kit/watch-gate.result
