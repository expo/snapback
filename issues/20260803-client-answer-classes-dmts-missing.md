# snapback-client lists answer-classes.d.mts in package files but the file is not committed

**Status:** Open
**Opened:** 2026-08-03 (found during the LLP 0146 D1 tranche, unrelated to it)
**Systems:** Client packaging

`packages/snapback-client/package.json` names `answer-classes.d.mts` in its
`files` array (beside `answer-classes.mjs`, which exists and is tracked),
but the declaration file was never committed — it is absent from
`origin/main` (verified at b877b4410). Consequence:

- `packages/snapback-cli/comparator-profile.test.mjs` fails on any clean
  checkout with `ENOENT ... answer-classes.d.mts` while packing the client
  package, aborting the `snapback-cli` npm test chain.
- A published tarball would silently drop the typed surface for the answer
  classes (npm ignores missing `files` entries), so TypeScript consumers of
  `answer-classes.mjs` exports get no declarations.

Repro: fresh worktree of main, `bun install --frozen-lockfile`, then
`node packages/snapback-cli/comparator-profile.test.mjs`.

Fix shape: author and commit `answer-classes.d.mts` matching the
`answer-classes.mjs` exports (the sibling `.d.mts` files in the package are
the pattern), or drop the entry from `files` if the surface is deliberately
untyped — the former matches `scripts/check-package-export-types.mjs`
expectations.
