#!/bin/bash
set -euo pipefail
K=$HOME/sb4-pub-0452-kit; R=$HOME/sb4-pub-0452-records; W=$HOME/sb4-pub-0441
cd "$W"
python3 "$K/verify-opening-qualification.py" > "$R/opening-qualification-validation.json"
[ -z "$(git status --porcelain)" ]
python3 - "$W" "$R" <<'RECEIPT'
import json, pathlib, subprocess, sys, shutil
w,r=map(pathlib.Path,sys.argv[1:]);head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=w,text=True).strip()
plan=json.loads((r/'opening-affected-plan.json').read_text());assert plan['head']==head
receipts=sorted((w/'target/affected').glob(head[:12]+'-*.json'))
receipt=json.loads(receipts[-1].read_text());assert receipt['complete'] and receipt['unchanged']
validation=json.loads((r/'opening-qualification-validation.json').read_text());assert validation['ok'] and validation['head']==head
shutil.copy2(receipts[-1],r/'opening-final-affected-receipt.json')
for label in ['difftest-run-lean','difftest-run']:
 shutil.copytree(w/'snapback4/target/affected'/label,r/('opening-final-'+label),dirs_exist_ok=True)
for label,count in [('opening-alone-six',6),('social-fixture-three',3),('opening-pool-isolated/overload-browser',6)]:
 for i in range(1,count+1):assert (r/label/('run-'+str(i)+'.exit')).read_text().strip()=='0'
RECEIPT
git rev-parse HEAD > "$K/opening-tested.sha"
git rev-parse HEAD~2 > "$K/opening-base.sha"
patches() {
 for c in $(git rev-list --reverse "$1"..HEAD); do git show --format= --unified=0 "$c" | git patch-id --stable | cut -d' ' -f1; done
}
patches "$(cat "$K/opening-base.sha")" > "$R/opening-patches-tested.txt"
for i in $(seq 1 12); do
 git fetch origin
 git -c user.name='Charlie Cheever' -c user.email=ccheever@firewoodagent.com rebase origin/main
 patches origin/main > "$R/opening-patches-rebased.txt"
 if ! cmp -s "$R/opening-patches-tested.txt" "$R/opening-patches-rebased.txt"; then
  python3 "$K/log-status.py" 'HOLD: rebased fix patch set changed or was already applied upstream; inspect before push. No release cut or upload.'
  exit 75
 fi
 if git push origin HEAD:main; then
  git rev-parse HEAD > "$K/opening-main-pushed.sha"
  git log -2 --format='%H %s' > "$R/opening-main-commits.txt"
  python3 "$K/log-status.py" "Opening-recovery product fix and fixture fix pushed to origin/main under LLP0232: tip $(cat "$K/opening-main-pushed.sha"). Tested tip $(cat "$K/opening-tested.sha"); both zero-context patch IDs preserved through fetch/rebase, no semantic conflict resolution. Affected set qualified with original raw receipt and any required complete client-check rerun retained separately; opening/avatars six-run and fixture three-run evidence retained. Follow-up issue is already on main; next is a fresh release cut. No npm upload."
  exit 0
 fi
 sleep 5
done
exit 1
