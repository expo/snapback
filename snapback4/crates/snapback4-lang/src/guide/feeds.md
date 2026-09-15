# Feeds: complete Following with a small celebrity merge

Small accounts write each reader's private inbox. On the 51st follower,
future events go into one public broadcast projection; the earlier events
keep their delivery mode. Follow backfills the latest 200 source events,
and unfollow deletes every private entry by that actor and drops the pull
lane. The reader's own posts and reposts need no self-follow edge.
Rendered columns travel with each entry, so Following answers on the device.

A merge with non-uniform lanes or a meter or word-limit cut returns no
`next`: its single cursor cannot safely advance every lane.
Non-uniform merges withhold the cursor even within budget, so its presence
cannot reveal hidden rows; pin the columns that decide each lane's rule to
get a pageable feed. IDs break equal ordering keys and identify copies
across projections, which must keep the same ordering fields.
A merge cursor from generation N is accepted on N+1 when its table, index,
direction and typed ordering suffix still match; it is a position in the
current data, not a snapshot or a generation token.
Direct table and maintain page cursors bind the evaluated prefix and active
generation; adoption or another prefix refuses them. Ordinary writes keep
them valid, and rows can move between pages.

```quarry
table authors:
  principal: principal
  shared: bool default false
  unique byPrincipal: principal
  public 'delivery mode is public'
  insert <- .principal = viewer
  update <- allow
  online only

table follows:
  followerId: principal
  followedId: principal
  unique byPair: followerId, followedId
  by byFollowed: followedId, followerId
  cap 1000 by followerId
  cap 1000 by followedId
  public 'the follow graph is public'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  online only

table pulls:
  readerId: principal
  authorId: principal
  unique byReaderAuthor: readerId, authorId
  cap 32 by readerId
  read <- .readerId = viewer
  insert <- allow
  delete <- .readerId = viewer
  sync

table posts:                       -- originals and attributed reposts, one source event each
  actorId: principal
  authorId: principal
  postId: id
  repost: bool
  body: text <=500
  at: time
  shared: bool
  unique byActorPost: actorId, postId, repost
  by byActorTime: actorId, at, id
  by byTime: at, id
  cap 1000 by actorId
  immutable actorId, authorId, postId, repost, at, shared
  public 'original posts and attributed reposts are public'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  online only

table removedEvents:               -- compact tombstones for deleted public source events
  eventId: posts
  actorId: principal
  unique byEvent: eventId
  by byActor: actorId, id
  immutable eventId, actorId
  cap 1000 by actorId
  cap 32000
  public 'removal of a public source event is public; id is the eventId'
  insert <- .actorId = viewer
  sync public

table feed:                        -- private inbox, with rendered columns
  readerId: principal
  eventId: posts
  actorId: principal
  authorId: principal
  postId: id
  repost: bool
  body: text <=500
  at: time
  unique byReaderEvent: readerId, eventId
  unique byReaderTime: readerId, at, eventId
  by byReaderActor: readerId, actorId, id
  by byTime: at, eventId
  by byEvent: eventId, id
  immutable readerId, eventId, actorId, at
  cap 1000 by readerId, actorId
  cap 50000 by readerId
  cap 1001 by eventId
  read <- .readerId = viewer
  insert <- .actorId = viewer or .readerId = viewer
  delete <- .readerId = viewer
  sync

table broadcast:                   -- public celebrity events, stored once
  readerId: principal
  eventId: posts
  actorId: principal
  authorId: principal
  postId: id
  repost: bool
  body: text <=500
  at: time
  unique byReaderEvent: readerId, eventId
  unique byReaderTime: readerId, at, eventId
  by byReaderActor: readerId, actorId, id
  by byTime: at, eventId
  immutable readerId, eventId, actorId, at
  cap 32000
  public 'celebrity posts and reposts are public'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public

fn copy(p: posts, readerId: principal, shared: bool):
  if shared:
    insert broadcast { readerId, eventId: p.id, actorId: p.actorId, authorId: p.authorId, postId: p.postId, repost: p.repost, body: p.body, at: p.at } if absent
  else:
    insert feed { readerId, eventId: p.id, actorId: p.actorId, authorId: p.authorId, postId: p.postId, repost: p.repost, body: p.body, at: p.at } if absent
  return null

mutation register():
  insert authors { principal: viewer } if absent

mutation follow(authorId: principal):
  require authorId != viewer else CANNOT_FOLLOW_SELF
  a = authors[authorId] ! else AUTHOR_NOT_FOUND
  if exists follows[followerId = viewer, followedId = authorId]:
    return null
  insert follows { followerId: viewer, followedId: authorId }
  if not a.shared:
    near = follows[authorId] first 51 by byFollowed
    if count(near) > 50:
      update authors[authorId] { shared: true }
      insert pulls { readerId: authorId, authorId } if absent
      for f in follows[authorId] first 51 by byFollowed:
        insert pulls { readerId: f.followerId, authorId } if absent
  if authors[authorId].shared = true:
    insert pulls { readerId: viewer, authorId } if absent
  for p in posts[authorId] last 200 by byActorTime:
    if not p.shared:
      copy(p, viewer, false)

mutation unfollow(authorId: principal):
  if not exists follows[followerId = viewer, followedId = authorId]:
    return null
  for e in feed[viewer, authorId] first 1000 by byReaderActor:
    delete feed[e.id]
  if exists pulls[viewer, authorId]:
    delete pulls[viewer, authorId]
  delete follows[followerId = viewer, followedId = authorId]

fn deliver(p: posts):
  if p.shared:
    copy(p, viewer, true)
  else:
    copy(p, viewer, false)
    for f in follows[viewer] first 50 by byFollowed:
      copy(p, f.followerId, false)
  return null

mutation createPost(postId: id, body: text <=500):
  require not exists removedEvents[eventId = postId] else EVENT_REMOVED
  a = authors[viewer] ! else AUTHOR_NOT_FOUND
  p = insert posts { id: postId, postId, actorId: viewer, authorId: viewer, repost: false, body, at: now, shared: a.shared }
  deliver(p)
  return { id: p.id }

mutation repost(postId: posts):
  original = posts[postId] ! else POST_NOT_FOUND
  require not original.repost else ORIGINAL_REQUIRED
  if exists posts[viewer, original.postId, true]:
    return null
  a = authors[viewer] ! else AUTHOR_NOT_FOUND
  p = insert posts { postId: original.postId, actorId: viewer, authorId: original.authorId, repost: true, body: original.body, at: now, shared: a.shared }
  deliver(p)
  return { id: p.id }

fn removeEvent(p: posts):
  require p.actorId = viewer else NOT_AUTHOR
  insert removedEvents { id: p.id, eventId: p.id, actorId: viewer }
  if p.shared:
    delete broadcast[viewer, p.id]
  delete posts[p.id]
  return null

mutation deletePost(postId: posts):
  p = posts[postId]
  if p != null:
    require not p.repost else ORIGINAL_REQUIRED
    removeEvent(p)
  return null

mutation unrepost(postId: id):
  p = posts[viewer, postId, true]
  if p != null:
    removeEvent(p)
  return null

query following(c: cursor ?):
  page = merge feed after c last 20 by byReaderTime:
    [viewer]
    broadcast[p.authorId] for p in pulls[viewer] first 32 by byReaderAuthor
  visible = []
  for e in page:
    visible = visible + [null if exists removedEvents[eventId = e.eventId] else e]
  return visible

job purgeRemoved():
  chunk p in removedEvents first 1 by byId:
    for e in feed[p.eventId] first 1001 by byEvent:
      delete feed[e.id]
    delete removedEvents[p.id]
schedule purgeRemovedEvery every 1m: purgeRemoved
```

