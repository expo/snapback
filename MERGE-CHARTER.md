# Charter — resolve the substrate merge conflicts (integration worktree)

This worktree is MID-MERGE (substrate lane into the integration branch).
**You do not commit** — resolve and `git add` only. Never run
git commit/push/rebase/merge --abort.

1. packages/snapback-codegen/index.mjs — one conflict: both sides added
   import blocks (client-lifecycle.mjs vs semantic-generation.mjs helpers).
   Resolution: UNION — keep both import blocks. Then check the rest of the
   file compiles conceptually: both sides' features must coexist (S1-S3
   substrate emission + 0238 lifecycle manifest emission). Verify with
   `node --check packages/snapback-codegen/index.mjs` and by running
   `node packages/snapback-codegen/index.mjs demos/todo/snapback` (expect ok).
2. scripts/check-package-test-inventory.mjs — two conflict hunks. The merged
   truth: base 257 tests; substrate added 258→260 (S2 +1, S3 +2); the
   client-lifecycle lane added +2. Merged expectedTotal = 262. Keep BOTH
   history comment blocks, renumbered chronologically so transitions read
   255→257 (S1), 257→258 (0237 R2), 258→260 (0241 R1), 260→262 (0238 R1).
   Verify with `node scripts/check-package-test-inventory.mjs` (PASS: 262).
3. Every other conflicted file (git diff --name-only --diff-filter=U) is a
   GENERATED artifact (guide manifests/flats, guide/reference/*, registries,
   demos/*/generated/artifacts.json): take the incoming (theirs) side
   verbatim with `git checkout --theirs -- <file>` and `git add` it. Do NOT
   hand-merge them — they are regenerated on the merged tree afterward.
4. `git add` your two resolved source files. Leave the merge uncommitted.

Report (REPORT-merge.md): the exact resolution of both source files, the
verification outputs, and the final `git status --porcelain | head -30`.
