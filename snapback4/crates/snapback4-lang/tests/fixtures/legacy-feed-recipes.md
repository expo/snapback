# Feeds: declare a Following timeline

For a new public social app, declare `maintain feed: timeline` before adding
posts, reposts or follows. The engine keeps Following, delivery and cleanup;
the application writes the mapped source tables and reads shaped event cards.
The complete program also keeps a public Global projection and ranks the same
post cards by their maintained like count.

## What Following contains

Your own originals and reposts, and those of actors you currently follow,
appear newest first by event time and then event id. Each event has its own
identity. A repost keeps its original's post id and author, with the reposter
as actor. Removing an original retains its card and independent reposts;
a new repost requires a live original event.

Posting commits the event, your own inbox copy, and a durable delivery record.
Followers receive copies in background chunks of 256. A page can temporarily
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

maintain feed: timeline
  events posts where .parentId = null and not .removed by authorId, at removed by removed
  reposts reposts by actorId, postId, at
  edges follows by followerId, followedId

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
  return feed[viewer] after c last 20
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
  post = posts[postId] ! else FEED_APP_NOT_FOUND
  r = insert reposts { actorId: viewer, postId: post.id, at: now } if absent
  if r != null:
    insert events { postId: post.id, actorId: viewer, repost: true, at: now }
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
The [existing adoption instructions](../../../../packages/snapback4/FOLLOWING-ADOPTION.md)
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

## Other feed shapes

Search uses `guide search`; bounded, atomic daily digests use `guide jobs`.

Maintained columns rank parent rows directly; engine-recorded attribution
keeps historical reference facts. See `guide maintains`.

### Community ranking

A ranked feed for a community keeps one shared candidate set instead of a
row per reader: a job on a schedule scores the pool from maintains into a
public `ranked` table every device holds, the viewer's own signals sync to
the viewer, and the device composes the two; an external ranker writes its
per-reader word through a service seat (guide services):

```quarry
use identity
use personas alice, bob, marc

table posts:
  authorId: principal
  body: text <=6000
  at: time
  by byTime: at, id
  immutable authorId, at
  public 'posts are public'
  insert <- .authorId = viewer
  sync public last 2000 by byTime

table votes:
  postId: posts
  principal: principal
  direction: int
  unique byPostPrincipal: postId, principal
  by byPrincipal: principal, id
  cap 1000 by principal
  read <- .principal = viewer
  insert <- .principal = viewer
  update (old, next) <- old.principal = viewer and next.principal = viewer
  sync to .principal

maintain postScore: sum votes of direction by postId
  read <- allow

table ranked:                       -- layer 1: one shared page, scored by the server
  postId: posts
  score: int
  at: time
  unique byPost: postId
  by byScore: score, id
  public 'the ranking is one shared page'
  insert <- deny
  update <- deny
  sync public last 500 by byScore

table seen:                         -- layer 2: the viewer's own signals
  readerId: principal
  postId: posts
  at: time
  unique byReaderPost: readerId, postId
  by byReaderTime: readerId, at, id
  read <- .readerId = viewer
  insert <- .readerId = viewer
  sync to .readerId last 1000 by byReaderTime

table affinity:                     -- the ranker's word, per reader
  readerId: principal
  postId: posts
  score: int
  at: time
  unique byReaderPost: readerId, postId
  by byReaderScore: readerId, score, id
  read <- .readerId = viewer
  insert <- viewer = 'service:ranker'
  update <- viewer = 'service:ranker'
  sync to .readerId last 200 by byReaderScore

job rescore():
  chunk p in posts first 100 by byId:
    (ageHours, rem) = divmod(now - p.at, 3600000)
    upsert ranked[postId = p.id] { postId: p.id, score: postScore[p.id] * 10 - ageHours, at: p.at }
schedule rescoreEvery every 5m: rescore

query home(c: cursor ?):
  return ranked after c last 50 by byScore { *, post: posts[.postId], seen: exists seen[viewer, .postId], mine: votes[.postId, viewer], lift: affinity[viewer, .postId] }

mutation vote(postId: posts, direction: int):
  require exists posts[id = postId] else POST_NOT_FOUND
  require direction = -1 or direction = 0 or direction = 1 else INVALID_VOTE
  upsert votes[postId, viewer] { postId, principal: viewer, direction } -- predicts the first offline vote when the post is held

mutation markSeen(postId: posts):
  require exists posts[id = postId] else POST_NOT_FOUND
  return insert seen { readerId: viewer, postId, at: now } if absent

mutation setAffinity(readerId: principal, postId: posts, score: int):
  require exists posts[id = postId] else POST_NOT_FOUND
  upsert affinity[readerId, postId] { readerId, postId, score, at: now }
```

