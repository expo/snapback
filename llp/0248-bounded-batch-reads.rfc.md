# LLP 0248: Bounded batch reads

**Type:** RFC
**Status:** Accepted
**Systems:** Application data API, Runtime, Storage, Authorization, Code
generation, Handler authoring, Diagnostics, Performance, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-12
**Revised:** 2026-08-15 (Rollout 5 implementation note: added the flag-only
generation-time N+1 diagnostic). 2026-08-12 (author acceptance: Charlie
Cheever accepted this RFC at the exact revision bound by the final GPT-5.6 Sol
round-3 READY artifacts, SHA-256
`80bfed8960746cc53f99dd8246ea659f8a3f183a322cc3543a1f7bbcc9367022`; see
`llp/reviews/0245-0249-single-family-super-refine.md`). 2026-08-12 (round-2
revision: separated request/response overflow; removed public logical-key
digests). 2026-08-12 (round-1 revision: moved dynamic unique-key validation to
the runtime boundary, canonicalized keys by manifest order, excluded
non-participating unique-where-present keys, and bounded public size/chunk
facts). 2026-08-12 (entered an author-invoked, single-family GPT-5.6 Sol xhigh
refinement loop; initial Draft came from Clique handler-side N+1 evidence and
defined the imperative fallback beside LLP 0242)
**Related:** LLP 0003, LLP 0004, LLP 0007, LLP 0008, LLP 0053, LLP 0080,
LLP 0108, LLP 0110, LLP 0120, LLP 0146, LLP 0198, LLP 0231, LLP 0237,
LLP 0240, LLP 0242

## Summary

Snapback should provide typed, visibility-aware, same-snapshot batch reads for
exact ids and complete unique-index keys inside handlers. This removes repeated
host round trips and app-written hydration loops without adding a general query
language or pretending an imperative handler is a declarative projection.

V1 adds `ctx.db.getMany` and `ctx.db.uniqueMany` with explicit finite bounds,
stable input/output correspondence, deduplication, one captured dependency
summary, composed table visibility, and inspectable cost facts.

## Motivation

The Kimi Clique feed implementation needed roughly five `ctx.db` host calls per
card to hydrate author, reply, media, and reaction facts. LLP 0242 makes common
whole-query feed/children/activity/aggregate shapes declarative, but intentionally
leaves arbitrary transformations in JavaScript. That escape hatch should not
turn every repeated exact lookup into N host transitions.

Batch reads are narrower than joins: the handler supplies every id/key, the
result keeps positional correspondence, and no hidden scan, fan-in, or
pagination occurs.

## Constraints

- Every read executes against one invocation snapshot/transaction.
- Table visibility and authorization compose per requested row; hidden and
  absent remain indistinguishable where single `get` already requires that.
- Inputs and result size are bounded and included in handler cost/capture facts.
- Batch operations do not grant declarative-plan, live-precision, local-
  execution, or retention eligibility.
- Required unique indexes and complete key prefixes are checked at generation.

## Decision

### D1. Exact-id batch reads

Add:

```ts
const authors = await ctx.db.getMany("users", authorIds);
```

`authorIds` is a readonly array of generated table ids, length `0..256` in the
portable v1 profile. The result has the same length and order, with each entry
`Document<"users"> | null`. Duplicate ids are fetched/authorized once but
repeated at every corresponding output position. Empty input returns empty
without a host transition.

For restricted tables, a hidden row returns `null`, exactly like the accepted
single-get behavior; no per-item reason or aggregate hidden count is exposed.

### D2. Complete unique-index batch reads

Add:

```ts
const profiles = await ctx.db.uniqueMany(
  "profiles",
  "byHandle",
  handles.map((handle) => ({ handle })),
);
```

The declared unique index manifest generates an exact runtime validator: every
element is a closed object with the exact component names in any construction
order, then canonicalized in index order before storage. Generation refuses an
unknown/non-unique index or malformed literal; runtime refuses malformed dynamic
keys. Prefixes, ranges, ordering, predicates, and non-unique indexes point to
LLP 0242/query builder. Results match `getMany` order/null semantics.

For LLP 0007 indexes whose manifest says `whereApplicable: true`, every
component must be present, non-null, and type-valid. An absent or null component
does not participate in the uniqueness invariant and therefore refuses before
storage work rather than pretending it addresses one row. This rule applies to
both single-field and compound optional indexes.

### D3. One host operation, one authoritative snapshot

The JS runtime sends one bounded request descriptor. Storage resolves all
distinct ids/keys inside the invocation's existing pinned read snapshot and
composes table visibility before producing results. An implementation may use
one SQL statement, a temporary values relation, or bounded internal chunks, but
the public receipt reports one logical batch plus physical statement/chunk
counts. It never issues one JS↔host round trip per item.

Malformed input, item-count/canonical-input-byte overflow, generation/
index mismatch, or policy-plan failure refuses before storage. Response-byte
overflow is checked after snapshot-bound authorized reads and canonical
serialization but before any result release. Neither phase returns a partial
array; ordinary hidden/not-found entries remain `null`.

### D4. Dependency and cost evidence remain conservative

Internal OCC/invalidation evidence records canonical logical keys under
one batch. Public diagnostics expose only count/byte facts, never keys or a
stable digest/commitment. Dependencies remain no weaker than equivalent
individual reads.

Generated runtime profiles publish max items, max canonical input bytes,
target support, and worst-case policy probes. Dev diagnostics flag repeated
same-table `get`/complete-unique lookup loops that could collapse into a batch,
but never rewrite them automatically.

Public statement/chunk counts depend only on request size/bytes and target
profile, never hidden matches. The profile bounds complete host-response bytes;
overflow refuses the batch without a partial prefix.

### D5. Hydration stays application code

