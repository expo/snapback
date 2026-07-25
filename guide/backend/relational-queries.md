---
title: Relational queries (bounded joins)
id: backend.relational-queries
order: 26
audience: agent-first
capabilities: [backend.relational-queries]
authorities: [llp/0080-portable-relational-queries-and-projections.rfc.md, llp/0065-generated-data-pattern-soundness.rfc.md, packages/snapback-codegen/define.mjs]
examples: [packages/snapback-codegen/relational-authoring.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-07-25
reviewed-commit: e1edbbc1a706d0406de24646d2731b7e9fe93bd8
---

# Relational queries (bounded joins)

> **Local target only, experimental capability.** Relational queries require
> the `relational_query_v1` target capability, which is **experimental**
> until LLP 0080's coupled acceptance suite passes: generated artifacts
> acknowledge the experimental contract automatically, and a target without
> the executor (for example the Cloudflare path) refuses at generation with
> a machine-readable capability gap, never at runtime.

Use `defineRelationalQuery` for the common "each row plus its one related
row" read: a bounded two-source equi-join with an explicit projection. It is
a closed plan — no SQL text, no callbacks — and every visibility fact is
declared, never inferred from field names or read sets.

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
    shelf: { literal: 'fiction' },
  },
  take: 50,
  rootIndex: 'by_owner_title',
  joinedIndex: 'by_slug',
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
authority-partition-scoped — and retention is default-deny: v1 admits only
`retention: none` (declaring a relational query retainable is a load
error), with the authenticated-lease snapshot class specified as the
successor. The capability manifest records both facts under
`relationalQueries`.

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

Maintained projections (`defineMaintainedProjection`) and author-supplied
root filters are specified by LLP 0080 but not yet implemented — see the
Step 5 implementation program under `issues/`.