A maintain that groups by something other than its source's audience (a
score by post over private votes) reaches no device as a value; the job's
`ranked` row is what puts the score on every device. Time decay is the
cadence: the order refreshes when the job runs. A native job (guide native)
can score with floats and a real loop; the tables and the sync are the
same.

## Trending: posts younger than a day, ranked in the like's own transaction

Put the count on the post, index its hour, count and time, and merge the
last 25 hour lanes. Every like or unlike changes the order in its mutation.
Zero-like posts participate in the same page. Equal scores put the newest post
first, then break equal-time ties by id. There is no copied time or zero fill.

```quarry
table posts:
  authorId: principal
  body: text <=500
  at: time
  removed: bool default false
  likeCount: count likes by postId
  by byHourLikes: hour(at), likeCount, at, id
  immutable authorId, at
  public 'posts are public'
  insert <- .authorId = viewer
  update <- .authorId = viewer

table likes:
  postId: posts
  principal: principal
  unique byPair: postId, principal
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
  return merge posts after c last 10 by byHourLikes where .at > now - 86400000 and .at <= now and not .removed:
    [h] for h in range(hour(now) - 24, hour(now) + 1)
```

The source rules pin the like to its writer and allow only that writer to
remove it. Repeated set/clear is idempotent. No mutation may assign the count,
even as 0 or as the system. Ordinary post fields keep their own write rules.

Whole old hours are key ranges the merge never visits. The oldest included
hour still charges candidates rejected by the exact time filter, so a crowded
boundary can hit the meter. A meter cut returns `complete: false`; a finished
page stays complete and returns `next` when more rows exist. Pass `next` as `c`.
The upper time filter excludes future-dated imports in the current hour.
A cursor binds the evaluated lanes and generation, not a snapshot: counts
can move across it and cause repeats or omissions. Restart when the clock
changes the lanes; requery as time passes to drop posts at the trailing edge.

The standalone block runs on the server. Add `sync public` to posts for a
local ranking over held rows; sync likes as well if source writes should
predict. A predicted like never changes the count: the server's parent image
supplies it. Every contributing commit streams that whole image, coalesced
once per parent. `N_MAINTAINED_COLUMN_STREAM` names that cost. Reading ten
winners does not reduce acquisition; use the parent's sync horizon when
appropriate, over a time index that does not depend on the maintained field.

Adding or redefining the column recounts existing sources in atomic activation.
It publishes an event-free generation barrier, so devices reacquire by snapshot
and server-run parent watches re-run, including when all totals are zero.
Beside the declared Following timeline, add `likeCount` and `byHourLikes` to
the posts table it maps; one table serves both. Add `and not .removed` to
Trending's filter there, and refuse likes of removed posts. See
`guide maintains` for disclosure, cost and adoption details.

## Trending: optional scheduled ranked-table recipe

A scheduled ranked-table recipe buys a score computed by a job, such as a
native scorer, or a stored page for a device that cannot hold the maintain;
it is neither fresh nor exact.

This scheduled ranked-table recipe ranks posts younger than 24 hours by
their non-expiring like count, then post time, then id. Zero-like posts are
candidates too. This is a window over **post time**, not a count of likes
in the last 24 hours on arbitrarily old posts. `create` writes only a post;
`like` and `unlike` write only the viewer's like. The engine updates
`likeCounts`, and the schedule alone writes `ranked`. No mutation updates
another author's post or ranking row, and no `update <- allow` is needed.

