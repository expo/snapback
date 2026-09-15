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
  eventId: id                       -- shared identity across source and tombstone tables; checked by the insert rule
  actorId: principal
  unique byEvent: eventId
  by byActor: actorId, id
  immutable eventId, actorId
  cap 1000 by actorId
  cap 32000
  public 'removal of a public source event is public; id is the eventId'
  insert <- .actorId = viewer and .id = .eventId and exists posts[id = .eventId, actorId = viewer]
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
  return merge feed after c last 20 by byReaderTime where not exists removedEvents[eventId = .eventId]:
    [viewer]
    broadcast[p.authorId] for p in pulls[viewer] first 32 by byReaderAuthor

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
The tombstone's insert rule requires its ID to equal the event ID and the
writer to own the existing source. Keep `removeEvent`, called by these two mutations,
as the only tombstone insert: it writes the marker before deleting the source
in the same transaction. A guessed foreign event ID cannot hide or purge it.
The immutable inbox `eventId` joins that tombstone on every Following read:
removal is visible immediately on the server and on a device once it applies
that commit, before private copies are purged. An offline device sees its
last synced state. No private inbox or follow graph is additionally synced.
These mutations, like `createPost` and `repost`, queue without prediction
because their source reads are online-only. Repeating a removal is a no-op;
re-reposting creates a fresh event ID and works before or after cleanup.
Never reuse event IDs. A repost is an independent attributed snapshot;
deleting the original does not delete someone else's repost event.

Following checks removal inside each merge lane's `where` predicate, after
that lane's read rule and before emitting an entry. Each tombstone lookup
is a metered probe against the public, fully synced `removedEvents` table.
If the predicate cuts, the scan stops before that entry: no unchecked event
ID or body is returned. Already checked live entries may remain in the page;
a cut page reads `complete: false` and has no `next`, since the merge's
shared cursor cannot safely advance every unfinished lane. Retry the same
cursor after cleanup; there is no cut continuation. This recipe does not change ordinary point-read or read-rule
probe semantics.

Pages contain live rows without null slots. The cursor query fills up to
20 live entries, continuing through removed entries under the same meter;
with all lanes uniform and in budget it is complete at 20 matches or the
end, and `next` continues after the last returned live entry. More removals
cost more examinations and probes, so a long removed run can still cut the
page. At the 40-event test with its newest 20 removed, the first live page
uses 82 examinations and makes 41 tombstone probes, returning 20 live rows and
a continuation; ceiling 25 returns no rows, incomplete, without a cursor.
Following uses the eager merge path: its inbox and broadcast lanes read
different tables. Filtered lanes discovered by `for` also use that path,
so each predicate sees its own discovery row throughout pagination.
Uniform lanes with fixed prefixes on one seekable plain index can still
use the lazy merge path.

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

`where predicate` follows `by index` in a merge header and applies to every
lane, with `.` bound to that lane's row. Its expressions, reads and helper
bodies follow ordinary filtered-scan rules. Keep `after c`: a merge without
a cursor remains incomplete when more matches exist.

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

A maintain that groups by something other than its source's audience (a
score by post over private votes) reaches no device as a value; the job's
`ranked` row is what puts the score on every device. Time decay is the
cadence: the order refreshes when the job runs. A native job (guide native)
can score with floats and a real loop; the tables and the sync are the
same.

## Trending: predictable likes, scheduled rank

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
  by byScore: score, at, id
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
  require exists posts[postId] else POST_NOT_FOUND
  return insert likes { postId, principal: viewer } if absent

mutation unlike(postId: posts):
  delete likes[postId, viewer]

query myLike(postId: posts):
  return exists likes[postId, viewer]

job scoreTrending():
  chunk p in posts first 100 by byId:
    if p.at > now - 86400000 and p.at <= now:
      upsert ranked[p.id] { postId: p.id, score: likeCounts[p.id], at: p.at, expiresAt: p.at + 86400000 }
schedule trendingEvery every 1m: scoreTrending

query trending(c: cursor ?):
  return ranked after c last 10 by byScore { *, post: posts[.postId] }

query trendingNow():
  day = posts[at > now - 86400000, at <= now] first 8192 by byTime { id, at, likes: likeCounts[.id] }
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
score/time/id order, including ties; a rescore can move rows between pages.

For an immediate answer, the live bounded query `trendingNow()` ranks the
trailing post day up to the 8,192-row examined ceiling. A day or its nested
reads past the meter is `complete: false`, so its top ten is of an incomplete
set. A maintain over expiring likes cannot replace that with an exact value
index (`E_QUARRY_MAINTAIN_EXPIRE`): stored contributions survive until the
sweep, while live values change at expiry. Rechecking only stored winners
can miss another group's new rank. Use this scheduled recipe when score lag
is acceptable; it does not promise exact rolling-like-window ranking.
