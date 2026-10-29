#!/bin/bash
# Copy the Mac-prepared client + Expo tarballs (and prepare.json) to the Linux worktree; compare sha256 both sides.
M=ccheever@charlies-macbook-pro-m5max-black; S=sb4-pub-0444-wt/snapback4/target/publication/client-0.4.49/; D=/home/ccheever/sb4-pub-0441/snapback4/target/publication/client-0.4.49/
[ -e $D ] && { echo "exists: $D"; exit 1; }
mkdir -p $D
for i in $(seq 1 40); do
  timeout 300 rsync -a --partial --timeout=60 -e "ssh -o BatchMode=yes -o ConnectTimeout=15" --rsync-path=/usr/bin/rsync $M:$S $D && break
  echo "retry $i"; sleep 20
done
(cd $D && sha256sum *.tgz)
timeout 60 ssh -o BatchMode=yes $M "cd ~/$S && shasum -a 256 *.tgz"
