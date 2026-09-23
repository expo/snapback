## Declared Following: engine-owned timeline

For a new public social model, `maintain <name>: timeline` keeps Following
from the application's actual writes. It uses the bridge's supported shape
above, plus a required `bool default false` removal flag on posts. The mapped
follows table must carry its own follower index and all three edge caps.

```quarry
table profiles:
  principal: principal
  unique byPrincipal: principal
  cap 1000
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
  cap 100000
  public 'edges'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public

maintain feed: timeline
  authors profiles by principal
  events posts by authorId, at removed by removed
  reposts reposts by actorId, postId, at
  edges follows by followerId, followedId

mutation register():
  insert profiles { principal: viewer }
mutation publish():
  return insert posts { authorId: viewer, at: now }
mutation follow(authorId: principal):
  insert follows { followerId: viewer, followedId: authorId } if absent
mutation remove(postId: posts):
  update posts[postId] { removed: true }
query home(c: cursor ?):
  return feed[viewer] after c last 20 { *, post: posts[.postId] }
```

The read yields `{ id, postId, actorId, authorId, repost, at }` event rows.
Shape them with the application's cards and profiles; `id` is the event id,
including a fresh id for each repost. Ordering, the newest-865-event follow
window, permanent promotion at follower 51, capacities, tombstone filtering,
cursors and meter-cut completeness follow the recipe above. A declaration
keeps the mapped edge only. Maximum-backfill promotion uses 1,023 writes;
one further app write reaches 1,024 and another refuses atomically. No history
is shortened to fit. Other mutations pay the recipe's same row writes.

Registration is eager: inserting a profile registers its mode in that same
mutation. Deleting a profile, when its rule allows it, retains the mode,
including promotion. Activation registers up to 1,000 existing profiles in
its single transaction; mapped posts, reposts and follows must be empty.
The generation barrier reacquires the new state. Declare before those rows
exist; in dev use a fresh store. Unchanged adoption and trusted reopen retain
all history. Redefinition on a populated store and untrusted fixture imports
refuse; seed through app mutations instead.

Post removal changes the flag from false to true; inserting true or reversing
it refuses. Repeated removal does no derived work. Removing an original keeps
its card and other actors' reposts. Deleting a repost removes its event. The
system purge job runs every minute, deleting at most 1,001 private copies and
one tombstone per chunk. Application rules still authorize every mapped write.

The eight owned tables use the declaration name plus `Authors`, `Pulls`,
`PullCounts`, `PullTotals`, `Posts`, `RemovedEvents`, `Feed`, and `Broadcast`.
No principal or application job can write them. Inbox and route rows are
reader-private; modes, event metadata, tombstones and broadcasts are public;
counts are public online-only; the internal total is unreadable. Posting
never probes another reader's inbox. The recipe remains available.

For this server implementation, every mutation touching any mapped table
queues without prediction, including registration and posting.
`check --residency --verbose` names the implicit timeline dependency; Following reads
use the existing synced merge. Device transition prediction is a later lane.

E_TIMELINE_SHAPE means the declaration does not fit the supported public feed bridge. Use four distinct, fully sync public tables with the required identities, keys, ownership and immutability rules; keep another model on the manual recipe path.

E_TIMELINE_FOLLOWS means the mapped edge table lacks promotion bounds. Add an index leading with the followed column, cap 1000 by each endpoint, and cap 100000 globally; the declaration prints the exact lines.

E_TIMELINE_REMOVAL means the removal signal must be a required bool default false and may only change false to true. Insert new cards with false, retain removed cards, and use a fresh card for new content.

E_TIMELINE_READ means a timeline reads one viewer newest first. Use following[viewer] after c last 20, then shape its event rows.

E_TIMELINE_OWNED means timeline rows are engine-owned. Write the mapped application profiles, events or edges instead; no principal or application job can write the projection.

E_TIMELINE_SERVER means timeline writes currently execute on the server. Queue the whole mutation without prediction; the server installs the authoritative derived rows.

E_TIMELINE_IMPORT means a fixture import cannot reconstruct timeline history. Seed mapped rows through application operations, or restore a complete trusted persistence image.

E_TIMELINE_ACTIVATE means activation requires empty mapped event and edge tables and at most 1000 existing profiles. Declare the timeline before events or edges exist; in dev use a fresh store.

E_TIMELINE_REDEFINE means a populated timeline cannot be removed or redefined because its history cannot be rebuilt. Keep the declaration unchanged, or start a fresh store in dev.
