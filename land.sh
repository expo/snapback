#!/usr/bin/env bash
# Landing steps for one lane worktree, run ONE STEP AT A TIME by the orchestrator.
#   land.sh <worktree> merge   — fetch + merge origin/main; union-resolve metrics/loop.jsonl only; STOP on any other conflict
#   land.sh <worktree> verify  — out-of-sandbox test.sh + measure --check + caps + ref-check + check-inventories (report)
#   land.sh <worktree> push    — push the lane branch ref to main (fast-forward only server-side)
set -uo pipefail
LANE=$1; STEP=${2:-}
LOG=/Users/ccheever/projects/snapback-el-20260908/log
export PATH=/Users/ccheever/projects/snapback-el-20260908/bin:~/.volta/tools/image/node/24.18.0/bin:$PATH
cd "$LANE" || exit 1
tag=$(basename "$LANE")

case "$STEP" in
  merge)
    git fetch -q origin || exit 1
    echo "lane HEAD $(git rev-parse --short HEAD); origin/main $(git rev-parse --short origin/main)"
    if git merge-base --is-ancestor origin/main HEAD; then echo "already contains origin/main"; exit 0; fi
    if git merge --no-edit origin/main >"$LOG/merge-$tag.log" 2>&1; then echo "clean merge: $(git rev-parse --short HEAD)"; exit 0; fi
    conflicts=$(git diff --name-only --diff-filter=U)
    echo "CONFLICTS:"; echo "$conflicts"
    if [ "$conflicts" = "snapback2/metrics/loop.jsonl" ]; then
      python3 - <<'EOF'
import subprocess
ours = subprocess.run(['git','show',':2:snapback2/metrics/loop.jsonl'],capture_output=True,text=True).stdout.splitlines()
theirs = subprocess.run(['git','show',':3:snapback2/metrics/loop.jsonl'],capture_output=True,text=True).stdout.splitlines()
seen=set(); out=[]
for line in ours+theirs:
    if line and line not in seen: seen.add(line); out.append(line)
open('snapback2/metrics/loop.jsonl','w').write('\n'.join(out)+'\n')
print(f"loop.jsonl union: {len(out)} records")
EOF
      git add snapback2/metrics/loop.jsonl && git commit -q --no-edit && echo "merged with loop.jsonl union: $(git rev-parse --short HEAD)"; exit 0
    fi
    echo "STOP: non-metrics conflict; resolve by hand (git checkout -m -- <file>; never --theirs)"; exit 2 ;;
  verify)
    status=0
    echo "== test.sh (out of sandbox)"; (cd snapback2 && scripts/test.sh) >"$LOG/land-test-$tag.log" 2>&1 || { status=1; echo "test.sh FAILED (exit)"; }
    /usr/bin/grep -E 'Summary \[|"cases":|"checks":|^# (pass|fail)|test result' "$LOG/land-test-$tag.log" | sed -E 's/"names":\[.*//' | head -12
    echo "== measure --check"; (cd snapback2 && node scripts/measure.mjs --check) >"$LOG/land-measure-$tag.log" 2>&1 || { status=1; echo "measure FAILED"; tail -20 "$LOG/land-measure-$tag.log"; }
    tail -3 "$LOG/land-measure-$tag.log"
    echo "== caps"; node scripts/caps.mjs >"$LOG/land-caps-$tag.log" 2>&1 || echo "caps red (read the log; the working-set count is main's)"; tail -8 "$LOG/land-caps-$tag.log"
    echo "== ref-check"; ./ref-check --verbose >"$LOG/land-refcheck-$tag.log" 2>&1; rc=$?; tail -2 "$LOG/land-refcheck-$tag.log"; [ $rc -eq 0 ] || { status=1; echo "ref-check FAILED"; }
    echo "== check-inventories (report-only; grep FAIL)"; node scripts/check-inventories.mjs >"$LOG/land-inventories-$tag.log" 2>&1; echo "FAIL lines: $(/usr/bin/grep -c FAIL "$LOG/land-inventories-$tag.log")"
    echo "verify status $status"; exit $status ;;
  push)
    git fetch -q origin
    git merge-base --is-ancestor origin/main HEAD || { echo "origin/main moved; run merge first"; exit 3; }
    git push origin HEAD:main >"$LOG/land-push-$tag.log" 2>&1; cat "$LOG/land-push-$tag.log"
    /usr/bin/grep -qE '^\s*[0-9a-f]+\.\.[0-9a-f]+\s+HEAD -> main' "$LOG/land-push-$tag.log" && ! /usr/bin/grep -q 'rejected' "$LOG/land-push-$tag.log" && echo "PUSHED $(git rev-parse --short HEAD)" || { echo "push did not land"; exit 4; } ;;
  *) echo "usage: land.sh <worktree> merge|verify|push"; exit 1 ;;
esac
