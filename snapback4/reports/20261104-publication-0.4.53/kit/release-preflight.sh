#!/bin/bash
set -u
K=$HOME/sb4-pub-0453
export PATH=$HOME/sb4-03-lanes/codesign-relay:$HOME/.elan/bin:$HOME/.volta/tools/image/node/24.18.0/bin:$HOME/.bun/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
unset SNAPBACK4_BIN
ulimit -n 65536
while kill -0 42962 2>/dev/null; do sleep 10; done
cd "$HOME/sb4-pub-0453-wt" || exit 97
[ ! -e "$K/release-evidence/affected.log" ] || exit 98
echo "- $(date -u +%H:%MZ) release checks: full affected selector started (32 commands, 494 client files)." >> "$K/STATUS.md"
node snapback4/scripts/affected.mjs --base origin/main --worktree --run > "$K/release-evidence/affected.log" 2>&1
rc=$?
echo "$rc" > "$K/release-evidence/affected.exit"
echo "- $(date -u +%H:%MZ) release checks: affected exited $rc; raw log release-evidence/affected.log." >> "$K/STATUS.md"
exit "$rc"
