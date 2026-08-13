# Charter — resolve the final media-lane merge conflicts (integration worktree)

Mid-merge. **You do not commit** — resolve and `git add` only. Never run
git commit/push/rebase/merge --abort.

1. packages/snapback-codegen/package.json — union: the merged test chain
   contains BOTH sides' added test commands (integration side has the S2/S3/
   L additions; media side adds media-field-authoring.test.mjs). Keep a
   sensible position (beside the other asset/authoring tests).
2. scripts/check-package-test-inventory.mjs — integration side expects 262;
   media side adds one test file (media-field-authoring). Merged
   expectedTotal = 263. Keep both history comment blocks chronologically,
   adding the media line (0239/0244 slice: +1). Verify with
   `node scripts/check-package-test-inventory.mjs` (PASS: 263).
3. guide/capabilities.md — REAL merge: base was tightened to fit the 55,808
   budget with 2 bytes spare; media side flips assets.media-field.v1 to its
   shipped subset and edits media-related rows. Merge BOTH intents: media's
   factual row states over the tightened prose. If over budget, tighten
   What-column prose further (never remove rows/aliases/witnesses/GAP
   markers/owners/dates). Verify `wc -c` < 55808.
4. Every other conflicted file is generated (demos/*/generated/*, guide
   manifest/flats, guide/reference/*): `git checkout --theirs` + `git add`;
   regeneration follows on the merged tree.
5. `git add` your three resolved files. Leave the merge uncommitted.

Report (REPORT-merge2.md): resolutions, verification outputs, final
git status head.
