#!/bin/bash
# 0.4.49 attempt 2 (9c77333f2d): wait for linux-1 (55a4d4e39c, evidence only) to end, archive it, move the Linux worktree's
# client-0.4.49 aside and check out C; then wait for the Mac chain's prepare-2 + expo-prep-check, pull the Mac-prepared bytes,
# compare sha256 on both hosts, and start Linux qualify attempt 2 (free >= 40 GB, 1-min load < 30, waits up to 60 min).
R=~/sb4-pub-0449-records; K=~/sb4-pub-0449-kit; M=ccheever@charlies-macbook-pro-m5max-black; C=9c77333f2da4fb6eec5c9b3fb976ecdbc03e5265
W=~/sb4-pub-0441; log() { echo "- $(date -u +%FT%TZ) $*" >> $R/STATUS.md; }
while systemctl --user is-active -q sb4-pub49-linux-1; do sleep 30; done
systemctl --user stop sb4-pub49-disklog-1 2>/dev/null
log "linux-1 (55a4d4e39c, Mac-prepared a1 bytes) ended: exit=$(cat $R/linux-1.exit 2>/dev/null); receipt=$([ -s $R/linux-qualification-0.4.49/receipt.json ] && echo yes || echo no) (evidence only; superseded by 9c77333f2d)"
A=$R/archive-linux-1; mkdir -p $A
mv $R/linux-qualification-0.4.49 $R/attempt-1-linux-* $R/linux-1.exit $R/disk.log $A/ 2>/dev/null
rm -rf $A/linux-qualification-0.4.49/npm-cache* $R/npm-cache-1
mv $W/snapback4/target/publication/client-0.4.49 $W/snapback4/target/publication/client-0.4.49-a1-55a4d4e39c
[ -z "$(git -C $W status --porcelain)" ] || { log "STOP: Linux worktree dirty after linux-1: $(git -C $W status --porcelain | head -3 | tr '\n' ' ')"; exit 1; }
git -C $W checkout -q --detach $C || { log "STOP: Linux checkout of $C failed"; exit 1; }
[ "$(git -C $W rev-parse HEAD)" = "$C" ] && [ -z "$(git -C $W status --porcelain)" ] || { log "STOP: Linux worktree not clean at C"; exit 1; }
log "linux-1 archived to $A; Linux worktree at ${C:0:10}, clean"
while :; do
  r=$(timeout 60 ssh -o BatchMode=yes -o ConnectTimeout=15 $M 'echo "prep=$(cat ~/sb4-pub-0449/prepare-2.exit 2>/dev/null) native=$(cat ~/sb4-pub-0449/native-2.exit 2>/dev/null)"; grep -h "expo-prep-check:\|FAILED\|chain exit" ~/sb4-pub-0449/chain-a2.log 2>/dev/null | tail -2' 2>/dev/null)
  case "$r" in *"native=stopped"*|*"prep=stopped"*|*"post-native FAILED"*) log "Mac chain-a2 stopped before a usable prepare: $(echo $r | tr '\n' ' ')"; exit 1;; esac
  echo "$r" | grep -q "expo-prep-check:" && break
  sleep 60
done
echo "$r" | grep -q "expo-prep-check: prepared expo files [0-9]* qualified [0-9]* equal True" || { log "STOP: Mac expo-prep-check (a2) not equal: $(echo $r | tr '\n' ' ')"; exit 1; }
log "Mac prepare-2 done; $(echo "$r" | grep -o 'expo-prep-check:.*')"
$K/pull-client.sh > $K/pull-client-2.out 2>&1
l=$(grep -E '^[0-9a-f]{64}  snapback4' $K/pull-client-2.out | head -2 | sort | tr '\n' ' '); m=$(grep -E '^[0-9a-f]{64}  snapback4' $K/pull-client-2.out | tail -2 | sort | tr '\n' ' ')
n=$(grep -cE '^[0-9a-f]{64}  snapback4' $K/pull-client-2.out)
[ "$n" = 4 ] && [ "$l" = "$m" ] || { log "STOP: prepared tarball transfer mismatch (a2, n=$n): linux [$l] mac [$m]"; exit 1; }
log "a2 prepared tarballs pulled, sha256 equal on both hosts: $l"
for i in $(seq 1 60); do
  free=$(df -BG --output=avail ~ | tail -1 | tr -dc 0-9); load=$(cut -d' ' -f1 /proc/loadavg | cut -d. -f1)
  [ "$free" -ge 40 ] && [ "$load" -lt 30 ] && break; sleep 60
done
log "starting Linux qualify attempt 2 (free ${free}G, load $(cut -d' ' -f1-3 /proc/loadavg))"
$K/start-linux.sh 2 $C > $K/start-linux-2.out 2>&1; rc=$?
log "start-linux.sh 2 rc=$rc: $(grep -E 'free|HEAD|dirty|exists|no prepared' $K/start-linux-2.out | head -2 | tr '\n' ' ')"
