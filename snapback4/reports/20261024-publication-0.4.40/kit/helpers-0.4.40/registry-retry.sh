#!/bin/bash
# Retry the read-only registry verification while npm's CDN catches up (0.4.30: tarball 404 for ~5 min after npm view showed the version). usage: registry-retry.sh cli|expo
for i in $(seq 1 40); do
  python3 /Users/ccheever/sb4-pub-0440/helpers-0.4.40/registry-verify.py "$1" && exit 0
  echo "$(date -u +%FT%TZ) registry verification $1 not yet passing (try $i); retrying in 30 s"; sleep 30
done
exit 1
