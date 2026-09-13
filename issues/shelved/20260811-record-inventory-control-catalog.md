# Control-catalog frozen record carries ignored HEAD/dirty provenance and declares the wrong projection

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 4
**Confidence:** 5
**Systems:** Control catalog, Guide, Generated records, Pre-push gates
**Date:** 2026-08-11
**Drift gate:** `control-catalog`
**Related:** LLP 0232 D-2; `issues/shelved/20260811-record-inventory-summary.md`

## Problem

`node scripts/generate-control-catalog.mjs` regenerates in 0.60 seconds, but
the committed JSON contains exact-checkout provenance that changes even when
the 152 semantic catalog entries do not. The gate's declared record inventory
also names a nonexistent Guide file and omits the projection the generator
actually owns.

Registered records:

- `control-catalog/generated/control-catalog.v1.json`
- generated blocks in `guide/operating/host-ops.md`
- declared `guide/reference/control-catalog.md` (the file does not exist)

Actual third projection:

- `guide/operating/agent-controls.md` (`CONTROL CATALOG INVENTORY`)

## Offending inputs and fields

`control-catalog/generated/control-catalog.v1.json` carries:

- `buildIdentity.sourceCommit`
- `buildIdentity.dirty`
- `generatedAtCommit`

The current committed record even says `dirty: true`. The check path explicitly
removes `buildIdentity` and `generatedAtCommit` before comparing the semantic
projection, while `catalogDigest` already binds the normalized entries. These
fields therefore add rebase/worktree churn without contributing freshness.

The registry's `recordPaths` and `triggerRules.files` name
`guide/reference/control-catalog.md`; `scripts/generate-control-catalog.mjs`
instead writes the generated inventory block in
`guide/operating/agent-controls.md`.

## Proposed remedy

Per LLP 0232 D-2:

1. Remove `buildIdentity.sourceCommit`, `buildIdentity.dirty`, and
   `generatedAtCommit` from the committed semantic record, or replace them with
   a content-derived identity that is part of `catalogDigest`'s documented
   closure.
2. Update `schemas/control-catalog.v1.schema.json` and generator fixtures so
   exact commit identity is not required for a source projection.
3. Replace the nonexistent `guide/reference/control-catalog.md` registry entry
   and trigger with `guide/operating/agent-controls.md`.
4. Add gate-disjoint-rebase and direct-projection-mutation fixtures.

## Acceptance

- Regeneration before and after an unrelated commit is byte-identical.
- The catalog JSON and both generated Guide target files are declared records.
- Direct edits to either generated Guide block select and fail the owning gate.
- A semantic entry change still changes `catalogDigest` and all affected
  projections.

