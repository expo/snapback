#!/bin/bash
# 0.4.49 attempt 3 Mac chain (148cb4d372): native -> post-native (witness diff + toolchainProvenance) -> prepare -> expo-prep-check -> lean -> warm.
K=$HOME/sb4-pub-0449; cd $K
log() { echo "$(date -u +%FT%TZ) $*" >> $K/chain-a3.log; }
log "native-3 start"; ATTEMPT=3 bash ./native.sh > native-a3.log 2>&1; log "native-3: $(cat native-3.exit)"
[ "$(cat native-3.exit)" = done ] || exit 1
bash ./post-native.sh > post-native-a3.log 2>&1 || { log "post-native FAILED"; exit 1; }; log "post-native ok"
ATTEMPT=3 bash ./publish.sh prepare > prepare-a3.log 2>&1; log "prepare-3: $(cat prepare-3.exit)"
[ "$(cat prepare-3.exit)" = done ] || exit 1
python3 expo-prep-check.py > expo-prep-check-a3.log 2>&1; log "expo-prep-check: $(head -1 expo-prep-check-a3.log)"
ATTEMPT=3 bash ./publish.sh lean > lean-a3.log 2>&1; log "lean-3: $(cat lean-3.exit)"
ATTEMPT=3 bash ./publish.sh warm > warm-a3.log 2>&1; log "warm-3: $(cat warm-3.exit)"
log "chain done"
