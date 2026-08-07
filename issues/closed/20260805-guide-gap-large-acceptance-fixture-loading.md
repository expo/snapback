# guide-gap: no paved recipe for loading a >1,024-row acceptance fixture

**Date:** 2026-08-05 · **Found by:** LLP 0183 Stage 0.5 control, Lane 1
(diary 0061; `demos/zerobugs/control/PLAN.md` §Guide gaps encountered)

The guide documents the versioned-seed 1,024-effect ceiling
(`SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED`) and the general bounded-mutation rule,
but has no intent-indexed page for the obvious next question: *how do I load a
deterministic acceptance fixture bigger than the seed ceiling?*

What Lane 1 needed and had to assemble from repository folklore:

- the ≤900-row `ingestFixtureBatch` JS-mutation pattern (found only in
  `demos/zero-bakeoff/apps/fleet-observatory/snapback/functions.mjs`);
- an acceptance-only gate for that mutation in a sessions app (empty-of-source
  refusal + completion sentinel + session requirement);
- dev-session minting for the loader: `session mint` is an admin-gated
  host-op, and the managed admin-token carrier is named by the dev readiness
  descriptor's `adminTokenFile` — none of which is connected in one guide
  page;
- the canonicalization rule that the query surface returns unset optional
  fields as explicit `null` (digest/comparison code must treat null and
  absent as one form).

Suggested absorption (LLP 0061 §5): one guide page under acceptance testing —
"Loading large deterministic fixtures" — covering the batch-ingest pattern,
its auth gating, loader session minting via the readiness descriptor, and the
null/absent canonical form; plus a capability-index row pointing at it.

## Resolution

**Absorbed 2026-08-07** (LLP 0061 §5). Added
`guide/testing/large-fixtures.md` ("Loading large deterministic fixtures"),
covering all four folklore items in one intent-indexed page: the ≤900-row
batch-ingest mutation (transcluded from
`demos/zero-bakeoff/apps/fleet-observatory/snapback/functions.mjs`), the
sessions-app acceptance gating (empty-of-source refusal + completion
sentinel + session requirement, transcluded from
`demos/zerobugs/control/snapback/functions.mjs`), loader session minting via
the readiness descriptor's `adminTokenFile` carrier (transcluded from
`demos/zerobugs/control/scripts/load-fixture.mts`), and the null/absent
canonical form (verified against `src/storage.rs`: an unset optional field
is stored and returned as explicit `null`). Linked from the guide index, from
`backend/versioned-seeds.md` at the `SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED`
refusal, and from `backend/mutations.md` §Bound and resume bulk work. Added
capability-index row `testing.large-fixtures` (witness: `fixtureLoadPlan` in
the loader script) with the grep vocabulary (`large fixture`, `bulk load`,
`seed ceiling`, `ingestFixtureBatch`, `SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED`),
and retrieval-eval seed case 15.
