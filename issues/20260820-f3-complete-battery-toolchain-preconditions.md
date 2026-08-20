# The F-3 complete battery needs three undocumented preconditions

**Status:** Open
**Filed:** 2026-08-20
**Systems:** Verification, proof harness, Developer experience
**Related:** LLP 0283 F-3, LLP 0175 D2.3, LLP 0189

## Finding

`scripts/verify-local-proof --complete` cannot produce a meaningful result unless three
preconditions hold, none of which is documented or checked up front. Each is independently
sufficient to blank most of the battery, and each was discovered only by hitting it:

1. **Node deps installed.** A fresh worktree has no `node_modules`, so JS gates die on
   `ERR_MODULE_NOT_FOUND`. Observed as ~49 failures that were not product defects.
2. **Node pinned to `.node-version`.** Running Node v26.7.0 against the pinned v24.18.0 fails
   `toolchain-authority`, which is a prerequisite of `native-runtime-bootstrap` →
   `current-binary-build` → `current-binary-readiness`. **That one mismatch BLOCKED 123 of
   172 gates.**
3. **Bun pinned to `packageManager`.** With Node fixed, the same gate then failed on Bun
   1.3.9 vs `bun@1.3.12`, re-blocking the same cascade.

A fresh lane worktree additionally lacks the gitignored `demos/*/snapback/generated/*`
artifacts, which several gates read.

**This is the practical reason F-3 "has never run."** It is not that the battery is
expensive; it is that an ordinary invocation silently degrades into a mostly-blocked run
whose failures look like product defects. The first two attempts here produced exactly that
false picture.

## Why it matters beyond convenience

`toolchain-authority` is fail-closed and correct — the problem is that its failure is
reported as one red among many, while its real effect is to hide 123 gates behind
`BLOCKED`. A reader skimming the summary sees "49 failures" and cannot tell that most of the
suite never executed.

## Acceptance

- `scripts/verify-local-proof --complete` fails fast and loudly when the toolchain does not
  match the pins, naming Node, Bun, and node_modules explicitly, rather than surfacing it as
  an ordinary gate red partway through.
- The blocked-gate summary distinguishes "blocked by a toolchain precondition" from "blocked
  by a product gate failure", so a mostly-blocked run cannot be mistaken for a mostly-passing
  one.
- The preconditions (including seeding gitignored generated demo artifacts in a fresh
  worktree) are documented wherever the battery is described — CLAUDE.md and/or
  `scripts/README.md`.
- Consider having the entry point select the pinned toolchain itself when it is available
  locally (volta has both here), rather than requiring the caller to arrange PATH.