```quarry
table posts:
  authorId: principal
  body: text <=6000
  at: time
  by byTime: at, id
  immutable authorId, at
  public 'posts are public'
  insert <- .authorId = viewer
  sync public last 2000 by byTime

table likes:
  postId: posts
  principal: principal
  unique byPostPrincipal: postId, principal
  by byPrincipal: principal, id
  cap 1000 by principal
  read <- .principal = viewer
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync to .principal

maintain likeCounts: count likes by postId
  read <- allow
  online only

table ranked:
  postId: posts
  score: int
  at: time
  expiresAt: time
  unique byPost: postId
  by byScore: score, at, postId, id
  by byExpiresAt: expiresAt
  public 'the scheduled ranking is public'
  insert <- deny
  update <- deny
  delete <- deny
  expire at .expiresAt
  sync public last 500 by byScore

mutation create(body: text <=6000):
  return insert posts { authorId: viewer, body, at: now }

mutation like(postId: posts):
  require exists posts[id = postId] else POST_NOT_FOUND
  return insert likes { postId, principal: viewer } if absent

mutation unlike(postId: posts):
  delete likes[postId, viewer]

query myLike(postId: posts):
  return exists likes[postId, viewer]

job scoreTrending():
  chunk p in posts first 100 by byId:
    if p.at > now - 86400000 and p.at <= now:
      upsert ranked[postId = p.id] { postId: p.id, score: likeCounts[p.id], at: p.at, expiresAt: p.at + 86400000 }
schedule trendingEvery every 1m: scoreTrending

query trending(c: cursor ?):
  return ranked after c last 10 by byScore { *, post: posts[.postId] }

query trendingNow():
  day = posts[at > now - 86400000, at <= now] first 4095 by byTime { id, at, likes: likeCounts[.id] }
  return slice(sort(day, '-likes', '-at', '-id'), 0, 10)
```

`like` predicts when the post is held and the viewer's like partition has
finished acquisition. That partition has no horizon; its cap is 1,000 likes
per viewer. Repeated likes are idempotent. The online-only maintain is an
engine side effect and does not cost source-write prediction. Local `myLike`
changes immediately, while Trending keeps the last delivered scores.

**Exactness limit:** scores and new candidates lag by one schedule period
(1 minute) when the job runs promptly. Queueing, chunk execution and device
sync can add delay; an offline device keeps its delivered scores. Each
100-post chunk commits independently, so a pass is not an atomic snapshot
of the whole ranking. Once writes stop and the next pass finishes, scores
converge to the maintained counts. The job walks posts in bounded chunks;
old posts are skipped. It never copies a capped count as exact.

Candidate expiry is immediate at `post.at + 24h` on each host's clock,
before the physical sweep, even if the next scoring pass has not run.
`complete` describes the ranked page's coverage, not score freshness; a
device exhausted past its 500-row acquisition horizon reports incomplete.
Post bodies outside its post horizon can be null. Cursors traverse stored
score/time/postId/id order, including ties; a rescore can move rows between pages.
The post id breaks score/time ties just as it does in `trendingNow()`;
the ranked row's separately minted id comes last.

For the fresh indexed like-count ranking, use the hour lanes above. The
live bounded query `trendingNow()` illustrates a read-time sort with at
most 4,095 candidates under the shared 8,192-row examined ceiling.
Each post costs a scan examination and a count lookup. A larger day
returns the selected prefix's winners with `complete: false`; a cut
count lookup or heap allocation returns `data: null, complete: false`.
A maintain over expiring likes cannot replace that with an exact value
index (`E_QUARRY_MAINTAIN_EXPIRE`): stored contributions survive until the
sweep, while live values change at expiry. Rechecking only stored winners
can miss another group's new rank. Use this scheduled recipe when score lag
is acceptable; it does not promise exact rolling-like-window ranking.

### Fresh bounded ranking: likes arriving in the last day

For posts younger than a day by like count, use the hour-lanes `trending(c)`
above. A read-time sort is still useful for a score that is not a `count` or
`sum`, under a few thousand candidates. `rollingLikes()` ranks
posts of any age by their likes in the trailing 24 hours; zero-like groups
are absent and ties break by post id. A like lives for 24 hours from the
server's `now`. These are different windows; choose the query your feed means.

This standalone recipe keeps likes private and runs the ranking on the server.
A disconnected device can retain that answer with `fresh: false`, not compute
a complete ranking from only its own likes. For a locally computed public-like
variant, change the likes read rule to `read <- allow`, its sync to `sync public`,
remove `online only` from `likeCounts`, and replace the posts sync line with
`sync public` (removing its `last 2000 by byTime` horizon). The resulting `N_MAINTAIN_SYNCED`
note discloses that every count group reaches every device. This variant
replicates all posts and live like sources without a horizon too: make that
privacy and acquisition choice explicitly. Both device stores run that variant
under their own clock, including offline expiry before the server sweep.

