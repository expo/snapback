#!/bin/bash
# 0.4.49 attempt 3 Mac / Linux attempt 4 (DARWIN1 fix commit): archive linux-3 (9c77333f2d, superseded; its receipt binds the unpublished stage), move the Linux worktree's
# client-0.4.49 aside and check out C; then wait for the Mac chain's prepare-3 + expo-prep-check, pull the Mac-prepared bytes,
# compare sha256 on both hosts, and start Linux qualify attempt 4 (free >= 40 GB, 1-min load < 30, waits up to 60 min).
R=~/sb4-pub-0449-records; K=~/sb4-pub-0449-kit; M=ccheever@charlies-macbook-pro-m5max-black; C=${1:?full sha}
W=~/sb4-pub-0441; log() { echo "- $(date -u +%FT%TZ) $*" >> $R/STATUS.md; }
[ ${#C} = 40 ] || { echo "need the full sha"; exit 1; }
A=$R/archive-linux-3; [ -e $A ] && { log "STOP: $A exists"; exit 1; }; mkdir -p $A
mv $R/linux-qualification-0.4.49 $R/attempt-3-linux-* $R/linux-3.exit $R/disk.log $A/ 2>/dev/null; rm -rf $R/npm-cache-3
mv $W/snapback4/target/publication/client-0.4.49 $W/snapback4/target/publication/client-0.4.49-a2-9c77333f2d
[ -z "$(git -C $W status --porcelain)" ] || { log "STOP: Linux worktree dirty after linux-3: $(git -C $W status --porcelain | head -3 | tr '\n' ' ')"; exit 1; }
git -C $W checkout -q --detach $C || { log "STOP: Linux checkout of $C failed"; exit 1; }
[ "$(git -C $W rev-parse HEAD)" = "$C" ] && [ -z "$(git -C $W status --porcelain)" ] || { log "STOP: Linux worktree not clean at C"; exit 1; }
log "linux-3 (9c77333f2d; receipt for the unpublished stage) archived to $A; Linux worktree at ${C:0:10}, clean"
while :; do
  r=$(timeout 60 ssh -o BatchMode=yes -o ConnectTimeout=15 $M 'echo "prep=$(cat ~/sb4-pub-0449/prepare-3.exit 2>/dev/null) native=$(cat ~/sb4-pub-0449/native-3.exit 2>/dev/null)"; grep -h "expo-prep-check:\|FAILED\|chain exit" ~/sb4-pub-0449/chain-a3.log 2>/dev/null | tail -2' 2>/dev/null)
  case "$r" in *"native=stopped"*|*"prep=stopped"*|*"post-native FAILED"*) log "Mac chain-a3 stopped before a usable prepare: $(echo $r | tr '\n' ' ')"; exit 1;; esac
  echo "$r" | grep -q "expo-prep-check:" && break
  sleep 60
done
echo "$r" | grep -q "expo-prep-check: prepared expo files [0-9]* qualified [0-9]* equal True" || { log "STOP: Mac expo-prep-check (a3) not equal: $(echo $r | tr '\n' ' ')"; exit 1; }
log "Mac prepare-3 done; $(echo "$r" | grep -o 'expo-prep-check:.*')"
$K/pull-client.sh > $K/pull-client-3.out 2>&1
l=$(grep -E '^[0-9a-f]{64}  snapback4' $K/pull-client-3.out | head -2 | sort | tr '\n' ' '); m=$(grep -E '^[0-9a-f]{64}  snapback4' $K/pull-client-3.out | tail -2 | sort | tr '\n' ' ')
n=$(grep -cE '^[0-9a-f]{64}  snapback4' $K/pull-client-3.out)
[ "$n" = 4 ] && [ "$l" = "$m" ] || { log "STOP: prepared tarball transfer mismatch (a3, n=$n): linux [$l] mac [$m]"; exit 1; }
log "a3 prepared tarballs pulled, sha256 equal on both hosts: $l"
for i in $(seq 1 60); do
  free=$(df -BG --output=avail ~ | tail -1 | tr -dc 0-9); load=$(cut -d' ' -f1 /proc/loadavg | cut -d. -f1)
  [ "$free" -ge 40 ] && [ "$load" -lt 30 ] && break; sleep 60
done
log "starting Linux qualify attempt 4 (free ${free}G, load $(cut -d' ' -f1-3 /proc/loadavg))"
$K/start-linux.sh 4 $C > $K/start-linux-4.out 2>&1; rc=$?
log "start-linux.sh 4 rc=$rc: $(grep -E 'free|HEAD|dirty|exists|no prepared' $K/start-linux-4.out | head -2 | tr '\n' ' ')"
