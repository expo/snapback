# Control-catalog test suite is fully red: scratch fixture omits packages/snapback-client

**Status:** Resolved (2026-08-11 — allowlist entry added; suite returns 20/20 pass, 0 fail)
**Impact:** 4
**Urgency:** 4
**Ease:** 5
**Confidence:** 5
**Systems:** Control catalog, Test hygiene, Generated records
**Date:** 2026-08-11
**Found while:** Baselining pre-existing reds before landing `demos/tiny-triumphs`

## Problem

Every test in `scripts/generate-control-catalog.test.mjs` failed — 20/20 top
level, 0 passing — on clean `origin/main` at `ef936353f`, in both a fresh
worktree and the primary checkout. The suite was uniformly red, so it could not
have caught a real control-catalog regression.

Each failure surfaced as an assertion mismatch where the expected refusal text
(for example `/exact path literals are unlisted/`) was replaced by:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '<tmp>/control-catalog-negative-XXXXXX/packages/snapback-client/remediation.mjs'
  imported from '<tmp>/control-catalog-negative-XXXXXX/scripts/generate-control-catalog.mjs'
```

## Confirmed cause

`scratchRepo()` builds each negative fixture by copying a fixed allowlist of
paths into a temp directory (`scripts/generate-control-catalog.test.mjs:26-44`).
The allowlist carried `packages/snapback-cli` but not `packages/snapback-client`.

`scripts/generate-control-catalog.mjs` imports
`packages/snapback-client/remediation.mjs`. That import is newer than the
allowlist, so the generator could not resolve it inside any scratch repo and
died before producing the refusal each test asserts on.

`packages/snapback-client/remediation.mjs` is tracked and present in the
checkout — nothing was missing from the repository. Only the fixture's copy
list was stale. The failure was therefore invisible to anyone reading the tree
and was not a fresh-worktree or gitignore condition.

## Resolution

Added `'packages/snapback-client'` to the `scratchRepo()` copy allowlist.

Verified before and after on the same tree:

- before: `tests 20`, `pass 0`, `fail 20`
- after: `tests 20`, `pass 20`, `fail 0`, exit 0

## Follow-up worth considering

The allowlist is a hand-maintained mirror of the generator's real dependency
set, so it will drift again the next time the generator gains an import. A
cheap guard would be for `scratchRepo()` to fail loudly when the generator
cannot resolve a module, rather than letting the resolution error masquerade as
a missing-refusal assertion failure — the current shape converts an
infrastructure fault into 20 plausible-looking product-test failures.

Related: `issues/20260811-record-inventory-control-catalog.md` covers a
different control-catalog defect (frozen-record provenance and a misdeclared
projection) and is unaffected by this fix.
