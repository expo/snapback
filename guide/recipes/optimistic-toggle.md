---
title: "Recipe: optimistic toggle"
id: recipes.optimistic-toggle
order: 3
audience: agent-first
capabilities: [clients.react]
authorities: [llp/0107-react-presence-and-optimistic-lifecycle.spec.md, llp/0114-first-class-react-and-query-groups.spec.md, packages/snapback-react/index.mjs]
examples: [packages/snapback-react/optimistic.test.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-04
reviewed-commit: HEAD
---

# Recipe: optimistic toggle

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

A like/favorite button with a count: the heart flips instantly, the count
moves with it, and the authoritative live query settles both without a
flicker or a double increment. This is the paved implementation of
`useSnapbackMutation`'s optimistic projection
([the React client](../clients/react.md#run-a-mutation)) for the
toggle-plus-counter shape, and every behavioral claim on this page is
asserted by `packages/snapback-react/optimistic.test.mjs` (run by the
package's CI test suite).

The failure this recipe prevents is real and easy to reach: keep the heart in
component state, add a local `+1` to the count, and the live query
independently delivers the authoritative increment — the UI briefly shows a
two-count jump, and a rebase can visibly flip the heart back. Every fact
below exists to make that impossible.

## Model the viewer's fact in the query

The toggle state is per-viewer data, not UI state. The query that renders the
button must return both fields for the current viewer — a server-side join
against the viewer's like row plus the denormalized count:

```text
timeline(viewer) -> [{ id, body, ..., liked: boolean, likeCount: number }]
```

If `liked` is not in the query result, there is nothing authoritative to
reconcile against, and component state is the only place left to put it —
which is exactly the anti-pattern. Add the viewer-aware fields to the query
first; the rest of the recipe assumes them.

## Project both fields atomically, and capture the outcome

Declare one optimistic projection beside the mutation hook. Two rules carry
the whole recipe, and both are visible in the CI-exercised fixture:

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
"set these fields on this row".

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
assert.deepEqual(await like, { liked: true, likeCount: 11 });
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
  survives rejection, and fights the live delivery. Model the fact in the
  query result and project it optimistically.
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
- **Do not write a matcher that may never become true.** A layer with an
  `isAuthoritative` never uses the fallback next-delivery retirement: if the
  matched row can be filtered out of the query result, or a matched field
  can settle to a value differing from both receipt and intent, the
  confirmed layer stays installed (and keeps its subscription pin) until the
  store tears down. Match rows the query is guaranteed to keep returning,
  and match fields the mutation actually settles.
