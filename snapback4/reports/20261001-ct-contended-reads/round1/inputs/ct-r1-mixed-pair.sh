#!/bin/bash
set -e
cd /home/ccheever/sb4-intent/lane-ct/snapback4
node scripts/contended-reads.mjs --mixed --binary /tmp/ct-before --out reports/20261001-ct-contended-reads/round1/mixed-before > reports/20261001-ct-contended-reads/round1/mixed-before.log 2>&1
node scripts/contended-reads.mjs --mixed --binary /tmp/ct-r1-pool-cpu --out reports/20261001-ct-contended-reads/round1/mixed-after > reports/20261001-ct-contended-reads/round1/mixed-after.log 2>&1
