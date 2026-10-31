#!/bin/bash
set -eu
cd "$HOME/sb4-pub-0441"
K=$HOME/sb4-pub-0451-kit; R=$HOME/sb4-pub-0451-records
for f in release-affected release-inventories release-ref-check; do [ "$(cat "$R/$f.exit")" = 0 ]; done
[ -z "$(git status --porcelain)" ]
python3 - "$PWD" "$R" <<'PRESERVE_REPORTS'
import pathlib,shutil,sys
w,r=map(pathlib.Path,sys.argv[1:])
for label in ['difftest-run-lean','difftest-run']:
 shutil.copytree(w/'snapback4/target/affected'/label,r/('release-final-'+label),dirs_exist_ok=True)
PRESERVE_REPORTS
git rev-parse HEAD > "$K/source-before-push.sha"
git show --format= --unified=0 HEAD | git patch-id --stable | cut -d' ' -f1 > "$R/release-patch-tested.txt"
for i in $(seq 1 12); do
 git fetch origin
 git -c user.name='Charlie Cheever' -c user.email=ccheever@firewoodagent.com rebase origin/main
 git show --format= --unified=0 HEAD | git patch-id --stable | cut -d' ' -f1 > "$R/release-patch-rebased.txt"
 cmp -s "$R/release-patch-tested.txt" "$R/release-patch-rebased.txt" || { python3 "$K/log-status.py" 'HOLD: release delta changed during rebase; inspect and recheck before pushing.'; exit 75; }
 if git push origin HEAD:main; then
  git rev-parse HEAD > "$K/source.sha"
  python3 "$K/log-status.py" "RELEASE COMMIT PUSHED; publication source $(cat "$K/source.sha"). All release checks passed. Previous draft source $(cat "$K/source-before-push.sha")."
  exit 0
 fi
 sleep 5
done
exit 1
