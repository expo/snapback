# Feeds: declare a Following timeline

For a new public social app, declare `view following` before adding
posts, reposts or follows. The engine keeps Following, delivery and cleanup;
the application writes the mapped source tables and reads shaped event cards.
The complete program also keeps a public Global projection and ranks the same
post cards by their maintained like count.

## What Following contains

Your own originals and reposts, and those of actors you currently follow,
appear newest first by event time and then event id. Each event has its own
identity. A repost keeps its original's post id and author, with the reposter
as actor. Removing an original retains its card and independent reposts;
a new repost requires a live original event. The view exposes `id`, `post`,
`actor`, `at` and `repost`; `id` is the event id, including a fresh id for each
repost event. Read `following last 20 by .at after c`. A shape such as
`{ *, post: posts[.post] }` applies to those fields after inbox filtering.

Posting commits the event, your own inbox copy, and a durable delivery record.
Followers receive copies in background chunks of at most 256, yielding between
rows after a short time slice. Waiting requests get the engine before the next
chunk; delivery also keeps a turn under continuous request traffic. A page can temporarily
lack an event whose delivery is still pending. Following copies the newest 50
live events immediately, then backfills the rest of an engine-chosen 1,000-event window in chunks.
The engine assigns a fresh edge epoch on every follow, even if the application
reuses a follows row id. Backfill alone copies events admitted before that epoch;
delivery alone copies events admitted afterward. This order comes from the
engine's transaction sequence and write ordinal, never event time, so delaying
delivery cannot enlarge the history window. The completed delivery record keeps
that admission order until the event is removed.
Older events remain readable on the author’s profile.
Unfollow hides the actor on the very next read, before background cleanup. Up to 256 stale copies are deleted synchronously.
The read checks the current privately replicated edge epoch and public removal tombstone for every examined row. A meter cut on stale copies returns an incomplete
page with a continuation.
Removal writes the tombstone immediately; background work purges copies before
retiring it. A crash resumes from the last committed cursor without duplicate
copies. No author registration, size clause, promotion or shared lane is needed.
Following pages cover delivered inbox contents: `complete` is false while
that reader has pending backfill or cleanup. Per-event delivery does not change
`complete`; followers normally receive copies within a second on an idle host.
`snapback4 doctor` lists pending and parked work.
The job meters bound each chunk. Devices predict their own event's own-inbox
copy; follow and unfollow queue for the server without prediction.

This standalone example includes replies in the posts table while selecting
only originals. Every selection column except the one-way removal flag is
immutable. Full public source partitions and the reader's private inbox are
replicated; measure cold acquisition separately from page reads.

```quarry
table posts:
  authorId: principal
  parentId: posts ?
  at: time
  removed: bool default false
  immutable authorId, parentId, at
  public 'public posts and replies'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public

table reposts:
  actorId: principal
  postId: posts
  at: time
  unique byPair: actorId, postId
  immutable actorId, postId, at
  public 'public reposts'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public

table follows:
  followerId: principal
  followedId: principal
  unique byPair: followerId, followedId
  immutable followerId, followedId
  public 'public edges'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public

view activity:
  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]

mutation post(postId: id, parentId: posts ?):
  return insert posts { id: postId, authorId: viewer, parentId, at: now }
mutation repost(postId: posts):
  return insert reposts { actorId: viewer, postId, at: now } if absent
mutation unrepost(postId: posts):
  delete reposts[viewer, postId]
mutation follow(actor: principal):
  return insert follows { followerId: viewer, followedId: actor } if absent
mutation unfollow(actor: principal):
  delete follows[viewer, actor]
mutation remove(postId: posts):
  update posts[postId] { removed: true }
query home(c: cursor ?):
  return following last 20 by .at after c
```

E_TIMELINE_FILTER means the originals predicate uses a mutable or non-local
input. Declare each selection column immutable and use `where .parentId = null
and not .removed` on the events mapping.

N_TIMELINE_COMPAT means an old `authors` or `size` clause is accepted but
unused. Remove those clauses and keep events, reposts and edges.

### Cost

The declared 1,008 authors and 5,921 edges fit Clique's graph fixture. The
60,000-event capacity covers its roughly 50,000 posts; this remains a capped
product envelope. A reader following 500 ordinary authors reads installed
inbox and shared lanes, rather than merging all 500 authors on every page.

