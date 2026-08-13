# Charter — repair guide/capabilities.md merge (two rows dropped)

**You do not commit.** Use apply_patch. Touch ONLY guide/capabilities.md.

The merge resolution dropped two capability rows, breaking the manifest:
guide/auth/scoped-roles.md claims 'authority.profile.v1' and
guide/backend/handler-runtime.md claims 'backend.handler-runtime-profile',
both now missing from guide/capabilities.md.

Recover the correct rows from the integration-side parent:
`git show HEAD^:guide/capabilities.md` (it contains both rows in
budget-tightened form). Re-insert them at their proper table positions in
the current file, preserving everything else (including the media-lane row
states already merged). Keep total size under 55,808 bytes — tighten What
prose further if needed (never remove rows/aliases/witnesses/GAPs/owners/
dates). Also diff current vs HEAD^ and HEAD^2 versions to confirm NO other
row from either parent was lost — report the check.

Verify: wc -c < 55808; `volta run --node 24.18.0 node
scripts/generate-guide-manifest.mjs` succeeds; `node scripts/check-guide.mjs`
green. Report (REPORT-capfix.md): rows restored, parity check, sizes, tails.