```quarry
table posts:
  authorId: principal
  body: text <=6000
  at: time
  by byTime: at, id
  immutable authorId, at
  public 'posts are public'
  insert <- .authorId = viewer
  sync public last 2000 by byTime

table likes:
  postId: posts
  principal: principal
  at: time
  expiresAt: time
  unique byPostPrincipal: postId, principal
  by byPrincipal: principal, id
  by byExpiresAt: expiresAt
  cap 1000 by principal
  immutable postId, principal, at, expiresAt
  read <- .principal = viewer
  insert <- .principal = viewer
  delete <- .principal = viewer
  expire at .expiresAt
  sync to .principal

maintain likeCounts: count likes by postId
  read <- allow
  online only

mutation create(body: text <=6000):
  return insert posts { authorId: viewer, body, at: now }

mutation setLike(postId: posts, liked: bool):
  require exists posts[id = postId] else POST_NOT_FOUND
  if liked:
    insert likes { postId, principal: viewer, at: now, expiresAt: now + 86400000 } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]

query rollingLikes():
  candidates = likeCounts first 4095 by byGroup { postId, score: .value }
  return slice(sort(candidates, '-score', '-postId'), 0, 10)
```

The target is engine-owned: no principal can insert or update its score.
`setLike` accepts only a post id and a desired boolean, derives the principal
and both times on the executing host, and permits one live like per viewer
per post. Repeated `true` does not extend a live like's lifetime; after expiry
it may create a new like. Repeated `false` is harmless. Source update is denied.
The per-principal cap bounds live likes to 1,000. Seed/import uses the same
aggregate maintenance; there is no ranking backfill or refresh helper to forget.

**Freshness:** the next server read sees each committed source write, with
zero scheduled delay. Expiry changes live counts at the read's pinned clock,
before any physical sweep, after a partial sweep and on an offline device.
On a device, new remote writes still require sync; an offline ranking describes
held data, not unseen writes. Eligible local source writes can predict only
with their source and aggregate proof held. Expiring count reads need full
source coverage; adding a source horizon makes a local ranking incomplete.
`rollingLikes` reports its next contribution expiry to the host.

**Read cost:** sort the whole bounded candidate set, then slice. The
like-window query pays one examination per count group plus its source rows;
unswept expired sources also cost examinations. Its `first 4095` can fit
4,095 groups with one live like each under the 8,192 examined ceiling.
One lookahead candidate costs another examination, and exceeding the candidate
bound makes the ranking incomplete even when scoring fits. More contributions
can exhaust the query before the candidate bound.

For a bounded post scan such as `trendingNow()` above, each post costs two
examined units (the scan and its count lookup), plus any live source reads.
With short bodies and one live contribution, the expiring-source regression
fits 4,095 posts at 8,191 examinations. This is the bounded-sort cost, not the
cost of the indexed hour-lanes `trending(c)` recipe.

When only the candidate bound is exceeded, the result is the top ten of the
selected prefix with accurately read scores and `complete: false`, not the
global top ten. If a count lookup or live count computation exhausts the meter,
the whole query returns `data: null, complete: false`; it never substitutes zero
or a partially counted score. The separate 16 MiB heap ceiling includes any
materialised post bodies before projection in a bounded post scan: 6,000-byte bodies can exhaust it
below 4,095 candidates (the fixture fits 1,000 and cuts at 2,700), also returning
`data: null, complete: false`. The candidate bound is not a capacity guarantee
for arbitrary bodies or like populations. The query has no ranking cursor:
continuing an unsorted source page cannot continue its sorted winners. Narrow
the candidate scope or accept an explicitly delayed materialisation when the
full live set does not fit.

`E_QUARRY_MAINTAIN_EXPIRE` remains a correctness refusal, not a reindex cost
refusal. The sweep already subtracts physical contributions and updates target
indexes transactionally. But live values change before that sweep; a partial
sweep leaves stored order stale. Taking stored top-N and rechecking only those
winners can miss a live winner. For `count`, the server's stored count is an
upper bound on its live count: a descending scan that recomputes candidates
until no remaining bound can beat the live top-N would be sound, with ties
resolved by the promised order. That threshold read is not built and would
have to refuse on devices, whose snapshots deliver live values rather than
physical upper bounds. Signed sums have no such bound: a negative contribution
expiring can increase the live sum. One value index would add at most two entry
writes per removed contribution, not another aggregate scan; paying that cost
alone does not make stored top-N fresh. This recipe pays for live reads instead.