| Transition | Work paid in the writing transaction |
|---|---|
| Register | Profile and engine author-mode row |
| Post or repost, pushed author | Source event and at most 50 follower copies plus an own copy |
| Post or repost, promoted author | Source event and broadcast, plus an own copy if the author has no self pull |
| Follow | Reads at most 1,000 source events; backfills pushed events in the declared window |
| Promotion at follow 51 | Routes and counts for all followers; maximum backfill uses 1,023 total writes including the app edge |
| Unfollow | At most 1,000 private copies, plus route and count updates |
| Remove | Tombstone, source-event and broadcast changes; private copies wait for cleanup |

All app and engine writes share the 1,024-row mutation ceiling. The reserved
promotion allowance is 159 writes with an 865-event window; the declaration
saves the duplicate edge write. Extra app writes can still cause `E_BOUND`;
history is never shortened to make a write fit. `snapback4 check --cost`
prints resolved caps, operation bounds, index work and derived stream bytes.
The maximum-backfill promotion's measured derived contribution is 888,757
bytes, below the 16,777,216-byte stream ceiling. Arbitrary app rows can grow
later historical replies; the SDK recovers an oversized indivisible commit
by snapshot acquisition, preserving pending writes.

Cold acquisition includes all public application tables, including replies below, public event
metadata, modes, broadcasts and tombstones, plus only the reader's private
inbox and routes. Counts are public but online-only; internal totals are
unreadable. Page size does not bound acquisition or device storage. Measure
your populated app with `snapback4 test --residency --as <principal>` and
inspect dependencies with `snapback4 check --residency --verbose`.

A removal-heavy page pays for tombstone probes. The 40-event case with the
newest 20 removed takes 82 examinations, including 41 tombstone probes, to
return 20 live rows and a continuation. With a 25-examination ceiling it
returns no rows, `complete: false`, without `next`. A meter cut can end a
page incomplete without a continuation; retry the same cursor after cleanup.
Ordinary pages continue after their last emitted event. Cursors are not
snapshots: intervening writes can change membership. A merge cursor from generation N
can continue after compatible adoption; direct page cursors bind generation.

### Refusals and supported boundaries

This declaration supports four distinct, explicitly public, fully `sync public`
tables, with the ownership, immutability and edge caps shown below. Private
edges, expiry, horizons, maintained source tables, mutable identity or ordering
fields, and hard deletion of original cards are outside this shape. The
compiler names the mismatch; do not widen private data to fit it.

FEED_PULL_CAP means the caller already uses all 32 shared-author slots.
Unfollow a shared author, then retry the refused follow with a new write ID.

FEED_PROMOTION_PULL_CAP means another follower has full slots. The whole
follow and promotion roll back, including the app edge. Existing followers
keep receiving private pushes; no follower is silently skipped. Show this
refusal. Every saturated follower must free a slot; until then every later follow
refuses and the author can remain at 50 followers indefinitely. Freeing only
the newcomer's slot cannot fix another follower's slots. A server-run query
over public `follows` and `feedPullCounts` can identify `used = 32` blockers
in 51 reads (one scan and 50 count lookups); private route author ids stay hidden.
More than 32 shared authors needs a different serving design.

FEED_APP_NOT_FOUND means a mapped profile, card or repost is absent. Register
both accounts before following; register the author before publishing.
A typed reference does not establish current existence.

FEED_POST_NOT_FOUND means there is no live original to repost. Refresh the
card; a removed original cannot receive a new repost.

FEED_EVENT_REMOVED means a new event id collides with a pending tombstone.
Mint a fresh event id. Tombstones are purged; retained original cards and the
one-way flag prevent original resurrection after that purge.

FEED_CANNOT_FOLLOW_SELF means the requested follow is the reader's own account.
Own events already belong to Following without an edge.

FEED_AUTHOR_NOT_FOUND means the author mode is absent. Create the author's
profile through registration before retrying.

FEED_PULL_COUNT_MISSING means a route lacks its count. Restore consistent
trusted state; the engine owns both and application code cannot repair them.

FEED_ORIGINAL_REQUIRED means an original-event operation received a repost.
FEED_NOT_AUTHOR means the caller does not own the event being removed.
FEED_APP_OWNER means the caller does not own the mapped application row.
FEED_APP_EVENT means an installed bridge's event disagrees with its card's
author or time; reconcile that existing application's mapping.

N_SPARSE_FILTER means an unscoped filter pins no index prefix and can return
short incomplete pages. Use the declared timeline for Following, or pin the
leading index key for another bounded read.

Every insert into the mapped posts table publishes a timeline event; there is
no event predicate. Keep replies, comments and any rows that must not appear
in Following in their own table, outside the timeline mapping.

