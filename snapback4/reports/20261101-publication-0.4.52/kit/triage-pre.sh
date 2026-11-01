#!/bin/bash
K=$HOME/sb4-pub-0452; cd "$K"
log() { echo "$(date -u +%FT%TZ) $*" >> "$K/triage-pre.log"; }
until grep -q 'pre-darwin rc=' "$K/resume-after-warm.log"; do sleep 30; done
rc=$(sed -n 's/.*pre-darwin rc=\([0-9]*\).*/\1/p' "$K/resume-after-warm.log" | tail -1)
[ "$rc" != 0 ] || { log 'pre green; no isolation needed'; exit 0; }
files=$(python3 - <<'PY'
from pathlib import Path
import re
s=(Path.home()/'sb4-pub-0452/isolated/pre/pre.log').read_text()
print(' '.join(re.findall(r'^-- client file FAIL: packages/snapback4/test/([^ /]+)\.test\.mjs',s,re.M)))
PY
)
[ -n "$files" ] || { log 'STOP: no failed files found'; echo stopped > triage-pre.exit; exit 1; }
log "isolation start: $files"
for f in $files; do
 [ ! -e "$K/isolated/iso-$f/summary.txt" ] || { log "STOP: isolation records already exist for $f"; echo stopped > triage-pre.exit; exit 1; }
 log "$f alone x6 start"
 bash ./iso-file.sh "$f" 6 >> "$K/triage-pre.out" 2>&1
 log "$(tail -1 "$K/isolated/iso-$f/summary.txt")"
done
log 'isolation complete; coordinator classification required before dry run'
echo done > triage-pre.exit
