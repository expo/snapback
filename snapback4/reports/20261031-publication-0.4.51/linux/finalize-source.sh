#!/bin/bash
# Freeze the pushed publication source and transfer Git objects; never starts native or uploads.
set -euo pipefail
K=$HOME/sb4-pub-0451-kit; R=$HOME/sb4-pub-0451-records; W=$HOME/sb4-pub-0441
M=ccheever@charlies-macbook-pro-m5max-black
trap 'rc=$?; echo "$rc" > "$R/finalize-source.exit"' EXIT
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
cd "$W"
for f in release-affected release-inventories release-ref-check; do [ "$(cat "$R/$f.exit")" = 0 ]; done
[ -z "$(git status --porcelain)" ]
C=$(cat "$K/source.sha"); [ "$(git rev-parse HEAD)" = "$C" ]
git fetch origin; git merge-base --is-ancestor "$C" origin/main
git checkout --detach "$C"
python3 - "$W" "$R" "$K" <<'PROVENANCE'
import pathlib,json,subprocess,sys,shutil
w,r,k=map(pathlib.Path,sys.argv[1:]);run=lambda *a:subprocess.check_output(['git',*a],cwd=w,text=True).strip()
c=run('rev-parse','HEAD');checked=(k/'source-before-push.sha').read_text().strip()
receipts=sorted((w/'target/affected').glob(checked[:12]+'-*.json'));assert receipts
receipt=json.loads(receipts[-1].read_text());assert receipt['complete'] and receipt['ok'] and receipt['unchanged']
shutil.copy2(receipts[-1],r/('release-affected-receipt-'+receipts[-1].name))
lineage={'publicationSource':c,'releaseChecksSource':checked,'base':run('rev-parse','HEAD^'),'commits':run('log','--format=%H %s','HEAD^..HEAD').splitlines(),'changedPaths':run('diff','--name-only','HEAD^','HEAD').splitlines(),'releaseDeltaPatchId':(r/'release-patch-rebased.txt').read_text().strip(),'route':'fresh then-current origin/main after authorized opening and fixture repairs, plus one fresh release commit; stable release delta preserved across optimistic rebase'}
(r/'lineage.json').write_text(json.dumps(lineage,indent=2)+'\n')
if (r/'qualified-source.sha').exists():assert (r/'qualified-source.sha').read_text().strip()==c,'archive earlier qualified source before changing it'
(r/'qualified-source.sha').write_text(c+'\n')
PROVENANCE
if [ ! -e "$R/qualified-source.bundle" ]; then git bundle create "$R/qualified-source.bundle" HEAD ^HEAD^; fi
git bundle verify "$R/qualified-source.bundle" > "$R/qualified-source-bundle-verify.out" 2>&1
sha256sum "$R/qualified-source.bundle" > "$R/qualified-source.bundle.sha256"
python3 "$K/set-final-mac-source.py" > "$R/final-mac-source-assertions.log"
macurl=ssh://ccheever@charlies-macbook-pro-m5max-black/Users/ccheever/projects/snapback
# A named remote with its fetched predecessor avoids a new-ref all-history hook scan.
git -c remote.pub51-m5.url="$macurl" fetch pub51-m5 refs/heads/sb4-publish-0.4.51:refs/remotes/pub51-m5/sb4-publish-0.4.51
git -c remote.pub51-m5.url="$macurl" push pub51-m5 "HEAD:refs/heads/sb4-pub051-source-${C:0:10}"
rsync -a "$K/mac/" "$M:sb4-pub-0451/"
python3 "$K/log-status.py" "Publication source frozen/detached and SSH Git transport completed: $C. Release-checks source $(cat "$K/source-before-push.sha") and stable version-delta patch mapping retained in lineage.json; qualified source bundle verified. Mac assertions/kit now name final source. Native has not started: stale-artifact inspection and setup-only checkout precede fresh audits and native. No upload."
