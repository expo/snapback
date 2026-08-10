# `data-tier-corpus.test.mjs` is non-hermetic: a fresh clone's codegen suite is red

**Status:** Resolved 2026-08-10
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

## Author ruling — 2026-08-10

Option 4 ruled: move gate (c) out of the package unit suite into the
generated-artifact gate (or the review-surface check), where the closure is
guaranteed materialized. The package suite stays hermetic, the corpus
exemplar stays a real in-corpus mutation, and nothing new is committed.
Resolution criteria above unchanged.

## Resolution — 2026-08-10

Gate (c) moved to `scripts/check-data-tier-corpus-exemplar.mjs`, invoked by
`scripts/check-generated-artifacts` immediately after its registered codegen
jobs materialize every generated closure. The generic
`scripts/verify-generated-review-surface.mjs` remains limited to review-cache
custody, graph-digest, projection, and tracked-index invariants; the
All Aboard corpus-semantic assertion does not belong in that reusable layer.
The moved checker preserves all four original predicates: the regenerated
manifest must contain the `MUTATION_OUTGREW_IR` diagnostic for
`applyLiveFeedSnapshot`, with class `conditional-writes`, message text
`outgrew the IR: conditional writes`, and severity `info`. Gates (a) and (b)
remain in the package suite.

Verification in the isolated L1 worktree:

- `git clean -fdX demos` left
  `demos/all-aboard/snapback/generated/functions.manifest.json` absent.
  With no preceding generated-artifact run,
  `node packages/snapback-codegen/data-tier-corpus.test.mjs` exited 0:
  `37 cases verified; builder-parity assertions passed`.
- After regenerating the registered All Aboard job with
  `SNAPBACK_OUTBOUND_ACTIONS=1`,
  `node scripts/check-data-tier-corpus-exemplar.mjs` exited 0.
- Temporarily changing the expected message substring to
  `outgrew the IR: conditional writes BROKEN` made that checker report the
  missing class-specific text and exit 1. Restoring the expectation returned
  the checker to exit 0.
- `./ref-check --verbose` exited 0: 225 LLP docs, 4,809 refs in 9,598 files,
  0 errors, 0 unchecked.

The exact full-suite command was also attempted from the absent-manifest
state under the repository's Node 24 engine. It no longer fails on gate (c),
but this checkout has an independent pre-existing red in
`schema-reference-type-flow.test.mjs`: the test expects the newly supported
`structured_stored_value_v1` schema to be refused (`generated.ok === false`),
while generation succeeds. `structured-stored-values.test.mjs` has the same
stale expectation when run alone. Thus this lane proves removal of the
fresh-clone dependency but cannot honestly record an observed exit 0 for the
entire package command on this base revision. Likewise, the full
`scripts/check-generated-artifacts` command is independently baseline-red
before reaching All Aboard at the known stale signed trusted-composition
activation for `demos/latency-kanban`; the moved checker was therefore run
directly against the regenerated All Aboard closure for its green/red proof.
