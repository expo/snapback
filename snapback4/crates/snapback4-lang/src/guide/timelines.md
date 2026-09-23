## Declared Following: engine-owned timeline

For a new public social model, `maintain <name>: timeline` keeps Following
from the application's actual writes. It uses the bridge's supported shape
above, plus a required `bool default false` removal flag on posts. The mapped
follows table must carry an index leading with the followed column, cap 1000 by each endpoint, and a global cap equal to the declared `edges` (100000 by default).

```quarry
table profiles:
  principal: principal
  unique byPrincipal: principal
  cap 1008
  immutable principal
  public 'profiles'
  insert <- .principal = viewer
  sync public
table posts:
  authorId: principal
  at: time
  removed: bool default false
  cap 60000
  immutable authorId, at
  public 'cards'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public
table reposts:
  actorId: principal
  postId: posts
  at: time
  unique byActorPost: actorId, postId
  cap 60000
  immutable actorId, postId, at
  public 'reposts'
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
  public 'edges'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public

maintain feed: timeline
  authors profiles by principal
  events posts by authorId, at removed by removed
  reposts reposts by actorId, postId, at
  edges follows by followerId, followedId
  size authors 1008, edges 5921

mutation register():
  insert profiles { principal: viewer }
mutation publish():
  return insert posts { authorId: viewer, at: now }
mutation follow(authorId: principal):
  insert follows { followerId: viewer, followedId: authorId, at: now } if absent
mutation remove(postId: posts):
  update posts[postId] { removed: true }
query home(c: cursor ?):
  return feed[viewer] after c last 20 { *, post: posts[.postId] }
```

The example sizes the timeline for Clique's 1,008 authors and 5,921 follow
edges, exactly like `init --recipe feeds --authors 1008 --edges 5921`.
The optional `size` line accepts `authors`, `edges`, or both in either order.
Omitted keys default to 1,000 authors and 100,000 edges. Values and their
coupling are the recipe's: positive 32-bit integers, authors at most
134217727, edges at most authors × 1000, and authors × 32 pull slots enough
for min(edges, 1000) + 1. Pull-route and count-row caps are authors × 32.

Backfill visits `clamp(authors, 200, 865)` source events: 200 for authors 50,
865 for authors 1008. It still scans at most 1,000 source events per actor.
The 159-write promotion allowance and all per-actor and per-endpoint caps
stay unchanged; growing authors cannot grow the window past its write budget.
The profiles table's cap belongs to the application and need not equal
`authors`; a lower cap gets a note because the application would refuse first.
`check --cost` prints the resolved caps and backfill bound.

The read yields `{ id, postId, actorId, authorId, repost, at }` event rows.
Shape them with the application's cards and profiles; `id` is the event id,
including a fresh id for each repost. Ordering, the newest-865-event follow
window, permanent promotion at follower 51, capacities, tombstone filtering,
cursors and meter-cut completeness follow the recipe above. A declaration
keeps the mapped edge only. Maximum-backfill promotion uses 1,023 writes;
one further app write reaches 1,024 and another refuses atomically. No history
is shortened to fit. Other mutations pay the recipe's same row writes.

Call register before publishing or following: a missing profile refuses with FEED_APP_NOT_FOUND, exactly as the recipe bridge does.

Registration is eager: inserting a profile registers its mode in that same
mutation. Deleting a profile, when its rule allows it, retains the mode,
including promotion. Activation registers up to the declared `authors` existing profiles in
its single transaction; mapped posts, reposts and follows must be empty.
The generation barrier reacquires the new state. Declare before those rows
exist; in dev use a fresh store. Unchanged adoption and trusted reopen retain
all history. Redefinition on a populated store and untrusted fixture imports
refuse; seed through app mutations instead. In the first scope, size the timeline
before data exists; changing `size` is a semantic redefinition.

Post removal changes the flag from false to true; inserting true or reversing
it refuses. Repeated removal does no derived work. Removing an original keeps
its card and other actors' existing reposts. A new repost of a removed original refuses with FEED_POST_NOT_FOUND. Deleting a repost removes its event. The
system purge job runs every minute, deleting at most 1,001 private copies and
one tombstone per chunk. Application rules still authorize every mapped write.

