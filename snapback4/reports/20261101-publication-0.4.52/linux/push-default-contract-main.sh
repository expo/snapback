#!/bin/bash
set -euo pipefail
K=$HOME/sb4-pub-0452-kit; R=$HOME/sb4-pub-0452-records
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
trap 'echo $? > "$R/default-contract-main-push.exit"' EXIT
[ "$(cat "$R/default-contract-main-affected.exit")" = 0 ]
[ "$(cat "$R/default-contract-root-install.exit")" = 0 ]
cd "$HOME/sb4-pub-0452-fixtures"
[ -z "$(git status --porcelain)" ]
git show --format= --unified=0 HEAD | git patch-id --stable > "$R/default-contract-tested.patch-id"
for i in $(seq 1 12); do
 git fetch origin
 git -c user.name='Charlie Cheever' -c user.email=ccheever@firewoodagent.com rebase origin/main
 git show --format= --unified=0 HEAD | git patch-id --stable > "$R/default-contract-pushed.patch-id"
 [ "$(cut -d' ' -f1 "$R/default-contract-tested.patch-id")" = "$(cut -d' ' -f1 "$R/default-contract-pushed.patch-id")" ]
 if git push origin HEAD:main; then
  git rev-parse HEAD > "$K/default-contract-main-pushed.sha"
  python3 "$K/log-status.py" "Test-only historical changelog fixture repair pushed to origin/main: $(git rev-parse HEAD). Alone3/3 and exact affected check PASS; semantic patch preserved through landing. No runtime change or upload."
  exit 0
 fi
 sleep 5
done
exit 1
