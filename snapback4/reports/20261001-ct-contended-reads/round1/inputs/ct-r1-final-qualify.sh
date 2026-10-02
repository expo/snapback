#!/bin/bash
set -e
cd /home/ccheever/sb4-intent/lane-ct/snapback4
while [ ! -f reports/20261001-ct-contended-reads/round1/mixed-after/summary.json ]; do sleep 10; done
node -e "if(JSON.parse(require('node:fs').readFileSync('reports/20261001-ct-contended-reads/round1/mixed-after/summary.json')).length!==4)process.exit(1)"
while ! rg -q 'Finished .production.' /tmp/ct-r1-final-production.log; do sleep 10; done
cp target/production/snapback4 /tmp/ct-r1-final
node scripts/contended-reads.mjs --mixed --binary /tmp/ct-r1-final --out reports/20261001-ct-contended-reads/round1/mixed-restored > reports/20261001-ct-contended-reads/round1/mixed-restored.log 2>&1
node scripts/contended-reads.mjs --no-trace --work /tmp/ct-cal28 --binary /tmp/ct-r1-final --out reports/20261001-ct-contended-reads/round1/final-untraced > reports/20261001-ct-contended-reads/round1/final-untraced.log 2>&1
ulimit -n 4096
mkdir -p reports/20261001-ct-contended-reads/round1/qualification
# The complete suite runs once, only after all this lane's load processes stop.
set +e
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh > reports/20261001-ct-contended-reads/round1/qualification/test-sh.log 2>&1
status=$?
printf '%s\n' "$status" > reports/20261001-ct-contended-reads/round1/qualification/test-sh.exit
exit "$status"