## Complete public Following, Global and Trending program

Save this as `snapback/schema.q`, then run `snapback4 check`. The example's
profile and card fields can grow while the mapped identities and rules keep
this shape. Omitted write rules deny: profiles cannot update or delete,
originals cannot delete, and reposts and follows cannot update.
`check` also prints `N_MAINTAINED_COLUMN_STREAM` for `posts`: every like change
streams the whole post image to each holder, once per changed post per commit.
The same `score` serves ranking and card display; do not add a second
`maintain scores` solely to display it. Page size does not reduce this cost.

```quarry
table profiles:
  principal: principal
  name: text <=80
  unique byPrincipal: principal
  cap 1008
  immutable principal
  public 'public profiles'
  insert <- .principal = viewer
  sync public

table posts:
  authorId: principal
  body: text <=500
  at: time
  removed: bool default false
  score: count likes by postId
  by byHourScore: hour(at), score, at, id
  cap 60000
  immutable authorId, at
  public 'public cards retained for reposts'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public

table replies:
  postId: posts
  authorId: principal
  body: text <=500
  at: time
  by byPost: postId, at, id
  cap 60000
  immutable postId, authorId
  public 'public thread replies outside Following'
  insert <- .authorId = viewer
  sync public

table reposts:
  actorId: principal
  postId: posts
  at: time
  unique byActorPost: actorId, postId
  cap 60000
  immutable actorId, postId, at
  public 'public repost attribution'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public

table follows:
  followerId: principal
  followedId: principal
  at: time default 0
  unique byPair: followerId, followedId
  by byFollowed: followedId, followerId
  immutable followerId, followedId, at
  cap 1000 by followerId
  cap 1000 by followedId
  cap 5921
  public 'public follow graph'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public


table likes:
  postId: posts
  principal: principal
  unique byPair: postId, principal
  immutable postId, principal
  public 'public likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public

table events:
  postId: posts
  actorId: principal
  repost: bool
  at: time
  unique byActorPostType: actorId, postId, repost
  by byTime: at, id
  cap 60000
  immutable postId, actorId, repost, at
  public 'Global public events'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public

maintain feed: timeline
  events posts by authorId, at removed by removed
  reposts reposts by actorId, postId, at
  edges follows by followerId, followedId

query following(c: cursor ?):
  return feed[viewer] after c last 20 { *, post: posts[.postId], actor: profiles[principal = .actorId], author: profiles[principal = .authorId] }

query global(c: cursor ?):
  return events after c last 20 by byTime { *, post: posts[id = .postId], actor: profiles[principal = .actorId] }

query trending(c: cursor ?):
  return merge posts after c last 10 by byHourScore where .at > now - 86400000 and .at <= now and not .removed:
    [h] for h in range(hour(now) - 24, hour(now) + 1)

query thread(postId: posts, c: cursor ?):
  return replies[postId] after c first 20 by byPost

mutation register(name: text <=80):
  return insert profiles { principal: viewer, name } if absent
mutation post(body: text <=500):
  p = insert posts { authorId: viewer, body, at: now }
  insert events { postId: p.id, actorId: viewer, repost: false, at: now }
  return p
mutation reply(postId: posts, body: text <=500):
  require exists posts[id = postId] else FEED_APP_NOT_FOUND
  return insert replies { postId, authorId: viewer, body, at: now }
mutation repost(postId: posts):
  r = insert reposts { actorId: viewer, postId, at: now } if absent
  if r != null:
    insert events { postId, actorId: viewer, repost: true, at: now }
  return r
mutation remove(postId: posts):
  update posts[id = postId] { removed: true }
  if exists events[viewer, postId, false]:
    delete events[viewer, postId, false]
mutation unrepost(postId: posts):
  if exists reposts[viewer, postId]:
    delete events[viewer, postId, true]
    delete reposts[viewer, postId]
mutation setLike(postId: posts, liked: bool):
  p = posts[id = postId] ! else FEED_APP_NOT_FOUND
  if liked:
    require not p.removed else FEED_POST_NOT_FOUND
    insert likes { postId, principal: viewer } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]
mutation follow(authorId: principal):
  insert follows { followerId: viewer, followedId: authorId, at: now } if absent
mutation unfollow(authorId: principal):
  if exists follows[viewer, authorId]:
    delete follows[viewer, authorId]
```

The read yields `{ id, postId, actorId, authorId, repost, at }`, augmented here
with card and profile joins. Key the rendered list by event `id`, so an
original and a repost remain separate. `post.removed` describes the original;
do not filter an independent repost out merely because its original was removed.
Render `complete: false` as incomplete and pass `next` back as `c` when present.

