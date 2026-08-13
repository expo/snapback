---
title: Portable indexed text search
id: backend.text-search
order: 27
audience: agent-first
capabilities: [backend.text-search]
authorities: [llp/0073-portable-full-text-search.rfc.md, llp/0131-structured-argument-contracts.spec.md, src/search/types.rs, src/search/sqlite.rs, packages/snapback-codegen/define.mjs, packages/snapback-client/index.mjs, packages/snapback-client/search.mjs]
examples: [demos/signal-desk]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-10
reviewed-authorities-digest: sha256:dfeb7a6cbfe90ea9ec4f1c6a768fd6075accd769ed424d201b73dac2d9e2eecc
---

# Portable indexed text search

> **Local target only.** Indexed text search requires the stable
> `full_text_search_v1` capability. The local SQLite target reports the exact
> analyzer, parser, scorer, cursor, and nonclaims in its capability manifest.
> PostgreSQL, Cloudflare, live search, offline search, sensitive fields, and
> native FTS acceleration are not claimed.

Use a search index when a query must match words, phrases, or prefixes without
scanning application rows in a JavaScript handler. Search is a closed host
plan: source mutations maintain canonical term, position, and source records
inside the same SQLite transaction, and queries send a structured AST rather
than SQL, FTS, or provider syntax.

## Declare an index

Add `searchIndex` to an ordinary bounded table. A semantic version names the
meaning of its analyzer, fields, weights, visibility, stored result fields,
and ordering. Changing any of those facts requires a new semantic version and
rebuild.

```js source=demos/signal-desk/snapback/schema.mjs
export const incidents = defineTable({
  title: v.string(),
  summary: v.string(),
  severity: v.string(),
  status: v.string(),
  commanderId: v.string(),
  createdAt: v.integer(),
  updatedAt: v.integer(),
})
  .index('by_updated', ['updatedAt'])
  .searchIndex('search_incidents', {
    semanticVersion: 'signal-desk-incidents.v1',
    textFields: {
      title: { weight: 8, classification: 'public' },
      summary: { weight: 4, classification: 'public' },
      severity: { weight: 2, classification: 'public' },
      status: { weight: 2, classification: 'public' },
    },
    fieldClassifications: {
      commanderId: 'public',
      createdAt: 'public',
      updatedAt: 'public',
    },
    equalityFilters: ['severity', 'status'],
    storedFields: [
      'commanderId',
      'createdAt',
      'severity',
      'status',
      'summary',
      'title',
      'updatedAt',
    ],
    highlightFields: ['summary', 'title'],
    visibility: { kind: 'public-read' },
  })
  .sync();
```

Text weights are integers from 1 through 64. Every participating field needs
an explicit classification: text fields carry it beside their weight, while
`fieldClassifications` must classify exactly the participating equality,
stored, or owner fields that are not text fields. `public-read` admits only
public fields. Visibility is required: omission refuses generation with
`SNAPBACK_SEARCH_INDEX_VISIBILITY_REQUIRED`, so public release is always an
affirmative declaration. Owner search instead declares
`visibility: { kind: 'owner', field: 'ownerId' }`; the field must be a required
string or principal and every query is pushed into the server-resolved
effective user's partition.

Membership-visible search (LLP 0073's 2026-08-01 amendment, commissioned by
LLP 0100 §8a) declares
`visibility: { kind: 'membership', declaration, resourceField, roles }`:
`declaration` names a resource-scoped membership declaration, `resourceField`
a required scalar field on the indexed rows, and `roles` (optional) narrows
which seats are admitted. The generated search function then requires one
equality-bound resource argument (`resourceArg` on `defineSearchQuery`), so
every invocation searches exactly one resource's partition; the caller's seat
is resolved in the same snapshot as the posting recheck. A caller with no
admitted seat gets the empty page, byte-identical to a nonexistent resource;
a continuation minted before a seat revocation fails with the uniform
`SNAPBACK_SEARCH_CURSOR_RESTART` before any candidate is evaluated. Searching
several resources means iterating your own seats — multi-seat union search is
deliberately rejected. Other relation-derived visibility shapes remain
unaccepted.

