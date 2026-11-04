#!/bin/bash
# 0.4.53 attempt 1 Mac chain (9da2c76fdf): native -> post-native (witness diff + toolchainProvenance) -> prepare -> expo-prep-check -> lean -> warm.
K=$HOME/sb4-pub-0453; cd $K
log() { echo "$(date -u +%FT%TZ) $*" >> $K/chain-a2.log; }
log "native-1 start"; ATTEMPT=1 bash ./native.sh > native-continue-a2.log 2>&1; log "native-1: $(cat native-1.exit)"
[ "$(cat native-1.exit)" = done ] || exit 1
bash ./post-native-a2.sh > post-native-a2.log 2>&1 || { log "post-native FAILED"; exit 1; }; log "post-native ok"
ATTEMPT=1 bash ./publish.sh prepare > prepare-a2.log 2>&1; log "prepare-1: $(cat prepare-1.exit)"
[ "$(cat prepare-1.exit)" = done ] || exit 1
python3 expo-prep-check.py > expo-prep-check-a2.log 2>&1 || { log "expo-prep-check FAILED"; exit 1; }; log "expo-prep-check: $(head -1 expo-prep-check-a2.log)"
log "native/prepare chain done; audits required before warm/pre"
