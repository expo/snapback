#!/bin/bash
set -eu
K=$HOME/sb4-pub-0453; W=$HOME/sb4-pub-0453-wt/snapback4
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
test "$(git -C "$W" rev-parse HEAD)" = "$(cat "$K/native-audits-green.sha")"
test "$(cat "$K/dry-run-1.exit")" = done
test ! -e "$K/dry-run-1.env-invalid"
/usr/bin/grep -q '^RESULT PASS$' "$K/isolated/smoke-staged/results.txt"
set +e
node "$K/audit-fast.mjs" "$W" "$W/target/publication/snapback4-darwin-arm64-0.4.53" "$K/isolated/audit-mac-final" > "$K/audit-mac-final.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$K/audit-mac-final.exit"
exit "$rc"
