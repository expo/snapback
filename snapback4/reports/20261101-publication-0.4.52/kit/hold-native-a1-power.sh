#!/bin/bash
# After scoped kill-dryrun.sh: stop only the dedicated witness simulator.
set -euo pipefail
C=${1:?publication source}; K=$HOME/sb4-pub-0452; W=$HOME/sb4-pub-0444-wt
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
U=D2C67F7F-196C-439E-AEB9-3FDA4479761E
[ "$(git -C "$W" rev-parse HEAD)" = "$C" ]
[ -e "$K/chain-a1.env-invalid" ]
owned=$({ lsof -d cwd -Fpn 2>/dev/null || true; } | awk -v w="$W" '/^p/{p=substr($0,2)} /^n/{n=substr($0,2); if(n==w || index(n,w"/")==1)print p}')
[ -z "$owned" ] || { echo 'owned worktree processes remain; inspect before simulator cleanup'; exit 75; }
mkdir -p "$K/isolated/power-hold-a1"
xcrun simctl list devices --json | python3 -c 'import json,sys; u=sys.argv[1]; ds=[d for v in json.load(sys.stdin)["devices"].values() for d in v if d["udid"]==u]; assert len(ds)==1 and ds[0]["name"].startswith("Snapback4-Expo-0424-"); print(json.dumps(ds[0],indent=2))' "$U" > "$K/isolated/power-hold-a1/owned-simulator-before.json"
state=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["state"])' "$K/isolated/power-hold-a1/owned-simulator-before.json")
case "$state" in
 Booted) xcrun simctl shutdown "$U"; echo 'dedicated witness simulator shut down';;
 Shutdown) echo 'dedicated witness simulator already shut down';;
 *) echo "unexpected dedicated simulator state: $state"; exit 75;;
esac
[ -z "$(git -C "$W" status --porcelain)" ]
printf '%s\n' "$C" > "$K/native-a1-power-cleanup.sha"
echo "$(date -u +%FT%TZ) native attempt1 power cleanup complete; source $C" >> "$K/power-hold-a1.log"