The eight owned tables use the declaration name plus `Authors`, `Pulls`,
`PullCounts`, `PullTotals`, `Posts`, `RemovedEvents`, `Feed`, and `Broadcast`.
No principal or application job can write them. Inbox and route rows are
reader-private; modes, event metadata, tombstones and broadcasts are public;
counts are public online-only; the internal total is unreadable. Posting
never probes another reader's inbox. Non-event owned identities are full SHA-256 digests of the canonical domain tag, declaration name, table suffix and natural key; they consume no caller ids. Event ids remain the original post id or the recipe's fresh repost id. The recipe remains available.

Registration predicts its profile and mode. Profile deletion predicts its
application deletion without reading or changing the mode row. Registration,
posting, reposting, post removal and unrepost predict when every input the
transition reads is currently held: the profile, author mode, follower edges,
source event, live original, tombstone lookup and own pull route. Retained-only
images never establish current input facts or range coverage. Any unknown or
retained input queues the whole mutation with zero predicted rows; partial
acquisition never predicts from a partial follower set.

A device predicts only owned rows its principal may read. With one follower,
a post predicts three rows: the app post, public source event and author's
private inbox copy. The follower's private copy is written by the server to
that follower's partition. This deliberately differs from the manual recipe's
device witness, which predicted and locally exposed the follower's copy.
Public events, broadcasts and tombstones still predict. For all rows the
predicting principal can read, the device and server use the same transitions
and identities.

Follow, unfollow and refollow always queue the whole mutation without rows,
including an unchanged application edge, even if classification metadata is
removed: slot accounting is online-only. `check --residency --verbose` names
each implicit dependency. Following reads held rows from installed lanes with
the recipe's completeness semantics. Replay preserves admitted event IDs and
uses the same owned-id digest as the server. Refusal withdraws every predicted
change. Settlement replaces provisional images with the server's partition,
including dropping any provisional row omitted by that partition.

`check --cost` reports each operation's bounded derived stream contribution
separately from application rows. The maximum-backfill promotion is tested
against the 16,777,216-byte stream ceiling. That is a derived-data bound, not
a promise about arbitrary composed application writes: historical stream
commits re-read current row images and can grow later. When an indivisible
commit exceeds the ceiling at limit 1, the server replies with `snapshot: true`
and the SDK restarts acquisition by snapshot, preserving pending writes.
No write-time stream-byte guard is added.

E_TIMELINE_SHAPE means the declaration does not fit the supported public feed bridge. Use four distinct tables with an explicit public audience and full sync public, no horizon, expiry or maintained definition, and the required identities, keys, ownership and immutability rules; keep another model on the manual recipe path.

E_TIMELINE_FOLLOWS means the mapped edge table lacks promotion bounds. Add an index leading with the followed column, cap 1000 by each endpoint, and a global cap equal to the declared edges (100000 by default); the declaration prints the exact lines.

E_TIMELINE_REMOVAL means the removal signal must be a required bool default false and may only change false to true. Insert new cards with false, retain removed cards, and use a fresh card for new content.

E_TIMELINE_READ means a timeline reads one viewer newest first by time, then event id, excluding tombstoned events. Use `NAME[viewer] after c last 20`, then shape its event rows.

E_TIMELINE_OWNED means timeline rows are engine-owned. Write the mapped application profiles, posts, reposts or follows instead; no principal or application job can write the projection.

E_TIMELINE_SERVER identifies a server-only timeline transition. Follow, unfollow and refollow queue the whole mutation without predicted rows because slot accounting is online-only.

E_TIMELINE_IMPORT means a fixture import cannot reconstruct timeline history. Seed mapped rows through application operations, or restore a complete trusted persistence image.

E_TIMELINE_ACTIVATE means activation requires empty mapped event and edge tables and at most the declared authors existing profiles. Declare the timeline before events or edges exist; in dev use a fresh store.

E_TIMELINE_REDEFINE means a populated timeline cannot be removed or redefined because its history cannot be rebuilt. The first scope sizes the timeline before data exists. Keep the declaration unchanged, or start a fresh store in dev.

A caller-chosen event id equal to a pending tombstone refuses with
`FEED_EVENT_REMOVED`, for originals and reposts alike. The equivalence oracle
has two explicit exceptions: the recipe writes a duplicate follow edge, and
the recipe can admit tombstoned repost-id reuse when no destination retains
an old copy (its unique reader/event key otherwise still collides).

E_TIMELINE_SIZE means a sizing key or value is invalid, or the recipe's coupled bounds do not fit. Use `size authors 1008, edges 5921`; either key may be omitted. Read "Size the installation" above for the bounds.

N_TIMELINE_PROFILE_CAP means the application's profile cap is lower than the timeline's author cap. Raise the profile cap to the declared author count, or keep the intentional application limit.
