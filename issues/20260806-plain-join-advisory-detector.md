# Prove plain-join equivalence before emitting the codegen advisory

**Status:** Open
**Impact:** 3
**Urgency:** 2
**Ease:** 2
**Confidence:** 5
**Systems:** Code generation, Diagnostics, Relational queries, Developer experience, Testing
**Date:** 2026-08-06
**Related:** LLP 0178 §1–§4, LLP 0187 T2 and Open Question 3,
`guide/backend/relational-queries.md`

## Problem

LLP 0187 identifies a `defineJsLiveQuery` body that hand-rolls a plain join as
the canonical first authoring advisory. The advisory must fire only when the
handler is provably equivalent to the shipped `defineRelationalQuery` profile:
one bounded root iteration, exactly one keyed lookup into a distinct joined
table per root, a closed field projection, and no aggregation, self-join,
row-dependent branch, write, or other post-join behavior.

A body-only heuristic does not prove that equivalence. The relational profile
also requires facts outside the handler AST: an admitted root index, no
residual root filter beyond declared visibility, a declared unique joined
index whose complete ordered key is exactly the join key, compatible key
types, explicit visibility for both sources and the output, root-index order,
and a projection composed only from admitted scalar leaves or literals.
`ctx.db.get(table, id)` is not itself a proof that the joined table has the
declared unique index the relational authoring surface requires.

## Probe run on 2026-08-06

A TypeScript-AST probe scanned every `demos/**/functions.mjs` plus every
existing JavaScript source named by `guide/guide-manifest.generated.json`
(112 distinct source files, 63 direct `defineJsLiveQuery` definitions). Its
strict pre-schema candidate required no authored args, exactly one root query,
one joined `get`, one loop, and zero writes, branches, aggregate/search calls,
or result sorting. It found **zero candidates**.

The requested falsification targets confirm why widening would be noisy:

- `demos/relay-room-bakeoff/snapback-expo` now has no
  `defineJsLiveQuery`; it composes declarative single-table live queries on the
  client, so there is no handler advisory to emit.
- Tandem's `listInbox` has three table queries, two point gets, two loops, five
  branches, aggregate/search operations, and a sort. `getConversation` has one
  query, two gets, a loop, branches, and result aggregation. `listMessages`
  has two queries, three gets, two loops, branches, reaction aggregation, and
  reply-preview logic. None is a plain join.
- The historical `demos/messaging-snapback.myConversations` near-match has one
  root query, one point lookup, and one loop, but it also filters the root from
  an authored argument, conditionally skips missing joined rows, and sorts by
  a joined-side field. V1 `defineRelationalQuery` admits no authored args or
  residual root filter and orders by the root index, so advising a mechanical
  conversion would be false.
- Seven corpus handlers matched the loose “one query + one get + one loop”
  signature. Every one had a branch, a sort, authored args, aggregation, or a
  combination of them. This is the false-positive boundary the strict detector
  must preserve.

The probe therefore demonstrated a zero-noise negative corpus but no positive
corpus example on which to prove end-to-end semantic equivalence. Shipping a
rule that remains silent everywhere would not route the replicated miss;
loosening it enough to hit the bakeoff handlers would knowingly violate LLP
0187's precision bar. No advisory ships from this attempt.

## Suggested implementation shape

Build the detector at the existing inline-handler AST seam and join it to the
already-evaluated schema facts before emitting anything. Admit only a closed
syntax profile whose complete body and schema jointly prove:

1. one bounded, index-served root read with no residual filters or ordering
   outside the relational profile;
2. one distinct joined-table lookup per root through a declared unique index
   whose exact key fields and types match the root fields;
3. explicit source/output visibility derivable without widening what the JS
   handler currently exposes;
4. an inner/left absence shape and projection representable exactly by
   `defineRelationalQuery`; and
5. no helper call, branch, write, aggregation, self-join, extra table access,
   or post-projection transform.

Add a purpose-built positive fixture that is first proven to compile as an
equivalent `defineRelationalQuery`, paired negative fixtures for every rejected
construct above, and retain the entire demo/guide-source scan as a zero-false-
positive regression. The resulting LLP 0178 advisory must remain a warning,
never change generation admission, and carry a `guidePointer` to
`backend.relational-queries`.
