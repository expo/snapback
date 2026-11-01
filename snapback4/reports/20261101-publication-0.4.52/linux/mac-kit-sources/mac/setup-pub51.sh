#!/bin/bash
set -eu
C=${1:?}; WT=$HOME/sb4-pub-0444-wt; W=$WT/snapback4; K=$HOME/sb4-pub-0452
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$HOME/.bun/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
[ -z "$(git -C "$WT" status --porcelain)" ]
[ ! -e "$K/native-final-started.sha" ] || { echo "native already armed; inspect its owned gate before any setup retry"; exit 75; }
mkdir -p "$K/previous-0450-records" "$K/isolated"
for d in "$W"/reports/*0.4.50*; do [ ! -e "$d" ] || mv "$d" "$K/previous-0450-records/"; done
for d in "$W"/target/publication/*0.4.50*; do [ ! -e "$d" ] || rm -rf "$d"; done
cd "$WT"; git checkout --detach "$C"; git branch -f sb4-publish-0.4.52 "$C"; git switch sb4-publish-0.4.52
[ "$(git rev-parse HEAD)" = "$C" ]; [ -z "$(git status --porcelain)" ]
# Own build profiles only: force the embedded engine stamp to follow the fresh release.
rm -rf "$W/target/wasm32-unknown-unknown/wasm" "$W/target/wasm"
rm -f "$W/target/debug/snapback4"
X=$(git rev-parse --git-common-dir)/info/exclude
printf 'snapback4/reports/20261101-publication-0.4.52/\nsnapback4/reports/20261101-expo-0.4.52/\n' >> "$X"
mkdir -p "$W/target/incoming/linux-0.4.52"
if [ "${PUB52_SETUP_ONLY:-0}" = 1 ]; then
 echo "source setup complete; native held for both-host audit"; exit 0
fi
exec bash "$K/start-native-final.sh" "$C"