Global reads one application-owned `events` table; it cannot read the
viewer's timeline as a public cross-table union. Only the mutations above
write that projection. Each post/repost and its Global event commit atomically
with the engine's Following changes; an event cap or later refusal rolls back
all three. Retry a submitted mutation with the same write id. A repeated repost
with a new write id also adds nothing while its source exists. Unrepost deletes
both source and Global event; reposting afterward mints fresh identities.
Removing an original deletes its own Global event, while independent reposts
keep their cards with `removed: true`. Replies are outside both feeds.
Global has separate event ids from Following; key each list by its own event id.
The tables and graph are already public here. Do not make private audiences
public to use this example. Extra projection writes count toward the same
mutation ceiling; inspect the failed write before retrying.

Trending uses 25 hourly lanes of `posts.byHourScore`, ordered by descending
`score`, then `at`, then `id`; it includes zero likes and excludes removed
posts and both exact window edges outside `(now - 86400000, now]`. Pass `next`
as `c` with the same lane set. Counts can move between requests, so pages are
not a snapshot and can repeat or omit rows after concurrent likes or deletions.
Restart pagination when the clock changes the lanes. `why trending` describes
its index and static lane bound; `run trending '{"c":null}' --json` reports
actual examined/index/step/heap counters and the cut, not a latency guarantee.
See the standalone Trending example below for an online-only card.

For replies received by a post's author,
see `guide maintains` for `count replies by postId.authorId`; the complete
program above does not depend on that form.

`size` accepts `authors`, `edges`, or both in either order; omitted keys default
to 1,000 authors and 100,000 edges. Values are positive 32-bit integers, authors
at most 134,217,727, edges at most authors × 1,000, and authors × 32 must fit
min(edges, 1,000) + 1. Route and count caps are authors × 32. The follow window
never exceeds 865 even when authors grows. The application's global follow cap
must equal declared edges. Its profile cap can be lower, with a note that the
application refuses first. Choose the size before populating events or edges.

## Devices and offline behavior

Registration, posting, reposting, removal and unrepost predict when every
required input is currently held and covered: profiles, author modes, relevant
edges, source events, live originals, tombstone lookups and own pull routes.
Any retained-only or unheld input queues the whole mutation with zero predicted
rows. Partial acquisition never predicts from a partial follower set.

Follow and unfollow always queue without predicted rows, including their
application edge, because slot accounting is online-only. A queued follow does
not optimistically change Following offline. Posting predicts only owned rows
its principal may read: with one follower, the author predicts the app post,
public event and own private copy; the server delivers the follower's copy.

Offline, Following reads installed lanes and held cards. The UI shows pending
writes, freshness and completeness using the normal client contract. An offline
device sees its last synced removals and follows; it learns remote changes on
reconnect. Settlement replaces predictions with authoritative rows; a refusal
withdraws all predicted changes. Retained history never proves current input
coverage. See `guide prediction` and `guide app` for client rendering.

## Lifecycle and diagnostics

Declare before posts, reposts or follows exist. Activation requires those
tables empty and at most the declared number of existing profiles; it eagerly
registers those profiles in one activation transaction. Later profile inserts
register their modes in the same mutation. Activation's generation barrier
reacquires the new state; in development, use a fresh store.

A timeline is durable history, not a rebuildable view: publication modes,
permanent promotion and tombstones cannot be recovered from source rows.
Unchanged adoption and trusted reopen or full persistence restoration preserve
that state without publishing events again. A populated timeline cannot be
removed or redefined, including changing `size`. Untrusted fixture import of
the four application tables refuses; seed through application mutations or
restore a complete trusted persistence image.

| Code | Rewrite or next step |
|---|---|
| E_TIMELINE_SHAPE | Use the four public, fully synced source tables and required rules above |
| E_TIMELINE_FOLLOWS | Add both endpoint caps, the followed-leading index and the declared global edge cap |
| E_TIMELINE_SIZE | Use valid coupled `size authors N, edges N` values |
| N_TIMELINE_PROFILE_CAP | Raise the profile cap or retain the intentional lower application limit |
| E_TIMELINE_REMOVAL | Insert false; change only false → true; retain original cards |
| E_TIMELINE_READ | Read one viewer: `feed[viewer] after c last 20` and shape events |
| E_TIMELINE_OWNED | Write only the mapped application sources; the engine writes projections |
| E_TIMELINE_SERVER | Queue follow and unfollow without rows |
| E_TIMELINE_ACTIVATE | Declare before event and edge data exists |
| E_TIMELINE_REDEFINE | Keep the populated declaration unchanged |
| E_TIMELINE_IMPORT | Use app mutations or a trusted complete restore |
| E_RECIPE_RETIRED | Declare `maintain feed: timeline` with `size authors N, edges N`; see `guide feeds` |

