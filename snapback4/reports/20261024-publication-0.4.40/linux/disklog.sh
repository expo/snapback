#!/bin/bash
# Log Linux free space + load every 120 s while linux-1 runs.
while [ ! -s ~/sb4-pub-0440-records/linux-${1:-1}.exit ]; do echo "$(date -u +%T) $(df -BG --output=avail ~ | tail -1) $(cut -d' ' -f1-3 /proc/loadavg) target=$(du -sBG ~/sb4-pub-0440/snapback4/target 2>/dev/null | cut -f1)" >> ~/sb4-pub-0440-records/disk.log; sleep 120; done
