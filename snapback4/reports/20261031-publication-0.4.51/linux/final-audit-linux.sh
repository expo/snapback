#!/bin/bash
set -eu
K=$HOME/sb4-pub-0451-kit; R=$HOME/sb4-pub-0451-records; W=$HOME/sb4-pub-0441/snapback4
test "$(git -C "$W" rev-parse HEAD)" = "$(cat "$K/source.sha")"
test "$(cat "$R/smoke-staged-linux.exit")" = 0
grep -q '^RESULT PASS$' "$K/isolated/smoke-staged/results.txt"
set +e
env -u NPM_TOKEN -u NODE_AUTH_TOKEN node "$K/audit-fast.mjs" "$W" "$R/staged-0.4.51" "$R/audit-linux-final" > "$R/audit-linux-final.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$R/audit-linux-final.exit"
exit "$rc"
