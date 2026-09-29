#!/usr/bin/env bash
# Build-free live SQ replay/probes for two supplied binaries. Also works on Linux.
set -euo pipefail
if [[ $# != 4 ]]; then
  echo 'usage: macos-live-curve.sh BEFORE AFTER PRIVATE_REPLAY_TEMPLATE NEW_OUTPUT' >&2
  exit 2
fi
umask 077
tool=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$tool/../../../.." && pwd)
before=$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve())' "$1")
after=$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve())' "$2")
template=$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve())' "$3")
output=$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve())' "$4")
[[ ! -e "$output" ]] || { echo 'Output exists; preserve it and choose a new directory.' >&2; exit 2; }
[[ -x "$before" && -x "$after" ]] || { echo 'Supply two executable binaries.' >&2; exit 2; }
[[ -f "$repo/snapback4/packages/snapback4/dist/node-fetch.js" ]] || { echo 'Build/install the local SDK before running this script.' >&2; exit 2; }
mkdir -p "$output"
cd "$repo"
python3 - "$before" "$after" "$output" <<'PY'
import hashlib,json,pathlib,platform,sys
pathlib.Path(sys.argv[3],'inputs.json').write_text(json.dumps({'host':platform.platform(),
    'binaries':{key:{'path':p,'sha256':hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()}
    for key,p in zip(['before','after'],sys.argv[1:3])}},indent=2))
PY
affinity=()
# BP_CPUS=0-9 on Linux confines server, replay, verification and warmed probes.
[[ -z "${BP_CPUS:-}" ]] || affinity=(--cpus "$BP_CPUS")
for tag in before after; do
  binary=$before
  [[ "$tag" != after ]] || binary=$after
  python3 "$tool/prepare.py" "$template" "$output/$tag"
  python3 "$tool/live.py" "$binary" "$output/$tag" "${affinity[@]}"
  python3 "$tool/summarize.py" "$output/$tag" | tee "$output/$tag-summary.txt"
done
echo 'Raw samples, loads, correctness receipts and private state remain in the output directory.'
