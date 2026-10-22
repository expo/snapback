#!/bin/bash
# 0.4.37 attempt 1 Mac chain: native -> post-native (witness diff + toolchainProvenance) -> prepare -> expo-prep-check -> lean -> warm.
K=$HOME/sb4-pub-0437; cd $K
log() { echo "$(date -u +%FT%TZ) $*" >> $K/chain-a1.log; }
log "native-1 start"; ATTEMPT=1 bash ./native.sh > native-a1.log 2>&1; log "native-1: $(cat native-1.exit)"
[ "$(cat native-1.exit)" = done ] || exit 1
bash ./post-native.sh > post-native-a1.log 2>&1 || { log "post-native FAILED"; exit 1; }; log "post-native ok"
ATTEMPT=1 bash ./publish.sh prepare > prepare-a1.log 2>&1; log "prepare-1: $(cat prepare-1.exit)"
[ "$(cat prepare-1.exit)" = done ] || exit 1
python3 expo-prep-check.py > expo-prep-check-a1.log 2>&1; log "expo-prep-check: $(head -1 expo-prep-check-a1.log)"
ATTEMPT=1 bash ./publish.sh lean > lean-a1.log 2>&1; log "lean-1: $(cat lean-1.exit)"
ATTEMPT=1 bash ./publish.sh warm > warm-a1.log 2>&1; log "warm-1: $(cat warm-1.exit)"
log "chain done"
