# LLP 0319: One query constructor

**Type:** RFC
**Status:** Withdrawn
**Systems:** Developer experience, Code generation, Authoring surface,
Guide, Agent experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-27
**Revised:** 2026-08-27 (b — **Withdrawn** by the author after round 1 of
`llp-super-refine`; see Withdrawal below. Both families returned NOT READY
(codex 2 MATERIAL / grok READY) and the defects are not revisable without
replacing the proposal.) 2026-08-27 (a — Draft → Review at llp-super-refine
loop start, the one authorized transition)
**Related:** LLP 0020, LLP 0004, LLP 0114, LLP 0118, LLP 0146, LLP 0127,
LLP 0259, LLP 0318, LLP 0320, LLP 0323

## Withdrawal (2026-08-27)

The one cross-family split in the batch, resolved against the
proposal. Grok returned READY; codex showed the premise is false: the
thirteen query flavors are not a flattened cross-product but separate
closed validators with distinct field sets, fixed platform argument
schemas, visibility rules, and — decisively — different normalized plan
kinds. `defineJobStatusQuery` and `definePushLedgerQuery` emit
`jobStatusPlan` and `pushLedgerPlan`, not an application-table `plan`,
so they cannot be `defineQuery` recipes.

The five exported `*_SPEC_FIELDS` constants that made a mechanical merge
look plausible cover only the generic query/JS-query/mutation/action
forms. If the flavors are genuinely different concepts, thirteen names
is the correct answer and the naming was never the defect; a facade over
separate validators relocates the complexity rather than removing it.

This document is retained unrevised as the record of the proposal and
its refutation. The reviews are the durable artifact:
[codex](./reviews/0318-one-authoring-profile.codex.md) /
[grok](./reviews/0318-one-authoring-profile.grok.md) for the
authoring-surface cluster,
[codex](./reviews/0322-tiered-diagnostic-codes.codex.md) /
[grok](./reviews/0322-tiered-diagnostic-codes.grok.md) for the
size-and-hygiene cluster, with the run journal at
[`0318-one-authoring-profile.run.md`](./reviews/0318-one-authoring-profile.run.md).

Everything below is the original text as reviewed. Its claims were not
corrected; several are false and are enumerated above.

## Summary

`packages/snapback-codegen/define.mjs` exports **140** names, of which
**31** are `define*` constructors. Thirteen of the 31 are query flavors.
They are not thirteen concepts; they are roughly three orthogonal axes
flattened into a name list, so the vocabulary grows multiplicatively
while the concept count grows additively.

This RFC proposes collapsing the query family to **one** `defineQuery`
whose axes are named options, and applying the same treatment to the
mutation family. The power is unchanged. The number of names an author
must know, and the number of names an author can pick *wrong*, drops by
roughly an order of magnitude on the query side.

Confidence in the direction is **0.85**. Confidence that the collapse is
mechanical is lower — §3 lists the flavors whose spec fields are not
obviously unifiable.

## 1. The inventory

Query flavors currently exported from
`packages/snapback-codegen/define.mjs`:

```
defineQuery                  defineLiveQuery
defineJsQuery                defineJsLiveQuery
defineSearchQuery            defineLiveSearchQuery
defineVectorQuery            defineGraphQuery
defineRelationalQuery        defineBoundedChildrenQuery
defineSnapshotBatchQuery     defineJobStatusQuery
definePushLedgerQuery
```

The remaining `define*` constructors:

```
defineSchema        defineTable         defineAuth
defineMutation      defineJsMutation    defineAction
defineCron          defineRoutes        defineConfig
defineEphemeral     defineCommand       defineMediaCommand
defineSurface       defineAssetUpload   defineVisibilityOverride
defineMaintainedProjection              definePushSeam
defineWriteWithActivity
```

Total: 31 constructors, 140 exported names.

## 2. The axes

Read as a cross-product, the query family decomposes:

| Axis | Values | Currently spelled as |
|---|---|---|
| Implementation | declarative plan · JS handler | absence/presence of `Js` in the name |
| Reactivity | one-shot · live | absence/presence of `Live` in the name |
| Access shape | scan/index · search · vector · relational · graph · bounded-children | a distinct constructor each |
| Result shape | rows · snapshot batch | `defineSnapshotBatchQuery` |

`defineJobStatusQuery` and `definePushLedgerQuery` are a different kind
of thing: they are *domain* queries over engine-owned state, not new
access shapes. They are named-vocabulary conveniences over an existing
mechanism, and they are the clearest evidence of the growth pattern this
RFC is trying to stop — each new subsystem has been adding its own
constructor rather than a value to an existing axis.

