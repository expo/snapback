#!/bin/bash
set -euo pipefail
W=$HOME/sb4-records-0452; R=$HOME/sb4-pub-0452-records
cd "$W"
test "$(git branch --show-current)" = sb4-pub052-records
test -z "$(git status --porcelain)"
git show --pretty=format: HEAD | git patch-id --stable > "$R/records-before-push.patchid"
success=0
for attempt in $(seq 1 12); do
 git fetch origin main
 git -c user.name='Charlie Cheever' -c user.email=ccheever@firewoodagent.com rebase origin/main
 git show --pretty=format: HEAD | git patch-id --stable > "$R/records-after-rebase.patchid"
 diff -u "$R/records-before-push.patchid" "$R/records-after-rebase.patchid"
 if git push origin HEAD:main; then success=1; break; fi
done
test "$success" = 1
git rev-parse HEAD > "$R/records-commit.sha"
git rev-parse HEAD^ > "$R/records-affected-base.sha"
git merge-base --is-ancestor HEAD refs/remotes/origin/main
printf 'RECORDS PUSHED %s\n' "$(git rev-parse HEAD)"
