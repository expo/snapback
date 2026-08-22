---
title: "Recipe: chunk a membership feed across in()"
id: recipes.chunked-semijoin-feed
order: 4
audience: agent-first
capabilities: [backend.query-in-chunking]
authorities: [llp/0277-coterie-clique-run-observations.research.md, llp/0278-paged-live-results-and-relational-composition.rfc.md, demos/coterie/snapback/schema.mjs, demos/coterie/snapback/functions.mjs, demos/coterie/snapback/acceptance-m2.test.mjs]
examples: [demos/coterie]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:7d7e8cebef184f437a0af3e61c03d6acf0dc5aa0169fff5d43354e693fb499fe
---

# Recipe: chunk a membership feed across `in()`

<!-- @ref LLP 0277#f3-the-in-operand-bound-turns-membership-feeds-into-bespoke-query-planning--repeated — this is the checked interim recipe requested by the Coterie run -->

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use this composition when one top-N feed spans an application-owned bounded
set of actors and one `.in()` query cannot carry the whole set. If the feed is
one ordered table with no membership fan-in, use the simpler
[paginated-list recipe](./paged-list.md).

Coterie's Following feed is the executable carrier. It normalizes posts and
reposts into `feedEvents`, chunks the visible actor IDs, reads the indexed top
20 in each chunk (the run's "indexed top-20 per chunk"), and merges those
candidate pages by one global `pageKey`.
This is a hand-built composition over shipped query primitives, not a
first-class Snapback semi-join.

## Reserve cursor and visibility bindings before sizing a chunk

One builder admits at most 500 total `.in()` operands and at most 500 total
filter bindings. The latter count includes every `.eq()`/range predicate and
every item passed to `.in()`. Coterie's `feedEvents` table is explicitly
`public-read`, so the host adds no owner or membership visibility predicate.
For that public-read table, a page after the first adds
`.lt('pageKey', before)`: use **at most 499 actor IDs per chunk** and reserve
the 500th binding for that cursor predicate. Keep that reservation on the
first page so the same chunk shape remains valid later.

The 499 value is not universal. On a protected table, host-added owner and
membership visibility bindings consume the same 500-binding budget. Reserve
one slot for every such host-owned binding, plus every application predicate
and the optional cursor, before assigning the remainder to actor IDs:

```text
actor IDs per chunk <= 500 - cursor slots - application-predicate slots
                              - host-visibility-binding slots
```

Copy Coterie's 499 only when the queried table is `public-read` and the cursor
is the sole non-`.in()` filter. For a protected table, inspect its generated
visibility plan and reserve every host-owned slot; otherwise a nominally safe
chunk can still refuse with `SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED`.

More than 500 total `.in()` items refuses with
`SNAPBACK_QUERY_IN_ITEMS_EXCEEDED`; 500 actor items plus the cursor predicate
instead exceeds the total binding budget and refuses with
`SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED`. Coterie keeps the ceiling and the
generic chunk helper explicit:

```js source=demos/coterie/snapback/functions.mjs
function pageKeyFor(ctx, createdAt) {
  return `${String(createdAt).padStart(16, '0')}:${ctx.runtime.id()}`;
}

function queryFilterBindingLimit() {
  return 500;
}

function threadDirectReplyLimit() {
  return 1023;
}
```

```js source=demos/coterie/snapback/functions.mjs
function chunkValues(values, maxItems) {
  const chunks = [];
  for (let start = 0; start < values.length; start += maxItems) {
    chunks.push(values.slice(start, start + maxItems));
  }
  return chunks;
}
```

Do not use a 500-item chunk merely because the cursor is absent on the first
page. The next page would add the 501st binding and change the query's
admissibility at the page boundary.

## Normalize every feed event behind one immutable total order

The merge is exact only when every candidate shares one immutable, unique,
totally ordered key. Coterie creates `pageKey` from server time plus a fresh
runtime ID, never patches it, and makes the global index unique. Its
actor-plus-page index makes each chunk read indexed rather than a table scan:

```js source=demos/coterie/snapback/schema.mjs
    feedEvents: defineTable({
      eventKind: v.string(),
      sourceKey: v.string(),
      postId: v.id('posts'),
      actorProfileId: v.id('profiles'),
      pageKey: v.string(),
      createdAt: v.integer(),
    })
      .index('by_page_key', ['pageKey'], { unique: true })
      .index('by_actor_page', ['actorProfileId', 'pageKey'])
      .index('by_source_key', ['sourceKey'], { unique: true })
      .visibility({ kind: 'public-read' })
      .sync(),
```

`feedEvents` is the normalization seam: an original post and a repost can
have different source rows and hydration rules while the feed planner sees
the same `actorProfileId` and `pageKey` columns. If every source kind cannot
produce the same immutable total order, this merge proof does not apply.

## Read top N per chunk, then merge the candidates

Apply the same strict global cursor to every chunk before ordering and taking
N rows. Merge all chunk candidates by the same descending key and take N
again:

```js source=demos/coterie/snapback/functions.mjs
async function followingFeedEvents(ctx, visibleActorIds, before, actorChunkSize) {
  const chunkPages = [];
  for (const actorIds of chunkValues(visibleActorIds, actorChunkSize)) {
    let eventsQuery = ctx.db
      .query('feedEvents')
      .withIndex('by_actor_page')
      .in('actorProfileId', actorIds);
    if (before) eventsQuery = eventsQuery.lt('pageKey', before);
    chunkPages.push(...await eventsQuery.order('pageKey', 'desc').take(20).collect());
  }
  // Every row outside a chunk's top 20 has at least 20 newer rows in that
  // same chunk, so it cannot belong to the global top 20. Merging the chunk
  // tops and taking the first 20 is therefore exact, not an approximation.
  return chunkPages
    .sort((left, right) => (left.pageKey > right.pageKey ? -1 : left.pageKey < right.pageKey ? 1 : 0))
    .slice(0, 20);
}
```

The proof generalizes from 20 to N: a row below rank N in its own chunk has
at least N globally newer candidates in that chunk alone, so it cannot enter
the global top N. It depends on indexed per-chunk reads, the identical strict
cursor on every chunk, and the immutable total order above.

The production path fixes the chunk size at 499 and exposes only the cursor.
There is no caller-selected chunk size on `followingFeed`:

```js source=demos/coterie/snapback/functions.mjs
export const followingFeed = defineJsLiveQuery({
  auth: 'authenticated',
  args: { before: v.optional(v.string()) },
  result: results.records(feedRow, { minItems: 0, maxItems: 20 }),
  reads: [
    'feedEvents',
    'posts',
    'profiles',
    'postImages',
    'postVideos',
    'likes',
    'reposts',
    'follows',
  ],
  refusals: ['PROFILE_REQUIRED'],
  handler: async (ctx, args) => feedRows(ctx, args, true),
});
```

Bound the membership read separately. Coterie's shared ordinary/fixture follow
writer admits the 1,024th edge and refuses an attempted 1,025th edge before
insert. Because every follow write goes through that admission check, the
feed's `.take(1024)` is complete rather than a truncating prefix:

```js source=demos/coterie/snapback/functions.mjs
// @ref LLP 0278#d3-closed-membership-semi-join — the interim manual plan
// must admit a finite actor set instead of truncating an unbounded follow graph.
function followingSetLimit() {
  return 1024;
}

function requireFollowingSetCapacity(ctx, currentFollowingCount) {
  if (currentFollowingCount >= followingSetLimit()) {
    ctx.refuse('FOLLOWING_SET_LIMIT_EXCEEDED');
  }
}
```

Declare that refusal on every follow mutation, and prove both sides of the
boundary. If an application has legacy rows written outside the bounded
writer, audit or migrate them before relying on the invariant. Chunking makes
a declared finite actor set queryable; it does not make an unbounded follow
graph or unbounded fan-out safe.

## Keep one cursor owner across all chunks

The feed function owns one global `before` value. It is the last returned
row's raw `pageKey`, not one cursor per actor chunk and not a chunk offset.
Every chunk receives the same boundary, and the merge returns the next global
window. Coterie's acceptance cursor walk demonstrates that ownership:

```js source=demos/coterie/snapback/acceptance-m2.test.mjs
async function feedPages(client, reference) {
  const pages = [];
  let before;
  for (let page = 0; page < 20; page += 1) {
    const rows = (await client.query(reference, {
      args: { ...(before ? { before } : {}) },
    })).rows;
    pages.push(rows);
    if (rows.length < 20) return pages;
    before = rows.at(-1).pageKey;
  }
  throw new Error('feed pagination did not terminate within twenty pages');
}

async function allPages(client, reference) {
  return (await feedPages(client, reference)).flat();
}
```

This raw application-owned cursor is specific to this recipe. Do not pass it
to `defineMembershipKeysetPages` or another standard-pattern page: those
surfaces own opaque custody-bound cursors, as the
[paged-list recipe explains](./paged-list.md#use-opaque-cursors-for-protected-pages).

## Force the multi-chunk path in acceptance

A fixture with fewer than 500 visible actors can silently exercise only one
chunk. Coterie uses a separate fixed-size acceptance query whose only argument
is the global cursor; its handler always uses three actors per chunk. The
production `followingFeed` neither declares nor reads `actorChunkSize`.

The test makes the viewer plus three followed actors span two chunks, walks a
full 20-row page and a non-empty second page through that forced-multi-chunk
path, and compares the complete sequence against an independently filtered
global feed:

```js source=demos/coterie/snapback/acceptance-m2.test.mjs
  await t.test('forced following-feed chunks paginate exactly across actor sets', async () => {
    created.dave = (await dave.client.mutate(api.createPost, {
      args: { kind: 'text', body: 'Dave crosses the chunk boundary.', imageAssetIds: [] },
    })).result;
    const followed = [alice, carol, dave];
    for (const actor of followed) {
      await bob.client.mutate(api.setFollow, {
        args: {
          profileId: actor.profile._id,
          following: true,
          mutationId: `chunk-follow-${actor.profile.handle}`,
        },
      });
    }

    const chunkedPages = await feedPages(bob.client, api.followingFeedAcceptance);
    assert.equal(chunkedPages[0]?.length, 20);
    assert((chunkedPages[1]?.length ?? 0) > 0, 'forced multi-chunk path must fill a second page');
    const chunked = chunkedPages.flat();
    const visibleActors = new Set([
      bob.profile._id,
      ...followed.map((actor) => actor.profile._id),
    ]);
    const expected = (await allPages(bob.client, api.globalFeed))
      .filter((row) => visibleActors.has(
        row.eventKind === 'repost' ? row.repostedByProfileId : row.authorProfileId,
      ));
    assert.deepEqual(
      chunked.map(({ itemId }) => itemId),
      expected.map(({ itemId }) => itemId),
    );
    assert(chunked.some(({ _id }) => _id === created.dave));

    for (const actor of followed) {
      await bob.client.mutate(api.setFollow, {
        args: {
          profileId: actor.profile._id,
          following: false,
          mutationId: `chunk-unfollow-${actor.profile.handle}`,
        },
      });
    }
  });
```

Keep the fixed-size query acceptance-only and omit it from a production
function bundle. Application behavior must not depend on a caller-selected
chunk size, and an ordinary product query must never accept `actorChunkSize`.

## Design reference: the closed semi-join does not ship

LLP 0278 D3 proposes a closed membership semi-join in which the runtime owns
chunking, indexed reads, merge, bounded-actor admission, cursor semantics, and
codegen-visible cost facts. **LLP 0278 D3 remains design-only.** There is no
shipped `semiJoin()` helper, and this manual recipe does not let codegen prove
maximum chunks × per-chunk take or cursor correctness. Do not copy the RFC's
pseudocode into an application or claim the author-visible chunk seam has
disappeared; use the checked Coterie composition above until a published
surface replaces it.

## Anti-patterns

- Do not copy the 499-actor public-read calculation onto a protected table;
  reserve cursor, application, and host visibility bindings first.
- Do not collect every matching event and sort in JavaScript; take the
  indexed top N inside each chunk.
- Do not merge on a mutable timestamp, a non-unique display value, or
  different keys per source kind.
- Do not keep one cursor per chunk; one global ordered feed owns one global
  boundary.
- Do not let production callers tune `actorChunkSize` or mistake chunking for
  an unbounded-fan-out primitive.
- Do not claim LLP 0278 D3's closed semi-join ships.