V1 does not accept a projection callback or return nested joined objects. The
handler maps positional results into its frozen result contract. For recurring
declarative shapes, `projection.children/activity/feed` remains the preferred
surface because it can carry cost, live, cursor, and retention facts that a
JavaScript hydration loop cannot.

## Compatibility and migration

The methods are additive to the generated handler context. Existing individual
reads retain behavior. An optional authoring suggestion may identify a safe
mechanical batching opportunity, but application order/error semantics make
automatic rewriting out of scope.

## Rollout

1. Freeze request/result schemas, bounds, visibility/null semantics, and target
   capability ids.
2. Implement `getMany` locally with duplicate/order/snapshot/visibility tests.
3. Add `uniqueMany` with generation-time complete-unique-index validation.
4. Add Workerd/hosted twin or declare target capability gaps before generation.
5. Add captured-dependency/cost inspection and N+1 diagnostics. Implemented
   2026-08-15; see the Rollout 5 implementation note below.
6. Rerun the Clique feed hydration control against LLP 0242's declarative feed
   where applicable; publish round-trip/read-amplification measurements.

## Acceptance

- 256 requested ids require one JS↔host call, preserve order/duplicates, and
  return hidden/missing rows as indistinguishable nulls.
- A concurrent write cannot make members of one batch come from different
  snapshots.
- An unknown/non-unique index or statically malformed literal key refuses at
  generation; a malformed dynamic key refuses before storage work, each with an
  admitted alternative.
- Single and compound `whereApplicable` unique-index vectors prove absent/null
  components refuse and cannot become non-unique lookups.
- A policy failure or malformed request yields no partial result and leaks no
  hidden-row position beyond the ordinary null contract.
- Captured read/OCC/invalidation behavior is no weaker than the equivalent
  individual reads.
- The published maximum canonical input bytes and maximum returned host-
  response bytes pass exact-boundary/one-byte-over vectors with no partial
  result, and public chunk facts are unchanged by hidden-row matches.
- Local and hosted targets agree byte-for-byte or generation refuses the
  unsupported target.
- The Clique control records host-call and latency reduction without claiming
  declarative live/local/retention eligibility.

## Risks

- Batch APIs can become disguised joins. Exact ids and complete unique keys are
  the v1 cutline.
- Large `IN` plans can vary by engine. The portable bound is conservative and
  physical statement/chunk facts remain observable.
- Null hides authorization and absence intentionally but can complicate app
  debugging. Authenticated developer inspection may report aggregate policy
  facts without identifying hidden keys to application code.

## Addendum — experimental capability introduction (2026-08-12)

`bounded_batch_reads_v1` is registered `unregistered → experimental` on the
`local-dev-sqlite-ibex` target with this RFC's implementation landing (LLP
0134 same-commit introduction act; record
`tests/acceptance/maturity/bounded-batch-reads-2026-08-12.introduction.json`).
Rollouts 1–3 plus cost/dependency evidence and the Rollout 5 N+1 diagnostic are
implemented; the Cloudflare DO and remote-service targets carry explicit
capability gaps; the measurement rerun remains open
(`issues/shelved/20260812-0247-0248-measurement-reruns.md`).

## Addendum — invocation-snapshot scope (2026-08-12)

Implementation orientation against LLP 0003's execution-semantics record
clarifies the Constraints bullet "Every read executes against one invocation
snapshot/transaction": the query, live-query, and detached-mutation lanes pin
one WAL snapshot for the whole invocation, while the mutex-held mutation lane
is per-read snapshot-atomic with commit-time captured-read validation rather
than one frozen invocation snapshot. The binding form for this RFC is the
Acceptance criterion: all members of **one batch** resolve inside one pinned
read snapshot on every lane, so a concurrent write cannot split a batch. This
addendum records scope, not a design change.

## Implementation note — Rollout 5 N+1 diagnostic (2026-08-15)

Rollout 5's N+1 signal lives in `snapback-codegen`, where the handler source,
schema, and declared unique-index facts already meet. It emits the advisory
`SNAPBACK_AUTHORING_N_PLUS_ONE_BATCH_READ` when static analysis finds a
literal same-table `ctx.db.get`, or a complete lookup through a declared
total unique index ending in `.first()`, executed unconditionally on each loop
iteration. Literal arrays and simple C-style loops with literal initial value,
bound, and step carry a known cardinality; a known loop below three iterations
is quiet, while an unknown cardinality is eligible only for an unconditional
call site. Calls nested under an `if`, `switch`, ternary, or logical guard do
not inherit the enclosing loop cardinality. Conditional unique indexes whose
manifest carries `whereApplicable` are also quiet because `uniqueMany` refuses
their absent or null components and is not behaviorally equivalent.

This is deliberately a flag-only authoring diagnostic. It suggests `getMany`
or `uniqueMany`, marks its remediation non-machine-applicable, and does not
rewrite the handler or add logic to the request/runtime read path. Already
batched calls, point reads outside loops, non-unique query chains, and loops
whose table is not one static literal do not fire. This conservative
proven-executions rule deliberately prefers missing an exotic batching shape
to warning on a correct pattern. The captured-dependency and cost evidence was
already shipped with Rollouts 1–3; the Rollout 6 measurement rerun remains
separate and open.

## Open questions

1. Is 256 the right portable maximum after SQLite and hosted measurements?
2. Should a later `requireMany` variant refuse on any null, or would its first-
   missing position become an existence oracle on protected tables?
3. Can exact composite primary keys share `getMany`, or should they remain
   `uniqueMany` for one grammar?

## Status

Accepted. This RFC defines two bounded host operations, not a fifth LLP 0242
projection node or a general join facility. Accepted by the author on
2026-08-12 at the revision bound by the final single-family GPT-5.6 Sol READY
review.
