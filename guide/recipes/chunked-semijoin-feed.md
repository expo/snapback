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
reviewed-authorities-digest: sha256:d3990b6dfabd6e729c40471be58dc8ebbd95f553cac6488289c85727691d0fed
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
20 in each chunk, and merges those candidate pages by one global `pageKey`.
This is a hand-built composition over shipped query primitives, not a
first-class Snapback semi-join.

## Handle `SNAPBACK_QUERY_IN_ITEMS_EXCEEDED` by reserving the cursor binding

One builder admits at most 500 total `.in()` operands and at most 500 total
filter bindings. The latter count includes every `.eq()`/range predicate and
every item passed to `.in()`. A page after the first adds
`.lt('pageKey', before)`, so use **at most 499 actor IDs per chunk** and reserve
the 500th binding for that cursor predicate. This keeps the same chunk shape
valid on the first and every later page.

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

The production path clamps any requested test seam to the safe range and
defaults to 499:

```js source=demos/coterie/snapback/functions.mjs
    const visibleActorIds = [viewer._id, ...follows.map((follow) => follow.followedProfileId)];
    const requestedChunkSize = Number.isSafeInteger(args.actorChunkSize)
      ? args.actorChunkSize
      : queryFilterBindingLimit() - 1;
    // Leave one binding for the optional page-key predicate on every page.
    const actorChunkSize = Math.max(
      1,
      Math.min(requestedChunkSize, queryFilterBindingLimit() - 1),
    );
    events = await followingFeedEvents(ctx, visibleActorIds, args.before, actorChunkSize);
```

Bound the membership read separately. Chunking makes a declared finite actor
set queryable; it does not make an unbounded follow graph or unbounded fan-out
safe.

## Keep one cursor owner across all chunks

The feed function owns one global `before` value. It is the last returned
row's raw `pageKey`, not one cursor per actor chunk and not a chunk offset.
Every chunk receives the same boundary, and the merge returns the next global
window. Coterie's acceptance cursor walk demonstrates that ownership:

```js source=demos/coterie/snapback/acceptance-m2.test.mjs
async function allPages(client, reference) {
  const output = [];
  let before;
  for (let page = 0; page < 20; page += 1) {
    const rows = (await client.query(reference, {
      args: { ...(before ? { before } : {}) },
    })).rows;
    output.push(...rows);
    if (rows.length < 20) return output;
    before = rows.at(-1).pageKey;
  }
  throw new Error('feed pagination did not terminate within twenty pages');
}
```

This raw application-owned cursor is specific to this recipe. Do not pass it
to `defineMembershipKeysetPages` or another standard-pattern page: those
surfaces own opaque custody-bound cursors, as the
[paged-list recipe explains](./paged-list.md#use-opaque-cursors-for-protected-pages).

## Force the multi-chunk path in acceptance

A fixture with fewer than 500 visible actors can silently exercise only one
chunk. Coterie exposes an acceptance-only `actorChunkSize` argument, clamps it
to 1–499 in the handler, and has production callers omit it. The test sets it
to three while the viewer plus three followed actors make four visible actors,
forcing two chunks. It compares the merged result IDs against an independent
global-feed filter rather than merely asserting that the query returned:

```js source=demos/coterie/snapback/acceptance-m2.test.mjs
  await t.test('following-feed chunks merge to the exact top 20 across actor sets', async () => {
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

    const chunked = (await bob.client.query(api.followingFeed, {
      args: { actorChunkSize: 3 },
    })).rows;
    const visibleActors = new Set([
      bob.profile._id,
      ...followed.map((actor) => actor.profile._id),
    ]);
    const expected = (await allPages(bob.client, api.globalFeed))
      .filter((row) => visibleActors.has(
        row.eventKind === 'repost' ? row.repostedByProfileId : row.authorProfileId,
      ))
      .slice(0, 20);
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

Keep this seam acceptance-only: application behavior must not depend on a
caller-selected chunk size. If exposing such an argument to ordinary clients
is unacceptable for an application, carry the same helper in an
acceptance-specific query instead.

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

- Do not put 500 actor IDs in a paged `.in()` query; the cursor needs the
  remaining filter binding.
- Do not collect every matching event and sort in JavaScript; take the
  indexed top N inside each chunk.
- Do not merge on a mutable timestamp, a non-unique display value, or
  different keys per source kind.
- Do not keep one cursor per chunk; one global ordered feed owns one global
  boundary.
- Do not let production callers tune `actorChunkSize` or mistake chunking for
  an unbounded-fan-out primitive.
- Do not claim LLP 0278 D3's closed semi-join ships.
