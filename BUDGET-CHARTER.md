# Charter — bring guide/capabilities.md back under its enforced size budget

Small bounded task in this integration worktree. **You do not commit.** Use
apply_patch. Never run git commit/push/rebase. Touch ONLY
guide/capabilities.md.

Problem: the merged tree's guide/capabilities.md is 57,080 bytes against its
enforced 55,808-byte budget (guide-manifest refuses to write). Three lanes
each added rows (handler-runtime profile, authority profile, media field,
client lifecycle). The budget is a governed entry-tier constraint (LLP 0061)
— do NOT raise it.

Task: reduce the file below 55,808 bytes by tightening PROSE ONLY in the
rows this run added (grep for handler-runtime, authority profile, media,
lifecycle) and, if still needed, other verbose descriptions — without
removing any capability row, alias string (aliases are grep vocabulary —
never delete them), witness, GAP marker, owner, or review date, and without
changing any factual claim. Shorter sentences, not fewer facts.

Verify: `wc -c guide/capabilities.md` < 55808; then
`volta run --node 24.18.0 node scripts/generate-guide-manifest.mjs` succeeds;
then `node scripts/check-guide.mjs` has no capabilities.md error (other
pre-existing warnings fine). Report (REPORT-budget.md): bytes before/after,
what classes of text were tightened, verification tails.
