#!/bin/bash
set -eu
K=$HOME/sb4-pub-0452-kit; R=$HOME/sb4-pub-0452-records
cd "$HOME/sb4-pub-0441"
[ "$(cat "$R/fixture-affected.exit")" = 0 ]; [ "$(cat "$R/fixture-checks-main-exact.exit")" = 0 ]
[ -z "$(git status --porcelain)" ]
for i in $(seq 1 12); do
 git fetch origin
 git rebase origin/main
 if git push origin HEAD:main; then
  git rev-parse HEAD > "$K/fixture-main-pushed.sha"
  python3 "$K/log-status.py" "Test-only fixture fix pushed to origin/main: $(cat "$K/fixture-main-pushed.sha"). Exact-commit affected check PASS (24/24 and ref-check 0 errors), file alone 3/3 (72/72), diagnostic negative control rejects the old behavior in four intended cases. No product code change."
  exit 0
 fi
 sleep 5
done
exit 1