Call `register` during profile creation. `follow` and `unfollow` are
idempotent; promotion is permanent and atomic with the follow that triggers
it. The promotion adds a pull lane for the author and all 51 followers;
it copies no old entry, so a pushed event and a broadcast event never
represent the same delivery. A later follow copies only recent pushed
events and reads shared events directly. Private inboxes and the bounded
public broadcast projection sync in full: no exhausted horizon can turn
an empty lane into an incomplete device answer. Unfollow removes private
copies in the same transaction; public broadcast rows remain public but
its removed pull lane no longer reads them. Reposts carry the original
body and author, with the reposter as actor, and repeated `repost` calls
insert nothing twice.

`deletePost` and `unrepost` delete the author's own public source event and
broadcast entry, leaving a compact public tombstone with the same event ID.
The immutable inbox `eventId` joins that tombstone on every Following read:
removal is visible immediately on the server and on a device once it applies
that commit, before private copies are purged. An offline device sees its
last synced state. No private inbox or follow graph is additionally synced.
These mutations, like `createPost` and `repost`, queue without prediction
because their source reads are online-only. Repeating a removal is a no-op;
re-reposting creates a fresh event ID and works before or after cleanup.
Never reuse event IDs. A repost is an independent attributed snapshot;
deleting the original does not delete someone else's repost event.