## Existing apps with an installed recipe

Installed recipes keep working. There is no migration from an installed recipe
to the declaration in 0.3: activation needs empty event and edge tables.
The [existing adoption instructions](https://github.com/expo/snapback/blob/main/snapback4/crates/snapback4-lang/src/recipe/ADOPTION.md)
still apply to those apps, including paused writes and dependency-ordered backfill.

An installed recipe's `createPost` or `repost` predicts its ordinary fan-out
writes. Each device read hides foreign inbox copies: their `readerId = viewer`
read rule fails for the author. The declared timeline still skips foreign
engine-owned copies before writing them, as described above.
See `guide prediction` for the shared read-authorization rule.

The installed recipe trusts its principals with permissive projection writes:
`authors` allows updates, `pulls` allows inserts, and `broadcast` inserts do not
pin `readerId`. New apps should use the declaration, which strips non-read rules
from those projections and makes them engine-owned.
The recipe's private inbox also trusts an actor to write recipient copies
without proving a follow edge. Only the recipe's own mutations write these
tables, and they pin the fields those rules leave open: do not add mutations
that write `authors`, `pulls`, `broadcast` or `feed`.

## Global: a planned view

Each original and repost is one event. A planned union reads its source rules
before projection. It stores no extra rows; equal source ids from different
branches stay distinct. Page by event time, then the source id and branch.

```quarry
table posts:
  authorId: principal
  at: time
  removed: bool default false
  public 'public originals'
  online only
table reposts:
  actorId: principal
  postId: posts
  at: time
  public 'public reposts'
  online only
view activity:
  posts where not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
query global(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post] }
```

## Trending: a predicate read

Put the count on the post. Each like changes it in the same transaction.
Both time bounds define the rolling window; the compiler chooses its buckets.
Zero-like posts participate. Equal counts put newer posts first, then id.

```quarry
table posts:
  authorId: principal
  body: text <=500
  at: time
  removed: bool default false
  likeCount: count likes
  immutable authorId, at
  public 'posts are public'
  insert <- .authorId = viewer
  update <- .authorId = viewer

table likes:
  postId: posts
  principal: principal
  unique postId, principal
  immutable postId, principal
  public 'likes are public'
  insert <- .principal = viewer
  delete <- .principal = viewer

mutation create(body: text <=500):
  return insert posts { authorId: viewer, body, at: now }

mutation setLike(postId: posts, liked: bool):
  p = posts[id = postId] ! else POST_NOT_FOUND
  if liked:
    require not p.removed else POST_REMOVED
    insert likes { postId, principal: viewer } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]

mutation remove(postId: posts):
  update posts[id = postId] { removed: true }

query trending(c: cursor ?):
  return posts where .at > now - 1d and .at <= now and not .removed last 10 by .likeCount, .at after c
```

Pass `next` as `c`. A crowded boundary or exhausted meter makes the page
incomplete. A cursor is not a snapshot: likes can move a post across it.
Refresh the ranking as time passes. The upper bound excludes future imports.
This standalone query runs online. Synced maintained parent rows receive the
whole authoritative parent image per contributing commit; `guide maintains`
explains that acquisition and stream cost.

## N_PUBLIC_AGGREGATE_COPY: a public derived column keeps ordinary write authority

N_PUBLIC_AGGREGATE_COPY names an ordinary public column computed from reads
whose insert or update rule permits arbitrary writers. Declare a maintained
column such as `likeCount: count likes` for an aggregate the engine owns.
For another copied value, pin the source value in both write rules. The complete
pinning example and the note's analysis limits are on `guide maintains`.

E_VIEW_FEED_SHAPE means Following cannot recognize the public activity union or
its viewer-or-followed predicate. Use originals `{ post: .id, actor: .authorId,
at, repost: false }`, reposts `{ post: .postId, actor: .actorId, at, repost: true }`,
and `view following: activity where .actor = viewer or exists follows[viewer,
.actor]`. The edge table needs one declared unique pair of required principals.
All three sources retain full `sync public`, owner rules and immutable mapped
columns; private sources remain refused. Other union shapes can be read directly
as planned views.
