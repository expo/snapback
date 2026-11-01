#!/bin/bash
# 0.4.52: wait for the Mac chain's prepare-1 (done) and its expo-prep-check (prepared Expo files == native qualified.json), pull the
# Mac-prepared client + Expo tarballs, compare sha256 on both sides, then start Linux qualify attempt 1 (start-linux.sh units) once
# free space >= 40 GB and the 1-min load is < 30 (waits up to 60 min for the load).
R=~/sb4-pub-0452-records; K=~/sb4-pub-0452-kit; M=ccheever@charlies-macbook-pro-m5max-black; C=693e02462c2b2d07308bffd9342966b4822fed7c
log() { echo "- $(date -u +%FT%TZ) $*" >> $R/STATUS.md; }
while :; do
  r=$(timeout 60 ssh -o BatchMode=yes -o ConnectTimeout=15 $M 'echo "prep=$(cat ~/sb4-pub-0452/prepare-1.exit 2>/dev/null) native=$(cat ~/sb4-pub-0452/native-1.exit 2>/dev/null)"; grep -h "expo-prep-check:\|FAILED\|chain exit" ~/sb4-pub-0452/chain-a1.log 2>/dev/null | tail -2' 2>/dev/null)
  case "$r" in *"native=stopped"*|*"prep=stopped"*|*"post-native FAILED"*) log "Mac chain stopped before a usable prepare: $(echo $r | tr '\n' ' ')"; exit 1;; esac
  echo "$r" | grep -q "expo-prep-check:" && break
  sleep 60
done
echo "$r" | grep -q "expo-prep-check: prepared expo files [0-9]* qualified [0-9]* equal True" || { log "STOP: Mac expo-prep-check not equal: $(echo $r | tr '\n' ' ')"; exit 1; }
log "Mac prepare-1 done; $(echo "$r" | grep -o 'expo-prep-check:.*')"
$K/pull-client.sh > $K/pull-client.out 2>&1
l=$(grep -E '^[0-9a-f]{64}  snapback4' $K/pull-client.out | head -2 | sort | tr '\n' ' '); m=$(grep -E '^[0-9a-f]{64}  snapback4' $K/pull-client.out | tail -2 | sort | tr '\n' ' ')
n=$(grep -cE '^[0-9a-f]{64}  snapback4' $K/pull-client.out)
[ "$n" = 4 ] && [ "$l" = "$m" ] || { log "STOP: prepared tarball transfer mismatch (n=$n): linux [$l] mac [$m]"; exit 1; }
log "prepared tarballs pulled to the Linux worktree, sha256 equal on both hosts: $l"
for i in $(seq 1 60); do
  free=$(df -BG --output=avail ~ | tail -1 | tr -dc 0-9); load=$(cut -d' ' -f1 /proc/loadavg | cut -d. -f1)
  [ "$free" -ge 40 ] && [ "$load" -lt 30 ] && break; sleep 60
done
log "starting Linux qualify attempt 1 (free ${free}G, load $(cut -d' ' -f1-3 /proc/loadavg))"
$K/start-linux.sh 1 $C > $K/start-linux-1.out 2>&1; rc=$?
log "start-linux.sh 1 rc=$rc: $(grep -E 'free|HEAD|dirty|exists|no prepared' $K/start-linux-1.out | head -2 | tr '\n' ' ')"