Export the operation with
`defineSearchQuery({ table: incidents, index: 'search_incidents' })`. It is an
ordinary `Query`, deliberately not a `LiveQuery`. A separately authored
`defineLiveSearchQuery` successor exists (Accepted LLP 0136, first-page-only,
no membership indexes), but it is gated on `live_full_text_search_v1`, which
the local target declares as a capability gap — codegen refuses such an
artifact with `SNAPBACK_CAPABILITY_UNSUPPORTED`, and live search remains a
nonclaim of this page.

A table that declares a search index may also declare that successor's
table-wide live-subscription ceiling now:
`defineTable(...).searchLiveLimits({ maxLiveSubscriptionsPerTable })` takes an
integer from 1 through 128 (default 128), may be declared once per table, and
requires at least one `searchIndex` on the same table — declaring it without
one refuses generation with `SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID`. The
declaration is projected into the generated manifest today; its enforcement
belongs to the gated live-search capability and is not a live-search claim.

## Search from a client

`parseSearchQueryV1` turns convenience text into the closed AST before the
request. `client.search` maps the normal query transport `{rows, cursor}` into
`{items, cursor, hasMore}`. The generated operation reference closes each
item's `fields` over exactly that index's `storedFields` and brands `rowId` for
the source table, so consumers neither cast stored values nor treat arbitrary
keys as present. Optional stored source fields are materialized as present
`null` values and therefore generate `T | null`, matching runtime storage.

For a membership-visible index, pass its generated `resourceArg` beside
`query` in the same options object, for example
`client.search(api.searchMessages, { roomId, query })`. The generated type
requires that resource key. The reference binds the shared search-request
grammar separately from the complete operation arguments, so the typed
wrapper accepts same-generation plain and resource-scoped references while
the ordinary closed argument validator still checks the resource value.

`resourceArg` also owns the same-named option slot. In particular, a generated
resource argument named `userId` becomes application data; it cannot
simultaneously carry dev-mode per-call auth through `options.userId`, and the
client deliberately omits that auth assertion. Use session/coordinator-owned
authority for that invocation, or rename the resource argument and regenerate
the references. Do not rely on one option value to mean both resource identity
and caller identity.

```ts source=demos/signal-desk/src/backends/snapback.ts
  async searchIncidents(term: string) {
    const result = await this.client.search(api.searchIncidents, {
      query: parseSearchQueryV1(term, {
        fields: ['title', 'summary', 'severity', 'status'],
      }),
    });
    return result.items.map((item) =>
      incident({ _id: item.rowId, ...item.fields }));
  }
```

The parser admits required terms and phrases, one flat `OR`, direct `-term`
exclusions, and one final `prefix*`. For programmatic queries, use the exported
`search.term`, `search.phrase`, `search.prefix`, `search.any`, `search.not`,
`search.filter`, and `search.all` constructors.

Results order by exact integer score descending, then opaque row id ascending.
Highlights are plain text with scalar ranges; the caller owns escaping and
markup. A continuation is AEAD-protected, caller/index/query/limit-bound, and
valid for at most 120 seconds. Pagination is current-keyset, not a retained
snapshot.

## Handle bounded refusals

- `SNAPBACK_SEARCH_QUERY_INVALID`: malformed AST, unsupported syntax, or a
  declaration-bound limit was violated.
- `SNAPBACK_SEARCH_WORK_LIMIT`: the caller's visible posting partition exceeded
  its deterministic exact-ranking or prefix ceiling; no partial page is
  released.
- `SNAPBACK_SEARCH_CURSOR_RESTART`: identity, policy, generation, query, limit,
  key generation, or TTL no longer matches. Restart at page one.
- `SNAPBACK_SEARCH_INDEX_UNAVAILABLE`: the target/profile/index is not active.
- `SNAPBACK_SEARCH_INDEX_CORRUPT`: a posting failed its authoritative
  source/version/owner recheck. Treat source data as authoritative and rebuild.

## Anti-patterns

- Do not collect rows and call `includes`, a regex, or a locale-sensitive
  lowercase function in a handler.
- Do not pass raw SQLite FTS, PostgreSQL `tsquery`, or a provider search string.
- Do not expose count, facets, suggestions, or autocomplete as if v1
  authorized them; it does not.
- Do not subscribe to a search operation or retain it offline.
- Do not use scores as authorization, moderation, pricing, or other correctness
  inputs.
