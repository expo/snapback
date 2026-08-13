---
title: "Recipe: optimistic toggle"
id: recipes.optimistic-toggle
order: 3
audience: agent-first
capabilities: [clients.react]
authorities: [llp/0090-resumable-query-snapshots.rfc.md, llp/0107-react-presence-and-optimistic-lifecycle.spec.md, llp/0114-first-class-react-and-query-groups.spec.md, packages/snapback-react/index.mjs, demos/warble/snapback/functions.mjs, demos/warble/app/src/post-card.tsx, demos/warble/tests/acceptance/offline-local-first.mjs]
examples: [demos/warble, packages/snapback-react/optimistic.test.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-07
reviewed-authorities-digest: sha256:8ffcd721327b6729764c25465d6d319fb5fa7b07e57369539fd1b23287147fd5
---

# Recipe: optimistic toggle

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

A like/favorite button with a count has two honest query layouts. When one
viewer-aware query returns both `liked` and `likeCount`, the heart and count
flip instantly and the authoritative live query settles both without a
flicker or double increment. When cold retention requires a separate public
viewer-fact query, both facts remain query-owned, but the current optimistic
path can move only the count; the heart settles from that second query's live
delivery. The joined layout is the paved implementation of
`useSnapbackMutation`'s two-field optimistic projection
([the React client](../clients/react.md#run-a-mutation)) for the
toggle-plus-counter shape, and its behavioral claims are asserted by
`packages/snapback-react/optimistic.test.mjs` (run by the package's CI test
suite).

The failure this recipe prevents is real and easy to reach: keep the heart in
component state, add a local `+1` to the count, and the live query
independently delivers the authoritative increment — the UI briefly shows a
two-count jump, and a rebase can visibly flip the heart back. Every fact
below exists to make that impossible.

## Model the viewer's fact in query data

The toggle state is per-viewer data, not UI state. It must come from canonical
query data in one of the two layouts below.

### Joined layout: both fields on the rendered row

The query that renders the button returns both fields for the current viewer
— a server-side join against the viewer's like row plus the denormalized count:

```text
timeline(viewer) -> [{ id, body, ..., liked: boolean, likeCount: number }]
```

If `liked` is absent from all query data, there is nothing authoritative to
reconcile against, and component state is the only place left to put it —
which is exactly the anti-pattern. The joined projection sections below assume
this layout.

### Cold-retained public layout: split the viewer fact

`rqsEligible` v1 is a closed single-table plan, so a retainable posts timeline
cannot join in the viewer's like row. It can coexist with a second public
query keyed by an explicit viewer argument: keep `{ ..., likeCount }` in the
posts query, query like rows with `{ handle: viewerHandle }`, and derive the
heart from the second query:

```tsx fragment reason="generated application query types and component props vary by app"
const likeSet = new Set(myLikes.data?.map((like) => like.postId));
const liked = likeSet.has(post._id);
```

The exact retention declaration and its security boundary are in
[retain public viewer facts by argument, not authority](../sync/offline-and-retention.md#retain-public-viewer-facts-by-argument-not-authority).
An argument is caller-controlled and does not enforce privacy, so this layout
is only for public facts. Private viewer data must use server-derived authority
and the Contract arm's `retainable: true`, `AuthorizedLease` path; never
replace `authUserId()` with an argument merely to make a query retainable.

An optimistic layer is validated against the generated result contract of the
one query store it targets. If `liked` is not a field on the posts result,
projecting `{ liked, likeCount }` into a post row is refused before mutation
dispatch with `SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED`. Project only the
field that belongs to that row:

```tsx fragment reason="generated application query types and component props vary by app"
optimistic: {
  query: api.timeline,
  args: {},
  ...projectRecordFields(post._id, { likeCount }),
}
```

The count then moves optimistically, while the heart changes when the
authoritative `myLikes` delivery adds or removes the like row. The boolean is
still derived from canonical query data, not component state. A symmetric
instant heart for the like case would require appending a missing row to
`myLikes`; optimistic create has no paved path in v1, so this split layout does
not promise the joined layout's zero-latency heart. Warble implements this
count-only projection; its acceptance suite proves retained rendering plus
exactly-once like settlement.

## Project both fields atomically when they share a row

For the joined layout, declare one optimistic projection beside the mutation
hook. Two rules carry the recipe, and both are visible in the CI-exercised
fixture:

```js source=packages/snapback-react/optimistic.test.mjs
// Capture the intended outcome at admission. The projection is replayed over
// every newer authoritative base during rebase, so it must set the captured
// outcome; toggling or incrementing the incoming row would re-run the user
// action on replay and visibly invert or double-apply it.
const intended = { liked: true, likeCount: 11 };
const optimisticLike = {
  query: timeline,
  args: {},
  update: (posts) => posts.map((post) => post.id === 'p1' ? { ...post, ...intended } : post),
  isAuthoritative: (posts, receipt) => posts.some((post) => post.id === 'p1'
    && post.liked === receipt.liked && post.likeCount === receipt.likeCount),
};
```

- **`update` is a replayable projection, not an action.** The layer is
  recomputed over every newer authoritative base (overlapping attempts,
  interleaved deliveries, rejection rollback). Compute the intended
  `{ liked, likeCount }` once, outside the reducer, and have the reducer
  *set* that outcome. A reducer that toggles (`liked: !row.liked`) or
  increments (`likeCount: row.likeCount + 1`) re-runs the user action on
  every replay and inverts or double-applies it.
- **Change both fields in one projection.** One layer over one store flips
  the heart and moves the count in the same frame. Splitting them (heart in
  component state, count optimistic — or either combined with a local delta)
  reintroduces the double increment.

In application code the same shape reads:

```tsx fragment reason="mutation and query fields come from the generated application API"
const liked = !post.liked;
const likeCount = Math.max(0, post.likeCount + (post.liked ? -1 : 1));
const toggleLike = useSnapbackMutation(api.toggleLike, {
  optimistic: {
    query: api.timeline,
    args: { viewerHandle: viewer },
    update: (posts) => posts.map((item) =>
      item._id === post._id ? { ...item, liked, likeCount } : item),
    isAuthoritative: (posts, receipt) => posts.some((item) =>
      item._id === post._id
        && item.liked === receipt.liked
        && item.likeCount === receipt.likeCount),
  },
});
```

Return the complete receipt — `{ liked, likeCount }` — from the mutation, and
match **both** fields in `isAuthoritative`. A mutation that writes the like
row and the denormalized count separately can produce a live delivery
containing only half the outcome (`liked: true` with the old count). A
matcher that checks only `liked` retires the layer on that partial delivery
and the count visibly dips. Matching the full receipt keeps the layer
installed across partial deliveries — the projection simply rebases over
them:

```js source=packages/snapback-react/optimistic.test.mjs
likeClient.emit('timeline', [{ id: 'p1', liked: true, likeCount: 10 }]);
assert.equal(view().timeline.data[0].liked, true, 'replay does not invert the heart');
assert.equal(view().timeline.data[0].likeCount, 11, 'partial delivery keeps the layer installed');
```

## Or declare it: `projectRecordFields`

Both rules are mechanical, so `@expo/snapback-react` derives them from one
declaration. `projectRecordFields(recordId, fields)` returns a frozen
`{ update, isAuthoritative }` pair — the idempotent capture-and-set
projection and the complete-receipt matcher — to spread into the same
optimistic options:

```js source=packages/snapback-react/optimistic.test.mjs
// One declaration derives the idempotent capture-and-set update and the
// complete-receipt matcher; spread it into the ordinary optimistic options.
const optimisticHelperLike = {
  query: timeline,
  args: {},
  ...projectRecordFields('p2', { liked: true, likeCount: 4 }, { idField: 'id' }),
};
```

The fixture's rows key on `id`; generated application rows carry the default
`_id`, so application code omits the `idField` option. Intended values must
be primitives (`boolean | number | string | null`) — the helper deliberately
expresses only the capture-and-set shape, so it cannot encode the replay
hazard. Prefer it over a hand-written reducer whenever the projection is
"set these fields on this row". The helper's layers also carry a strand
backstop hand-written matchers do not get (LLP 0107, 2026-08-07 ruling): once
confirmed, the layer retires when its identified row is absent from an
authoritative delivery — a field projection on a row that is not present has
nothing to project — so a row filtered out or deleted server-side cannot
strand the layer and its subscription pin until store teardown. In the split cold-retained layout, pass only
`{ likeCount }`; injecting `liked` into the posts row violates that query's
generated result contract.

Hand-written reducers get a development safety net: at admission the
provider replays the just-validated projection through the reducer a second
time, and a reducer that returns a different result over its own output — a
toggle or an increment — logs one
`SNAPBACK_REACT_OPTIMISTIC_REPLAY_DIVERGENT` console warning per
(mutation, query) site, pointing back at this recipe. The advisory is
observational only: it never changes admission, and an explicit production
`NODE_ENV` skips it. (The heuristic is deliberately broad: a reducer that
intentionally appends a row — an optimistic create, which has no paved path
yet — also trips it.)

## Response and query authority can arrive in either order

The mutation's HTTP response and the live query's delivery of the resulting
commit race, and the layer reconciles both orders without double-applying:

- **Response before query:** the validated response settles the mutation
  promise, but a response is not live-query authority. The layer stays
  installed until a live delivery matches the complete receipt, then retires:

```js source=packages/snapback-react/optimistic.test.mjs
likeClient.inspection().attempts[0].resolve({ liked: true, likeCount: 11 });
assert.deepEqual(await like, { status: 'settled', result: { liked: true, likeCount: 11 } });
assert.equal(view().timeline.data[0].likeCount, 11, 'settled response alone does not retire the layer');
likeClient.emit('timeline', [{ id: 'p1', liked: true, likeCount: 11 }]);
assert.equal(view().timeline.data[0].likeCount, 11);
likeClient.emit('timeline', [{ id: 'p1', liked: true, likeCount: 12 }]);
assert.equal(view().timeline.data[0].likeCount, 12, 'layer retired after the complete receipt');
```

- **Query before response:** the authoritative delivery advances the base
  first and the projection rebases over it (capture-and-set makes this a
  no-op rather than a second increment); when the response then identifies
  the receipt, the matcher recognizes it in the already-current rows and
  retires the layer.

Rejection needs no handling beyond the promise: the layer rolls back
automatically, removing only itself and recomputing anything stacked above it
over the newest authoritative base.

## The same record on multiple surfaces

A post renders in the timeline, on the author's profile, maybe in a detail
view — each a distinct canonical query store. In v1 one optimistic projection
targets exactly one canonical query/args pair: the store that rendered the
component the user touched. Configure the mutation per surface, commonly
through a small surface-specific wrapper around a shared card:

```tsx fragment reason="surface wrappers depend on the application's query surfaces"
export function TimelinePostCard({ post }: { post: Post }) {
  const toggleLike = useToggleLike(post, api.timeline, { viewerHandle: viewer });
  return <PostCard post={post} toggleLike={toggleLike} />;
}

export function ProfilePostCard({ post, handle }: { post: Post; handle: string }) {
  const toggleLike = useToggleLike(post, api.profilePosts, { handle, viewerHandle: viewer });
  return <PostCard post={post} toggleLike={toggleLike} />;
}
```

Only the touched surface gets the zero-latency projection. Every other
mounted store showing the same record updates through its own authoritative
subscription when the commit's live delivery arrives — do not try to install
the same layer into sibling stores or mirror the change into them by hand:

```js source=packages/snapback-react/optimistic.test.mjs
// Other mounted stores rendering the same record update through their own
// authoritative subscriptions, not through the optimistic layer.
likeClient.emit('profilePosts', [{ id: 'p1', liked: true, likeCount: 12 }]);
assert.equal(view().profile.data[0].liked, true, 'other surfaces settle authoritatively');
assert.equal(view().profile.data[0].likeCount, 12);
```

The tradeoff is honest: on the untouched surfaces the like lands at
live-delivery latency rather than instantly. That brief skew is
self-reconciling; a hand-mirrored update is a second source of truth that is
not.

## Anti-patterns

- **Do not add a component-local delta to a count a live query already
  supplies.** `likeCount + localBump` double-counts the moment the
  authoritative increment arrives. The count on screen is either the query's
  value or the optimistic layer's projection of it — never query value plus
  local arithmetic.
- **Do not keep the toggle in component state.** `useState(liked)` has no
  reconciliation with query authority: it drifts on other-client changes,
  survives rejection, and fights the live delivery. Model the fact in query
  data: either as a field on the rendered row or as a boolean derived from a
  separate canonical likes query.
- **Do not project a field into the wrong query's row contract.** In the split
  cold-retained layout, `{ liked, likeCount }` is not a valid posts row when
  `liked` lives in `myLikes`; the layer is refused. Project `{ likeCount }`
  only and let the heart settle from the authoritative viewer-fact query.
- **Do not toggle or increment inside `update`.** The projection is replayed
  during rebase; capture the intended outcome and set it (or let
  `projectRecordFields` do both rules for you). In development the replay
  advisory warns when a reducer diverges over its own output.
- **Do not retire on a partial receipt.** Match every field the mutation
  returns in `isAuthoritative`, or a delivery carrying half the outcome
  retires the layer early and the UI dips.
- **Do not treat the mutation HTTP response as live-query authority.** It
  settles the promise; the layer retires on the matching live delivery.
- **Do not fan one optimistic config out to every store showing the record.**
  v1 targets one canonical query/args pair; sibling surfaces settle through
  their own subscriptions.
- **Do not hand-write a matcher that may never become true.** A layer with a
  supplied `isAuthoritative` never uses the fallback next-delivery
  retirement: if a matched field can settle to a value differing from both
  receipt and intent — or, for a hand-written matcher, the matched row can
  be filtered out of the query result — the confirmed layer stays installed
  (and keeps its subscription pin) until the store tears down. Match rows
  the query is guaranteed to keep returning, and match fields the mutation
  actually settles. `projectRecordFields` layers retire on row-absent
  authoritative deliveries (the backstop above), and any confirmed layer
  still installed is visible in `provider.inspection()` as a
  `confirmedOptimisticLayers` entry naming its mutation/query pair — check
  there when a subscription refuses to go idle. (Overriding the helper's
  `isAuthoritative` with your own function is a hand-written matcher: the
  backstop does not travel.)