## 3. Proposal

One constructor:

```js
defineQuery({
  args:   { /* ... */ },
  live:   true,                        // reactivity axis
  source: 'handlers.mjs',              // implementation axis; omit for a plan
  via:    { search: { index: 'by_body' } },   // access-shape axis
  reads:  ['todos'],
  result: v.object({ /* ... */ }),
})
```

Rules:

1. **Absence is the default.** No `live` → one-shot. No `source` → the
   declarative plan path (`table`/`filter`/`order`/`index`, unchanged).
   No `via` → scan/index.
2. **`via` is a closed tagged union**, one key per access shape:
   `search`, `vector`, `relational`, `graph`, `boundedChildren`. Adding
   an access shape adds a union member, not a top-level name.
3. **Illegal combinations refuse at generate time**, with the same
   `SNAPBACK_*` diagnostics the separate constructors emit today. A
   collapsed constructor must not turn a compile-time refusal into a
   runtime surprise — that would trade the wrong thing for brevity.
4. **The mutation family gets the same treatment**: `defineMutation`
   with an optional `source`, absorbing `defineJsMutation`, and
   `defineWriteWithActivity` becoming an option rather than a name.
5. **Domain queries become recipes, not constructors.**
   `defineJobStatusQuery` and `definePushLedgerQuery` become documented
   `defineQuery` shapes in the guide, or thin helpers that *return* a
   `defineQuery` call rather than being peers of it.

The `*_SPEC_FIELDS` constants already exported
(`QUERY_SPEC_FIELDS`, `JS_QUERY_SPEC_FIELDS`, `MUTATION_SPEC_FIELDS`,
`JS_MUTATION_SPEC_FIELDS`, `ACTION_SPEC_FIELDS`) suggest the field sets
are already enumerated data rather than ad-hoc object literals, which is
what makes a mechanical merge plausible. That should be verified before
this RFC is costed — it is the single assumption the migration estimate
rests on. `[inferred]`

## 4. What this does not do

- **It does not remove capability.** Every access shape survives as a
  `via` member. If a shape cannot be expressed as one, that shape is a
  genuine second concept and keeps its constructor — the goal is one
  constructor per *concept*, not one constructor total.
- **It does not touch the expression IR.** Whether the declarative plan
  path should exist as an authored surface at all is
  [LLP 0320](./0320-plan-ir-as-compiler-output.rfc.md). If 0320 is
  adopted, the implementation axis of §2 disappears and this collapse
  gets simpler; the two RFCs compose but neither depends on the other.
- **It does not reduce the 140 exported names by itself.** Most of the
  140 are the expression IR (`add`, `eqv`, `coalesce`, `letBind`, …) and
  the `is*Def` predicates. See LLP 0320 and
  [LLP 0323](./0323-tiered-public-surface.rfc.md).

## 5. Open questions

- **OQ1 — Are the spec field sets actually disjoint-and-mergeable?**
  The `*_SPEC_FIELDS` constants make this checkable in an afternoon. If
  two flavors use the same field name with different meanings, the merge
  needs a rename and the migration stops being mechanical.
- **OQ2 — Do the live variants differ beyond a flag?** A live query has
  invalidation, delta candidacy, and resumable-snapshot properties a
  one-shot does not. If `live: true` silently changes what other fields
  mean, a flag is the wrong shape and the split is real.
- **OQ3 — Is `via` the right factoring, or is access shape really two
  axes** (index strategy × result semantics)? `defineSnapshotBatchQuery`
  fits badly in `via` and may belong on a `result` axis.
- **OQ4 — Deprecation window.** Keep the 13 names as thin aliases for a
  release, or cut them? LLP 0041's publication posture ("no current users
  depend on stability") argues for cutting.

## 6. Cost

Small-to-moderate and almost entirely in codegen plus the demo/fixture
corpus. The guide side is a net deletion. The risk is concentrated in
OQ1/OQ2: if the flavors turn out to be genuinely different validators
wearing similar names, this becomes a refactor rather than a rename.

## 7. Why it matters beyond aesthetics

The cost of a large constructor vocabulary is not typing. It is that a
cold agent under the LLP 0259 read budget must decide *which* of thirteen
to use before it has read the page that explains the difference, and a
wrong pick fails late — at generate time or, worse, as a capability that
silently is not live. Every axis added to a flattened name list doubles
that decision surface. One constructor with named options moves the
decision from "recall the right name" to "set the field you care about,"
which is a decision an agent can make from the type alone.
