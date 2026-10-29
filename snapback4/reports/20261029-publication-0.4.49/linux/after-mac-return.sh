#!/bin/bash
# The M5 dropped off Tailscale right after the verified publication: wait for it, clean the Mac kit of installed packages and
# downloaded tarballs, then pull the Mac kit + both report dirs (pull-mac-records.sh) for the records commit.
R=~/sb4-pub-0449-records; K=~/sb4-pub-0449-kit; M=ccheever@charlies-macbook-pro-m5max-black
log() { echo "- $(date -u +%FT%TZ) $*" >> $R/STATUS.md; }
until timeout 20 ssh -o BatchMode=yes -o ConnectTimeout=15 $M true 2>/dev/null; do sleep 30; done
log "M5 reachable again; cleaning the Mac kit and pulling the records"
timeout 180 ssh -o BatchMode=yes -o ConnectTimeout=15 $M 'cd ~/sb4-pub-0449 && rm -rf clean-install/node_modules isolated/registry-tgz/*.tgz; find . -type d \( -name node_modules -o -name npm-cache \) -prune -exec rm -rf {} + 2>/dev/null; du -sh .' > $K/mac-clean.out 2>&1
$K/pull-mac-records.sh > $K/pull-mac-records.out 2>&1; rc=$?
log "pull-mac-records rc=$rc: $(tail -4 $K/pull-mac-records.out | tr '\n' ' ')"
echo $rc > $K/pull-mac-records.exit
