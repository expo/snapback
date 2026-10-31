#!/bin/bash
set -euo pipefail
K=$HOME/sb4-pub-0451-kit; R=$HOME/sb4-pub-0451-records; W=$HOME/sb4-pub-0441
trap 'rc=$?; echo "$rc" > "$R/selector-push.exit"' EXIT
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
cd "$W"
[ "$(cat "$R/selector-fixture-checks.exit")" = 0 ]
[ "$(cat "$R/selector-affected.exit")" = 0 ]
[ -z "$(git status --porcelain)" ]
git diff --unified=0 origin/main HEAD | git patch-id --stable | cut -d' ' -f1 > "$R/selector-patch-tested.txt"
for i in $(seq 1 12); do
 git fetch origin
 git -c user.name='Charlie Cheever' -c user.email=ccheever@firewoodagent.com rebase origin/main
 git diff --unified=0 origin/main HEAD | git patch-id --stable | cut -d' ' -f1 > "$R/selector-patch-rebased.txt"
 cmp -s "$R/selector-patch-tested.txt" "$R/selector-patch-rebased.txt" || exit 75
 timeout 10800s node snapback4/scripts/affected.mjs --base origin/main --run > "$R/selector-affected-rebased-$i.log" 2>&1
 if git push origin HEAD:main; then
  git rev-parse HEAD > "$K/selector-main-pushed.sha"
  git rev-parse HEAD^ > "$K/selector-fix-main.sha"
  git log -2 --format='%H %s' > "$R/selector-main-commits.txt"
  python3 "$K/log-status.py" "Selector fixture repair and quote-jump follow-up issue pushed to origin/main: $(cat "$K/selector-main-pushed.sha"). Selector regressions3/3 (56 tests each), real2k Lean campaigns3/3 under unchanged existing four-signature policy (raw exit1/18 findings retained), exact affected checks102/102 and ref-check PASS, repeated after fetch/rebase. Issue filed: issues/20261031-social-quote-jump-async-browser-polling.md. Original opening-fix full receipt remains preserved FAIL; now rebase that stack and requalify with the repaired runner. No upload."
  exit 0
 fi
 sleep 5
done
exit 1
