# `data-tier-corpus.test.mjs` is non-hermetic: a fresh clone's codegen suite is red

**Status:** Open — needs a design call from the generated-artifact gate owner
**Impact:** 3
**Urgency:** 2
**Ease:** 3
**Confidence:** 5
**Systems:** Codegen, Testing
**Date:** 2026-08-06
**Related:** `issues/20260806-g2-s1-fleet-lane-prelanding-review.md` (the same
class of fresh-clone breakage in `snapback-react`/`snapback-expo`, fixed there
by committing a package-local fixture closure),
`issues/20260806-guide-manifest-blocked-by-missing-demo-generated-artifacts.md`

## Symptom

On a truly fresh clone — or any worktree where the gitignored demo generated
trees have not been materialized — `bun run --cwd packages/snapback-codegen
test` dies:

```
Error: ENOENT: no such file or directory, open
  '<repo>/demos/all-aboard/snapback/generated/functions.manifest.json'
    at packages/snapback-codegen/data-tier-corpus.test.mjs:57
```

`packages/snapback-codegen/data-tier-corpus.test.mjs` gate (c) reads
`demos/all-aboard/snapback/generated/functions.manifest.json` to assert the
`MUTATION_OUTGREW_IR` / `conditional-writes` diagnostic on
`applyLiveFeedSnapshot`. That path is erased by `.gitignore`'s
`demos/*/snapback/generated/*` rule: `demos/all-aboard/snapback/generated` is a
`REVIEW_CACHE_ROOTS` entry, so only its review manifest is committed. The suite
is green only after `./scripts/check-generated-artifacts` (or a manual
`node packages/snapback-codegen/index.mjs demos/all-aboard/snapback`) has
materialized the closure. Gate (b) at `:37` reads
`demos/all-aboard/snapback/handlers.mjs`, which *is* committed, so only gate (c)
is affected.

This is pre-existing, not caused by any current lane; it was hit while landing
the G2 S1 delta and left out of scope there.

## What the cheap fixes actually cost

Measured 2026-08-06 at `535f37ce2`, not assumed:

1. **Mirror the corpus exemplar into a package-local fixture** (the fix the G2
   S1 delta used for the react/expo surface suites). A naive `cp -R` of
   `demos/all-aboard/snapback` under `packages/` fails with
   `CODEGEN_IMPORT_UNRESOLVED`, because the app imports `../../_kit/define.mjs`
   and that relative path does not exist under `packages/`. It is **not**
   blocked by `CODEGEN_IMPORT_OUTSIDE_IDENTITY_ROOT`: `addGraphFile` allows
   both `backendDir` and `REPO_ROOT` as identity roots
   (`packages/snapback-codegen/index.mjs:11088-11091`), so rewriting the import
   to a repo-relative `demos/_kit/define.mjs` generates cleanly — verified by
   probe. The real cost is duplication: all-aboard is a 7-table, 12-operation
   app with outbound actions, and the corpus exemplar's whole point is that it
   is a *real in-corpus mutation*, which a copy stops being.
2. **Promote `demos/all-aboard/snapback/generated` to `FULLY_COMMITTED_ROOTS`.**
   Mechanical, but commits a large closure for one assertion and moves the demo
   out of the review-cache custody class it was deliberately placed in.
3. **Have the test regenerate on demand** (invoke codegen from the test when
   the manifest is absent). Cheap to write; makes a package unit suite write
   into the demo tree and slow, which is the coupling the suite is trying to
   avoid.
4. **Move gate (c) out of the package suite** into the generated-artifact gate
   or the review-surface check, where the closure is guaranteed materialized.

Each of these trades a different thing. Picking one is a custody decision about
where a corpus-parity assertion belongs, which is why this is a design call for
the gate owner rather than a mechanical fix.

## Resolution criteria

`bun run --cwd packages/snapback-codegen test` exits 0 on a clone where
`git clean -ndX demos` reports nothing, with no prior
`check-generated-artifacts` run.
