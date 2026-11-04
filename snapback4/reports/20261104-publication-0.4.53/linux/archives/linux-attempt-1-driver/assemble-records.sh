#!/bin/bash
# Pre-publication evidence snapshot; raw attempts remain untouched; no commit or upload.
set -euo pipefail
B=$HOME/sb4-intent/0453
D=$B/record-snapshot
[ ! -e "$D" ] || { echo "record snapshot exists"; exit 98; }
mkdir -p "$D"
rsync -a --no-links --exclude=node_modules --exclude=npm-cache --exclude='npm-cache-*' --exclude=.npm --exclude=.npmrc --exclude='.env*' --exclude='*.tgz' --exclude='*.mp4' "$B/linux-qualification-0.4.53/" "$D/qualification/"
rsync -a --no-links --exclude='npm-cache-*' --exclude='*.tgz' "$B/records/" "$D/records/"
rsync -a --no-links "$B/kit/" "$D/kit/"
find "$D" -type f -name '*.log' -size +200k -exec gzip -9 {} \;
echo 'ASSEMBLE RECORDS: retained pre-publication snapshot (original logs unchanged)'
