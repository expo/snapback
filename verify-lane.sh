#!/bin/bash
# usage: verify-lane.sh <worktree> <tag>   → log/<tag>-verify.log (+ <tag>-test-full.log)
WT=$1; TAG=$2; P=/Users/ccheever/projects/snapback-el-20260908; LOG=$P/log
export PATH=/Users/ccheever/projects/snapback-el-20260908/bin:$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
export SNAPBACK2_COMPILER=$WT/snapback2/packages/snapback2/dist/compiler.mjs
cd "$WT" || exit 1
{
echo "== load $(uptime | sed 's/.*load averages: //')"
echo "== diff --check"; git diff --check && echo clean
echo "== line cap (changed files > 1500)"; git status --porcelain | awk '{print $2}' | while read f; do [ -f "$f" ] && [ "$(wc -l < "$f")" -gt 1500 ] && echo "OVER: $f $(wc -l < "$f")"; done; echo done
echo "== test.sh"; (cd snapback2 && scripts/test.sh) > "$LOG/$TAG-test-full.log" 2>&1; echo "exit $?"
/usr/bin/grep -E 'Summary \[|"cases":|"checks":|^ℹ (pass|fail|cancelled)|✖|FAIL \[' "$LOG/$TAG-test-full.log" | sed -E 's/"names":\[.*//' | head -40
echo "== caps"; node scripts/caps.mjs 2>&1 | tail -3
echo "== ref-check"; ./ref-check --verbose 2>&1 | tail -1
echo "== load $(uptime | sed 's/.*load averages: //')"
echo done
} > "$LOG/$TAG-verify.log" 2>&1
