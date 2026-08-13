---
title: Relational queries (bounded joins)
id: backend.relational-queries
order: 26
audience: agent-first
capabilities: [backend.relational-queries]
authorities: [llp/0080-portable-relational-queries-and-projections.rfc.md, llp/0110-bounded-children-and-activity-patterns.spec.md, llp/0065-generated-data-pattern-soundness.rfc.md, packages/snapback-codegen/define.mjs]
examples: [packages/snapback-codegen/relational-authoring.test.mjs, packages/snapback-codegen/relation-activity-authoring.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-05
reviewed-authorities-digest: sha256:c762f859e8d1f553c899de48d81ac1020929f6cd618b04e514ec8b100ab77bc1
---

# Relational queries (bounded joins)

> **Local target only.** Relational queries require the
> `relational_query_v1` target capability — **stable** since LLP 0080/0081
> flipped to Implemented (2026-07-26); no experimental acknowledgment is
> emitted or required. A target without the executor (for example the
> Cloudflare path) refuses at generation with a machine-readable capability
> gap, never at runtime.

Use `defineRelationalQuery` for the common "each row plus its one related
row" read: a bounded two-source equi-join with an explicit projection. It is
a closed plan — no SQL text, no callbacks — and every visibility fact is
declared, never inferred from field names or read sets.

## Recognize the messaging shape

A conversation list is the same shape as the books/authors example below:
make `conversationMembers` the bounded root, join its `conversationId` to a
declared unique conversation key, then project the conversation title and
membership facts. A message feed can likewise join messages to a distinct,
uniquely indexed sender table. Use `defineRelationalQuery` when the join is a
callable/live read, or `defineMaintainedProjection` when that same closed join
should be a transactionally maintained table.

Choose these declarations before hand-writing a `defineJsLiveQuery` for a
plain two-source join: codegen proves joined-side uniqueness, visibility, the
bounded root access, and target support. Stay with a bounded JS handler when
the result also needs grouping/aggregation, arbitrary post-join logic, more
than two sources, or a self-join. V1 explicitly refuses the same table as
both `root` and `joined`; reply-preview self-joins and reaction counts are
missing capability, not hidden relational options.

> **Coming from Convex/Supabase?** Convex joins are JS-side traversal or
> indexed lookups; Supabase exposes foreign-key-derived nested selection —
> see
> [Reading related data without hand-writing the wrong join](../recipes/coming-from-convex-and-supabase.md#relational-queries)
> for the bounded two-source `defineRelationalQuery` vs. `defineMaintainedProjection`
> translation and the multi-way/self-join GAP.

```js source=packages/snapback-codegen/relational-authoring.test.mjs
export const booksWithAuthors = defineRelationalQuery({
  root: schema.tables.books,
  joined: schema.tables.authors,
  join: [{ root: 'authorSlug', joined: 'slug' }],
  kind: 'inner',
  visibility: {
    root: { kind: 'owner', field: 'ownerId' },
    joined: { kind: 'owner', field: 'ownerId' },
    output: 'owner',
  },
  projection: {
    title: { root: 'title' },
    authorName: { joined: 'name' },
    score: { root: 'score' },
    available: { root: 'available' },
    shelf: { literal: 'fiction' },
    featured: { literal: true },
    edition: { literal: 1 },
    note: { literal: null },
  },
  take: 50,
  rootIndex: 'by_owner_title',
  joinedIndex: 'by_slug',
  retention: 'opaque-authorized-snapshot-v1',
});
```

The shape is closed and proven at authoring time:

- **Exactly two sources.** One root table and one joined table, with 1–4
  equality pairs. Join keys must share one admitted type — string,
  principal, reference id (same target table), integer, or boolean. A null
  key never matches.
- **The joined side must be provably unique.** `joinedIndex` names a
  declared `unique` index whose complete ordered key is exactly the joined
  field sequence — that declaration is the cardinality proof. Two joined
  rows under one key at runtime is a storage-invariant refusal, never a
  silent first-row pick.
- **Root access is index-served.** `rootIndex` names a declared index; for
  an owner-visible root its leading field is the owner field. Results order
  by the index's field sequence (ties broken deterministically by `_id`),
  and `take` (0–1024) bounds consumed authorized roots. v1 does not accept
  extra root filters yet.
- **Visibility is explicit on both sources and the output.** Each source
  declares `{ kind: 'owner', field }` or `{ kind: 'public-read' }`. The
  output must be declared too, and it can never be broader than a
  contributing source: owner sources force `output: 'owner'` (the generated
  function requires authentication), and only all-public sources may
  declare `output: 'public-read'`. A `left` join is refused when the only
  owner evidence sits on the omissible joined side.
- **Invisible means absent.** A joined row the caller cannot see behaves
  exactly like a missing row: `inner` omits that root (the page may come
  back short — it is not refilled), and `left` returns the root with null
  joined leaves. Callers cannot distinguish the two cases.

Live subscriptions deliver whole-result replacement (`live_replace`): a
commit touching either source re-runs the query. No incremental delta or
skip proof is claimed, matching LLP 0080's deliberately conservative v1.
A relational plan is never `authorityIndependent` — public plans stay
authority-partition-scoped — and retention is default-deny with a closed
vocabulary. `retention: 'none'` is the default. An owner-visible
plan may declare `retention: 'opaque-authorized-snapshot-v1'`: the
projected result is retained as an opaque authorized snapshot under the
authenticated lease path (the client decodes it; it never re-executes the
join over retained rows), and the continuation cursor never rides the
lease envelope. An all-public plan cannot declare it — anonymous results
have no admissible v1 retention, refused at generation and again at load
(`SNAPBACK_AUTH_UNDECLARABLE_RETENTION`). The capability manifest records
the admitted classes under `relationalQueries.retention`. (Design
reference: LLP 0080's 2026-08-03 dated amendment, landed with Accepted
LLP 0166, specifies the third owner-issued class
`result-transform-snapshot-v1`. Selecting it is an owner reclassification:
it rotates the plan identity and admits the shipped closed result-transform
evaluator only after the D7 carrier gate; existing opaque records are never
relabelled in place.)

## Pagination

Every relational query accepts one implicit argument, `cursor`. When a page
consumes its full `take` of authorized roots, the response carries an opaque
versioned continuation cursor next to `rows`; pass it back as
`{ cursor }` to resume from the last consumed root. The contract:

- **`take` counts consumed roots, not emitted rows.** An `inner` join can
  emit a short — even empty — page whose continuation still progresses, and
  no page is refilled.
- **A short page is terminal.** A page that consumed fewer than `take`
  roots returns no cursor; `take: 0` returns an empty page with no cursor
  and consumes nothing.
- **Cursors are bound, not positional.** The cursor binds the app, the
  plan, the argument set, the order schema, and the caller's authority
  partition. A malformed, tampered, cross-plan, cross-argument,
  cross-user, or stale-authority cursor — including one presented after an
  authorization change — is refused with `SNAPBACK_RELATIONAL_CURSOR_INVALID`
  (HTTP 400), never silently repositioned, and every refusal class answers
  with byte-identical output.
- **Pages are not snapshot-consistent with each other.** Continuation
  guarantees no skipped and no duplicated root among roots untouched by
  concurrent mutations; a concurrently mutated root may move relative to
  the boundary.

## Maintained projections

`defineMaintainedProjection` turns the same closed join into a durable
output table the runtime maintains inside **every source mutation's own
commit** — source and projection either commit together or not at all,
with no background repair and no separately visible projection version.
A projection has no function carrier, so the generated bundle records its
relational-engine dependence as a schema-level `relational_query_v1`
requirement (derived from the projection's presence — never authored):
a target without the engine refuses at generation and admission, not at
activation.

```js source=demos/competitive-checkpoint/snapback/functions.mjs
export const conversationCardsProjection = defineMaintainedProjection({
  id: 'conversation-cards',
  root: schema.tables.conversations,
  joined: schema.tables.models,
  output: schema.tables.conversationCards,
  join: [{ root: 'model', joined: 'slug' }],
  // Left: a conversation whose model is not registered still projects a
  // card with a null modelName; the owner evidence rides the root.
  kind: 'left',
  visibility: {
    root: { kind: 'owner', field: 'ownerId' },
    joined: { kind: 'public-read' },
    output: { kind: 'owner', field: 'ownerId' },
  },
  projection: {
    ownerId: { root: 'ownerId' },
    title: { root: 'title' },
    modelName: { joined: 'displayName' },
  },
  rootReverseIndex: 'by_model',
  fanOutLimit: 64,
  sharedFanOutDisclosure: true,
});
```

The contract, all enforced at generation and re-proved at activation:

- **The output table is maintenance-only.** Any function that writes it is
  refused; a closed HostPlan may read an owner-visible output only with
  its visibility predicate composed (`eq(ownerField, authUserId())`), and
  opaque JS handlers may not touch it at all. Chains and diamonds —
  projections sourcing another projection's output — are refused.
- **Row identity is key-stable.** `outputKey` is the root `_id` (default)
  or `{ index }` naming a declared unique root index whose fields become
  immutable: a mutation that moves a key field is refused, and the same
  output key owns the same row `_id` across delete/re-insert and rebuilds.
- **Fan-out is bounded and declared.** `rootReverseIndex` must lead with
  the root join fields; `fanOutLimit` (1–1023) counts *every*
  reverse-index entry for a joined key. A write that would exceed it — or
  push a mutation past the 1,024-write bound including projection writes —
  refuses whole with `SNAPBACK_PROJECTION_FANOUT_EXCEEDED`.
- **Shared-source coupling is explicit.** A public joined source feeding
  an owner output couples callers through the shared `fanOutLimit`;
  declare `sharedFanOutDisclosure: true` or generation refuses with
  `SNAPBACK_RELATIONAL_DISCLOSURE_REQUIRED`.
- **Unchanged bytes cost nothing.** An affected output row whose
  recomputed logical bytes are unchanged issues no write; repeated writes
  to one source row coalesce to one evaluation against the final snapshot.

Author-supplied root filters beyond visibility remain specified by
LLP 0080 but are not yet authorable: v1 `defineRelationalQuery` admits no
residual root filters.

## Design reference: one bounded child page

`defineBoundedChildrenQuery` is present for the LLP 0110 conformance program.
A contributor source build advertises it experimentally only when the tracked
atomic local carrier matches the receipt and exact implementation bytes, and a
requiring artifact acknowledges it. Public runtime packages, remote services,
and hosted targets retain a structured GAP: the public package loader does not
yet verify `PackageCapabilityAttestationV1`. Do not select it for a deployed
package based on source-build code presence.

The source-build local executor is not declaration-only:
`node demos/signal-desk/tests/snapback-extras.mjs` exercises owner,
invisible, missing, and inactive parents plus a two-page `sbbc1` traversal
against the persisted server. That local proof is green; the remaining GAP
is the Spec's publication lifecycle and cross-target evidence.

The reviewed declaration makes the security and work proof explicit:

- the parent visibility is `owner(field)` or `public-read`;
- the child relationship is a required typed parent id plus a required
  `v.relationIncarnationOf(...)` stamp owned by the framework;
- the named child index is exactly
  `[foreignKey, relationIncarnation, ...ascendingOrderFields]`;
- the child projection includes `_id` and every order field;
- `take` is 0–1024, with at most `take + 1` physical index entries examined;
  `take: 0` performs no child read;
- parent deletion retains but hides orphan children, and recreating the same
  application id cannot revive them;
- missing and invisible parents return the same discriminator row:
  `{kind: "absent", parent: null, children: [], continuation: null}`;
- visible pages use the AEAD-protected `sbbc1` continuation inside the
  computed row; the top-level query cursor remains absent; and
- only the cursor-free first page is `live_replace`. Cursor-bearing
  subscribe/resume refuses.

Central inserts, buffered handlers, seed, migration, import, and restore all
stamp the protected relation field from a physically present active parent.
Application attempts to insert or patch that field refuse. Moving a foreign
key re-derives the stamp; moving to a missing or inactive parent refuses.

The v1 cursor is not an offset or raw order key. It is a 1,024-byte-capped
XChaCha20-Poly1305 credential binding app/database/target, authorization
stream, function and normalized plan, parent id/incarnation/version,
authority partition, order schema, boundary values, and child `_id`.
Malformed or cross-boundary use is uniformly invalid; a valid credential
whose parent or authorization stream changed requires a first-page restart.

## Anti-patterns

- Do not hand-author a relation-incarnation value or expose it as an argument.
- Do not group an unbounded all-child feed in the client and call it bounded.
- Do not authorize children after applying the page limit.
- Do not treat the experimentally gated builder as a positive target
  capability.
