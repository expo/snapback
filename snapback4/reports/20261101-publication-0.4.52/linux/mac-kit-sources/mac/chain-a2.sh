#!/bin/bash
# 0.4.52 attempt 2 Mac chain (107a413c29): native -> post-native (witness diff + toolchainProvenance) -> prepare -> expo-prep-check -> lean -> warm.
K=$HOME/sb4-pub-0452; cd $K
log() { echo "$(date -u +%FT%TZ) $*" >> $K/chain-a2.log; }
log "native-2 start"; ATTEMPT=2 bash ./native.sh > native-continue-a2.log 2>&1; log "native-2: $(cat native-2.exit)"
[ "$(cat native-2.exit)" = done ] || exit 1
bash ./post-native-a2.sh > post-native-a2.log 2>&1 || { log "post-native FAILED"; exit 1; }; log "post-native ok"
ATTEMPT=2 bash ./publish.sh prepare > prepare-a2.log 2>&1; log "prepare-2: $(cat prepare-2.exit)"
[ "$(cat prepare-2.exit)" = done ] || exit 1
python3 expo-prep-check.py > expo-prep-check-a2.log 2>&1 || { log "expo-prep-check FAILED"; exit 1; }; log "expo-prep-check: $(head -1 expo-prep-check-a2.log)"
log "native/prepare chain done; audits required before warm/pre"
