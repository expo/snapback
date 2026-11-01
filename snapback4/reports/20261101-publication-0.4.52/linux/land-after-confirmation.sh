#!/bin/bash
set -euo pipefail
K=$HOME/sb4-pub-0452-kit; R=$HOME/sb4-pub-0452-records; W=$HOME/sb4-pub-0441
trap 'rc=$?; echo "$rc" > "$R/opening-land.exit"' EXIT
until [ -s "$R/opening-qualified-avatars-six.exit" ]; do sleep 2; done
[ "$(cat "$R/opening-qualified-avatars-six.exit")" = 0 ]
[ "$(cat "$R/opening-qualified-avatars-six/source.sha")" = "$(git -C "$W" rev-parse HEAD)" ]
for i in $(seq 1 6); do [ "$(cat "$R/opening-qualified-avatars-six/run-$i.exit")" = 0 ]; done
bash "$K/land-opening.sh"