Following checks at most 20 merged entries with at most 20 tombstone point
reads and, when those lookups complete, returns one row-or-null slot per entry.
Render only non-null slots (`(page.data ?? []).filter(row => row !== null)`);
a removed slot contains no body.
Keeping one slot per source entry preserves the merge's cursor. It assumes
removals are rare: a rendered page may be short or empty with `complete: true`,
meaning this source page was fully checked, not that 20 live entries were
found. Continue through `next` even on an empty rendered page;
the cursor advances over the source entries, including removed ones. A
meter cut or incomplete input keeps `complete: false`. A cut tombstone lookup
is unknown, never false: the whole result is withheld as `data: null`, with
`complete: false` and no `next` past an unchecked event. No removed event or
body is returned by that read. No refill loop spends an unbounded amount of
work trying to fill a page.

The minute schedule runs `purgeRemoved` as the system, one removed event
per chunk. The event index and cap bound each chunk to 1,001 private copies
(the 1,000-follower cap plus the author's own copy), including old pushed
events acquired after promotion. Each chunk deletes every remaining copy
and its tombstone in the same transaction, so no stale copy can reappear.
Source deletion prevents concurrent follows from backfilling it; unfollow
can only reduce the work. A refused chunk stays parked with its refusal.
The removal mutation enqueues no job; the existing bounded schedule does.

Limits: 1,000 follows per account, 1,000 source events per actor, 50,000
private entries per reader, 32 pulled authors per reader and 32,000 public
broadcast entries, and 32,000 pending tombstones (1,000 per actor); reaching
a cap refuses the write atomically, so archive
or redesign before exceeding this envelope. A follow backfills 200 events,
not an unlimited historical archive. Public broadcast rows reach every
device; at the measured envelope that is 200 rows, plus any pending removal
tombstones. Cleanup is a bounded job; no exact horizon maintenance is involved.

A merge lane may name another table (`broadcast[p.authorId]`); it must
have the header table's columns and the same plain index. The first lane
uses the header table, which owns the cursor. Each lane keeps its own read
rule and sync. IDs identify the same item across projections: give distinct
items distinct IDs, and keep an item's ordering fields consistent when
copying it. The merge deduplicates IDs and returns one cursor page. `cap N`
without `by` bounds the whole table. `N_SPARSE_FILTER` warns when an
unscoped `where` pins no index prefix; use this recipe for Following rather
than filtering the global timeline.

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

table likes:
  postId: posts
  principal: principal
  unique byPostPrincipal: postId, principal
  public 'likes are public'
  insert <- .principal = viewer
  delete <- .principal = viewer

maintain likeCounts: count likes by postId
  read <- allow

query trending():
  day = posts[at > now - 86400000] first 8192 by byTime { id, at, likes: likeCounts[.id] }
  return slice(sort(day, '-likes', '-at'), 0, 10)

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
    upsert ranked[p.id] { postId: p.id, score: postScore[p.id] * 10 - ageHours, at: p.at }
schedule rescoreEvery every 5m: rescore

query home(c: cursor ?):
  return ranked after c last 50 by byScore { *, post: posts[.postId], seen: exists seen[viewer, .postId], mine: votes[.postId, viewer], lift: affinity[viewer, .postId] }

mutation vote(postId: posts, direction: int):
  require exists posts[postId] else POST_NOT_FOUND
  require direction = -1 or direction = 0 or direction = 1 else INVALID_VOTE
  upsert votes[postId, viewer] { postId, principal: viewer, direction } -- predicts the first offline vote when the post is held

mutation markSeen(postId: posts):
  require exists posts[postId] else POST_NOT_FOUND
  return insert seen { readerId: viewer, postId, at: now } if absent

mutation setAffinity(readerId: principal, postId: posts, score: int):
  require exists posts[postId] else POST_NOT_FOUND
  upsert affinity[readerId, postId] { readerId, postId, score, at: now }
```

`trending()` seeks the trailing day and ranks it when the scan and score
lookups fit the 8,192-row examined ceiling. A cut score lookup is unknown,
so the query withholds its ranking as `data: null`, `complete: false`, with
no `next`. When the day outgrows the ceiling, use the maintained `ranked`
recipe beside it.

A maintain that groups by something other than its source's audience (a
score by post over private votes) reaches no device as a value; the job's
`ranked` row is what puts the score on every device. Time decay is the
cadence: the order refreshes when the job runs. A native job (guide native)
can score with floats and a real loop; the tables and the sync are the
same.