## N_PUBLIC_AGGREGATE_COPY: a public derived column keeps ordinary write authority

N_PUBLIC_AGGREGATE_COPY is a note, not an error. Every write to a public or
uniformly readable column is computed from table or maintain reads, but
`insert <- allow` or `update <- allow` (or a provably unrestricted equivalent)
lets any principal run any mutation that writes it. The note names the column
and a written expression, such as `p.score + 1` in `like`. Declare
`likeCount: count likes by postId` on the parent row, as Trending does above.
For a derivation a column cannot express, pin a copied score to the engine's
count in both insert and update rules:

```quarry
table posts:
  author: principal
  public 'posts'
  insert <- .author = viewer

table likes:
  postId: posts
  principal: principal
  unique byPair: postId, principal
  immutable postId, principal
  public 'likes'
  insert <- .principal = viewer
  delete <- .principal = viewer

maintain likeCounts: count likes by postId
  read <- allow
  online only

table ranked:
  postId: posts
  score: int
  unique byPost: postId
  immutable postId
  public 'ranking'
  insert <- exists likeCounts[postId = .postId, value = .score] or (.score = 0 and not exists likeCounts[postId = .postId])
  update (old, next) <- exists likeCounts[postId = next.postId, value = next.score] or (next.score = 0 and not exists likeCounts[postId = next.postId])

mutation refresh(postId: posts):
  upsert ranked[postId = postId] { postId, score: likeCounts[postId] }
```

The zero case matters: a count group has no row without contributions. These
rules reject a forged score; keeping a copy fresh is still the application's
responsibility. For another derived fact, pin the copied value to its source
row with an `exists` rule. Maintains produce numeric counts and sums; the note
leads with the pinning rule for a non-numeric copy, such as a nullable author.

The client calls declared operations, not arbitrary table writes. This note
identifies latent table permission, not proof that a current mutation accepts
an arbitrary score. It follows values through bindings, helper calls, objects,
shapes, arithmetic and loops across all Quarry programs and helpers, including
jobs, once per column. The written value must be computed from reads (possibly
with ambient values); an argument may choose which derived value is written
but may not supply the value itself or how many values contribute to it.
A purely ambient write (`viewer`, `now`,
a minted id or a literal) disqualifies the column, except a literal insert or
omitted literal default may initialize a
column that has another read-derived write. A literal update or upsert is not
that exception. Presence (`connected`) is ambient, not a table aggregate.
An upsert's returned id keeps the supplied id key's data provenance: an
argument supplies it, a read derives it, and an id minted without an id key
is ambient.

A collection carries cardinality separately from its items: a read page's is
read-derived, an argument list's or argument-bounded range's is supplied, and a
literal list's is ambient. Shapes, slices and sorts preserve that cardinality;
a filter may add its predicate's dependence. `count` consumes cardinality,
while sums, element picks and loop accumulations consume it with their data.
Branches, loop exits, sort/group keys and slice/element positions
carry control provenance through helper writes and nested fields; that control
does not enter the verdict. The note names a caller-dependent choice, such as
`p.score + 1` or `p.score - 1`, chosen by `liked` in `setLike`. An unknown
dependence or an exhausted analysis budget stays silent; it never becomes read
evidence. Literal insert initialization keeps the exception above, including
inside a branch.

Restricted rules, private targets, immutable columns, append-only tables and
maintain targets do not receive it. Job-only writers under `deny` stay silent.
Actions have no Quarry write body; their external steps call declared mutations,
whose arguments are included. A native job can write tables outside this syntax
census, so its presence makes the all-writers proof unknown and silent. The note does not infer meaning from column names,
and its absence is not proof that a ranking cannot be forged. Sync and
`online only` do not change write authority.

E_VIEW_FEED_PENDING means a `view following: activity where ...` declaration
has parsed but its feed binder is pending. Read `activity last 20 by .at`
directly while integrating the feed implementation. See `guide feeds`.
