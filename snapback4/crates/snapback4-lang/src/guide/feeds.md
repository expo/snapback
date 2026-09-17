# Feeds: complete Following with a small celebrity merge

> Adopt: `snapback4 init --recipe feeds --prefix feed`\
> Writes `snapback/feed.q` and typed `src/following.ts`; then run `snapback4 check`.\
> After loading your fixture: `snapback4 test --residency --fixture <fixture-directory> --as <principal>`.\
> A read-time merge is fine when the follow count is bounded small.

Add it to an existing project, including `init --expo`, or start an empty
directory with the normal starter plus the recipe. If the app already owns
`posts` or `follows`, run `snapback4 init --recipe feeds --prefix feed`.
The prefix renames every recipe declaration and reference through its syntax
tree: `posts` becomes `feedPosts`, `deliver` becomes `feedDeliver`, and
`following` becomes `feedFollowing`. Index names are table-local and stay
unchanged, including the matching inbox/broadcast indexes. Columns, local
variables, comments and strings keep their spelling. Any Quarry identifier
can be the prefix. The module remains `snapback/feed.q`, so the prefixed API
is `api.feed.feedFollowing` and the schedule calls `feed.feedPurgeRemoved`.

Existing destination files and non-directory parents refuse before any
write. Init compiles the existing sources plus the recipe in memory first;
unprefixed clashes name both declarations and print the prefixed command.
An app declaration that shadows an unrenamed recipe reference, such as the
builtin `count`, also refuses and names the declaration and its file. Rename
that app declaration and its callers before installing; a prefix cannot
rename a builtin. App helpers named `copy` or `deliver` remain separate
from the prefixed recipe helpers.
A write failure removes newly created files and preserves `.gitignore`.
The block below is the unprefixed source; init qualifies its schedule target.
With a prefix, init also converts its standalone mutations to `fn` helpers.
Qualified schedule targets in another module keep their names, even when
a recipe job has the same name.

Size the installation before replaying an existing app:

```sh
snapback4 init --recipe feeds --prefix feed --authors 1008 --edges 5921
```

`init` prints every written cap, including the fixed per-account caps, on
its stdout line, plus `backfill/author`. A successful install prints the
cold-row measurement command once; subsequent checks do not repeat it.
Replace `<fixture-directory>` and `<principal>` with your fixture directory and reader.
`--authors N` and `--edges N` set the global author and
follow-edge caps; omitted flags keep 1,000 and 100,000 respectively.
The newest-event backfill bound is `clamp(authors, 200, 917)`: 917 by default
and for `--authors 1008`, or 200 for `--authors 50`. The lower clamp preserves
the earlier 200-event history window; no separate backfill flag is needed.
An edges-only install uses the default author count. The upper bound reserves
107 of the 1,024 mutation writes: two per pull route for the author and 51
followers, one recipe edge, one promotion update and one app edge. Additional
app writes need their own allowance. The 1,000-event per-actor cap and source
scan/unfollow bounds stay coupled; growing the global author cap cannot
exceed the backfill's write allowance. A smaller backfill reduces copied
history and writes, but not the source page's metered cost: it still reads
`last 1000`. A one-follower backfill examines 1,005 rows with either 200 or
917 copies. Shrinking `--authors` is not a way to reduce that scan cost.
They change only the installed module, not the app's own tables. For room
beyond this fixture, use `--authors 2000 --edges 200000`. Grow the app's
profile and follow caps too if they would otherwise refuse first.

Sizing refuses with `E_RECIPE_CAPS` before writing any file if a flag is
missing its positive 32-bit integer, edges exceed authors × 1,000 (the
fixed follower cap), or the derived route budget cannot fit one full
follower group plus its author: `32 × authors >= min(edges, 1000) + 1`.
Authors must be at most 134,217,727 so that multiplication fits a Quarry cap.
These are schema bounds, not a promise the engine can process that many
rows in one operation. The runtime meters still decide each operation.

| Cap | What grows together; cost |
|---|---|
| Authors / edges | The flags set their global caps; each stored row is public and reaches every device. The wired app also stores its own profile and edge rows. |
| Pull routes / online counts | Both global caps grow to `32 × authors` (32,000 by default). Routes cost server storage and at most 32 acquired rows for their reader; each installed reader's count costs one server-only row and no acquisition. Unregistered readers can follow too, so this remains a finite global routing budget, not a guarantee for every possible graph. |
| Source events / broadcast / tombstones | Fixed globals: 60,000 / 32,000 / 32,000. Every stored row reaches every device. Removal temporarily adds a tombstone until the purge finishes. App post cards and repost attribution add their own acquisition. |
| Follows per reader / followers per author | Both stay at 1,000. The follower cap, promotion/delivery loops, inbox's 1,001 copies per event and purge loop must grow together if edited by hand; larger writes can hit the unchanged meter. |
| Events and tombstones per actor / inbox per reader and actor | Each stays at 1,000. The source scan and unfollow loop cover 1,000 rows; a follow visits the newest `clamp(authors, 200, 917)` events, copying only pushed events. At the default backfill, 83 inbox slots remain for new deliveries before removal cleanup. |
| Inbox per reader / pulls per reader | Fixed at 50,000 / 32. The former bounds private cold acquisition; the latter bounds the merge's pulled lanes and its per-read work. Growing them requires revisiting the query and its meter, not just global sizing. |

Small accounts write each reader's private inbox. On a successful 51st follow,
future events go into one public broadcast projection; the earlier events
keep their delivery mode. Follow backfills from the latest 917 source events by default,
and unfollow deletes every private entry by that actor and drops the pull
lane. The reader's own posts and reposts need no self-follow edge.
Entries carry the app post ID and attribution, without copying a text body.
Join the app's card at read time as shown below; its residency decides whether
that card can answer on the device.

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
  cap 1000
  public 'delivery mode is public'
  insert <- .principal = viewer
  update <- allow
  sync public

table follows:
  followerId: principal
  followedId: principal
  at: time default 0
  unique byPair: followerId, followedId
  by byFollowed: followedId, followerId
  cap 1000 by followerId
  cap 1000 by followedId
  cap 100000
  public 'the follow graph is public'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public

table pulls:
  readerId: principal
  authorId: principal
  unique byReaderAuthor: readerId, authorId
  cap 32 by readerId
  cap 32000
  read <- .readerId = viewer
  insert <- allow
  delete <- .readerId = viewer
  sync

table pullCounts:                 -- server-only slot accounting; never lists installed authors
  readerId: principal
  used: int
  unique byReader: readerId
  cap 32000
  public 'only the number of installed pulls is public; routes stay reader-private'
  insert <- allow
  update <- allow
  delete <- .readerId = viewer
  online only

table posts:                       -- originals and attributed reposts, one source event each
  actorId: principal
  authorId: principal
  postId: id
  repost: bool
  at: time
  shared: bool
  unique byActorPost: actorId, postId, repost
  by byActorTime: actorId, at, id
  by byTime: at, id
  cap 1000 by actorId
  cap 60000
  immutable actorId, authorId, postId, repost, at, shared
  public 'original posts and attributed reposts are public'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public

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

table feed:                        -- private inbox, with app post references
  readerId: principal
  eventId: posts
  actorId: principal
  authorId: principal
  postId: id
  repost: bool
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
    insert broadcast { readerId, eventId: p.id, actorId: p.actorId, authorId: p.authorId, postId: p.postId, repost: p.repost, at: p.at }
  else:
    insert feed { readerId, eventId: p.id, actorId: p.actorId, authorId: p.authorId, postId: p.postId, repost: p.repost, at: p.at }
  return null

mutation register():
  insert authors { principal: viewer } if absent
  return null

fn tryPull(readerId: principal, authorId: principal):
  if readerId = viewer:
    if exists pulls[readerId, authorId]:
      return true
  slots = pullCounts[readerId]
  used = 0
  if slots != null:
    used = slots.used
  if used = 32:
    return false
  -- Foreign inserts happen only on an author's first promotion: no route
  -- for that author exists yet. Never probe another reader's private route.
  insert pulls { readerId, authorId }
  upsert pullCounts[readerId] { readerId, used: used + 1 }
  return true

fn addFollow(authorId: principal):
  require authorId != viewer else FEED_CANNOT_FOLLOW_SELF
  a = authors[authorId] ! else FEED_AUTHOR_NOT_FOUND
  if exists follows[followerId = viewer, followedId = authorId]:
    return null
  if a.shared:
    require tryPull(viewer, authorId) else FEED_PULL_CAP
  insert follows { followerId: viewer, followedId: authorId, at: now }
  if not a.shared:
    near = follows[authorId] first 51 by byFollowed
    if count(near) > 50:
      -- Check the caller first so their own full slots name their own repair.
      require tryPull(viewer, authorId) else FEED_PULL_CAP
      update authors[authorId] { shared: true }
      tryPull(authorId, authorId)
      for f in follows[authorId] first 1000 by byFollowed:
        require tryPull(f.followerId, authorId) else FEED_PROMOTION_PULL_CAP
  visited = 0
  for p in posts[authorId] last 1000 by byActorTime:
    if visited = 917:
      break
    visited = visited + 1
    if not p.shared:
      copy(p, viewer, false)

  return null

mutation follow(authorId: principal):
  return addFollow(authorId)

fn dropFollow(authorId: principal):
  if not exists follows[followerId = viewer, followedId = authorId]:
    return null
  for e in feed[viewer, authorId] first 1000 by byReaderActor:
    delete feed[e.id]
  if exists pulls[viewer, authorId]:
    delete pulls[viewer, authorId]
    slots = pullCounts[viewer] ! else FEED_PULL_COUNT_MISSING
    if slots.used = 1:
      delete pullCounts[viewer]
    else:
      update pullCounts[viewer] { used: slots.used - 1 }
  delete follows[followerId = viewer, followedId = authorId]

  return null

mutation unfollow(authorId: principal):
  return dropFollow(authorId)

fn deliver(p: posts):
  if p.shared:
    copy(p, viewer, true)
    if not exists pulls[viewer, viewer]:
      copy(p, viewer, false)
  else:
    copy(p, viewer, false)
    for f in follows[viewer] first 1000 by byFollowed:
      copy(p, f.followerId, false)
  return null

mutation createPost(postId: id):
  require not exists removedEvents[eventId = postId] else FEED_EVENT_REMOVED
  a = authors[viewer] ! else FEED_AUTHOR_NOT_FOUND
  p = insert posts { id: postId, postId, actorId: viewer, authorId: viewer, repost: false, at: now, shared: a.shared }
  deliver(p)
  return { id: p.id }

mutation repost(eventId: posts):
  original = posts[eventId] ! else FEED_POST_NOT_FOUND
  require not original.repost else FEED_ORIGINAL_REQUIRED
  if exists posts[viewer, original.postId, true]:
    return null
  a = authors[viewer] ! else FEED_AUTHOR_NOT_FOUND
  p = insert posts { postId: original.postId, actorId: viewer, authorId: original.authorId, repost: true, at: now, shared: a.shared }
  deliver(p)
  return { id: p.id }

fn removeEvent(p: posts):
  require p.actorId = viewer else FEED_NOT_AUTHOR
  insert removedEvents { id: p.id, eventId: p.id, actorId: viewer }
  if p.shared:
    delete broadcast[viewer, p.id]
  delete posts[p.id]
  return null

mutation deletePost(postId: posts):
  p = posts[postId]
  if p != null:
    require not p.repost else FEED_ORIGINAL_REQUIRED
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

The installable Following recipe reserves `FEED_` for all its authored refusals.
Generic application codes such as `POST_NOT_FOUND` have no global recipe meaning.

FEED_EVENT_REMOVED means an event with this post ID was already removed.
For example, republishing a deleted post while its removal marker is retained
refuses. Mint a new post ID for a new event; do not resurrect the removed one.

FEED_ORIGINAL_REQUIRED means the requested event is itself a repost.
For example, reposting a repost refuses. Pass the original event instead;
only an original event can be reposted or removed through the original path.

FEED_NOT_AUTHOR means the caller does not own the event being removed.
For example, removing another actor's repost refuses. Remove the caller's
own event; the original author can remove the original through its own path.

FEED_PULL_COUNT_MISSING means an installed pull route has no matching count row.
For example, importing a route without its `pullCounts` row makes `unfollow`
refuse atomically. Repair the imported count to match that reader's installed
routes before retrying with a new write ID; normal helpers update both together.

FEED_CANNOT_FOLLOW_SELF means the recipe was asked to follow the caller's own account.
Keep the caller's own posts through the recipe's own delivery lane; follow a
different author instead.

FEED_AUTHOR_NOT_FOUND means the target author has not registered in the recipe.
Call `register` during that author's profile creation, then retry the follow
with a new write ID after registration succeeds.

FEED_POST_NOT_FOUND means the recipe could not find the requested source post/event.
For example, a repost of a deleted event refuses. Refresh the source lookup and
pass an existing event reference; a prefixed app bridge validates its own post
before calling the recipe helper.

Call `register` during profile creation. `follow` and `unfollow` are
idempotent; promotion is permanent and atomic with the follow that triggers
it. Promotion requires a pull lane for every follower, including the triggering
reader. The caller is checked first: their own full 32 shared-author slots
refuse `FEED_PULL_CAP`. If another follower already uses all 32 slots,
`FEED_PROMOTION_PULL_CAP` refuses the whole follow/promotion transaction,
including the app edge, author mode, routes and counts. Existing followers
keep receiving private pushes; no follower is silently skipped.

Show the refusal in the app. Have each saturated follower unfollow a shared
author to free a slot, then retry the refused follow with a new write ID.
The triggering reader freeing their own slot does not help a different
saturated follower. If those followers cannot free slots, decline the new
follow and keep the existing pushed delivery; more than 32 shared authors
needs a separate serving design, not a larger cap alone.
Until every saturated follower frees a slot, every later follow of this author
refuses the same way: the author stays at 50 followers and gains no new followers,
possibly indefinitely if a blocking follower is dormant. The newcomer cannot
free that other follower's slot. To tell the author who is stuck, use a
server-run query: `follows` and `pullCounts` are both `public`, so enumerate
`follows[authorId] first 1000 by byFollowed`, then read each follower's
`pullCounts[f.followerId]` and its `used`. After rollback there are 50 followers:
51 reads (one follower scan plus 50 count lookups) identify those with `used = 32`.
An absent count means zero routes. Installed prefixes rename these tables to
`feedFollows` and `feedPullCounts`; the author IDs in private routes stay hidden.
A new follow of an already-shared author with no slot refuses `FEED_PULL_CAP`
atomically, including the app edge; that reader must free their own slot.
`complete` describes the queried lanes' coverage under the meter; promotion
never omits a subscribed follower's route.
Requiring route success adds no writes, so the 107-write allowance and
917-event backfill bound are unchanged; a refusal rolls back attempted writes.
Promotion still attempts a self pull for the author.
A saturated author's own new shared events also get
an own-inbox copy, so their own posts remain visible without a self pull.
Ordinary promotion copies no old entry. A later follow copies only recent pushed
events and reads shared events directly. Private inboxes and the bounded
public broadcast projection sync in full: no exhausted horizon can turn
an empty lane into an incomplete device answer. Unfollow removes private
copies in the same transaction; public broadcast rows remain public but
its removed pull lane no longer reads them. Reposts carry the original
post ID and author, with the reposter as actor, and repeated `repost` calls
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
last synced state. Inbox entries and installed pull routes are readable and
synced only by their reader. Author delivery modes, public follow edges and
public reference events sync in full for registration and post prediction;
app card reads still need the app's declared data. `pullCounts` is online-only:
it exposes only a reader's installed-route count, never the author IDs.
Promotion uses that count to refuse a saturated follower without reading
their routes. The helpers update the count in the same transaction as each route
insert/delete; importing routes directly must import the matching counts too.
The reader deletes their count row when their final route goes; otherwise
unfollow decrements it. Departed readers release the global accounting slot,
and a later follow creates their count row again.
This is an explicit aggregate disclosure, not a claim that routing was already
public. The online count makes `follow` and `unfollow` queue without predicted
rows, even for calls that would not promote an author.
The private inbox retains its full schema-capped partition: a horizon would
make an exhausted lane incomplete. There is no cold-start reduction claim. Repeating a removal is a no-op;
re-reposting creates a fresh event ID and works before or after cleanup.
Never reuse event IDs. A repost is an independent attributed event;
deleting the original does not delete someone else's repost event.

Following checks removal inside each merge lane's `where` predicate, after
that lane's read rule and before emitting an entry. Each tombstone lookup
is a metered probe against the public, fully synced `removedEvents` table.
If the predicate cuts, the scan stops before that entry: no unchecked event
ID is returned. Already checked live entries may remain in the page;
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
or redesign before exceeding this envelope. A default follow backfills at most 917 events,
not an unlimited historical archive. Public broadcast rows reach every
device; at the measured envelope that is 200 rows, plus any pending removal
tombstones. Cleanup is a bounded job; no exact horizon maintenance is involved.
Public source references also reach every device; their cost is measured
below, not included in the 200-row broadcast count. Each reader acquires only
their own pull routes, at most 32; the online counts acquire zero rows.
Default global metadata caps are 1,000 authors, 100,000 edges, 32,000 private pull
routes, 32,000 online count rows and 60,000 source references.

### Cold acquisition and the prediction boundary

Measured by `snapback4 test --residency --fixture fixture --as dev:reader500`
on the wired example below: 502 registered authors, 505 bridged edges
(5 and 500 follows), 526 app cards including one image, and 2 reposts.
Bytes are compact JSON row payloads, excluding transport framing.

The calibration-shaped wired app uses `--authors 1008 --edges 5921`:
1,008 profiles and registered authors, 5,921 bridged edges, 50,228 app post
cards and source events, including a 900-follower celebrity with 49 broadcasts.
The 500-follow reader follows ordinary authors. The fixture imports the
graph before the posts, validates all caps by adoption, then exercises the
real `saveProfile` and `createPost` bridges and streams their changes to
both stores. It uses deterministic short text cards, no media or reposts;
this is the published app wiring at the calibration's shape, not the full
Clique app's chat, likes, media or exact replay history. Those add costs.
Its command is `snapback4 test --residency --fixture fixture --as dev:u0003`.

| Table | 502-author cold rows | Bytes | Calibration cold rows | Bytes |
|---|---:|---:|---:|---:|
| `feedAuthors` | 502 | 39,154 | 1,008 | 59,471 |
| `feedFollows` | 505 | 50,490 | 5,921 | 485,522 |
| `feedPosts` | 528 | 63,830 | 50,228 | 6,769,661 |
| `feedFeed` | 527 | 90,565 | 25,050 | 4,528,458 |
| `follows` (app) | 505 | 46,955 | 5,921 | 444,075 |
| `posts` (app) | 526 | 44,235 | 50,228 | 5,514,010 |
| `reposts` (app) | 2 | 174 | 0 | 0 |
| `profiles` (app) | 0 | 0 | 1,008 | 66,528 |
| `feedBroadcast` | 0 | 0 | 49 | 8,860 |
| Pulls and tombstones | 0 | 0 | 0 | 0 |
| **Total** | **3,095** | **335,403** | **139,413** | **17,876,585** |

**139,413 rows / 17,876,585 bytes is large cold acquisition**, even with
short text cards and no media bytes. Public source references alone add
50,228 rows / 6,769,661 bytes, in addition to the app's post cards. This
cost grows with the public corpus, not just this reader's follows. The CLI
measurement and both-store snapshot test assert the card's rows and bytes.
The calibration reader returns complete 20-entry pages on the server,
memory and SQLite devices with 82 examinations and 21 probes. One shared-host
sample measured 2,923 ms for the server snapshot and 6,404 / 6,700 ms for
memory / SQLite application; these are observations, not timing thresholds
or end-to-end browser startup measurements.

The same fixture acquired 1,055 rows before the prediction change. Five
follows now acquire 2,600 rows / 250,482 bytes. Neither reader has a pull
route in this wired fixture, and online counts contribute 0 rows / 0 bytes.
On the server and both device stores,
Following at 5 and 500 follows returns 20 entries, complete, with 82
examinations and 21 probes. On the same acquired shape, offline `saveProfile`
and `createPost` produce 2 and 3 predicted rows in the two-person witness;
posting with one follower produces 4. `follow` produces 0 predicted rows
and backfills when the server commits it. Thus the acquisition counts above
apply to both the predicting writes and the queued follow, not two variants
with different privacy. Prediction is provisional: server caps and concurrent
changes can still refuse a queued write.

| Operation in the wired example | Offline behavior after acquisition |
|---|---|
| `saveProfile`, `register` | Predict |
| `createPost`, `repost`, `deletePost`, `unrepost` | Predict when the required app cards and source events are held |
| `follow`, `unfollow` | Queue without rows: online slot accounting is server state |
| `following` | Reads the reader's installed lanes on the device |

The standalone recipe has the same boundary: `register`, `createPost`,
`repost`, `deletePost` and `unrepost` are eligible; `follow` and `unfollow`
never predict. The purge is a system job.

The larger recipe envelope (1,000 authors, 50,000 reference events and
1,415 edges) acquires **77,665 rows** for its 500-follow reader, measured
from real snapshots on both stores; 25,050 are private inbox entries and
0 are pull routes. The prior public-routing version acquired 78,566 rows:
901 foreign routes no longer arrive. A five-follow reader acquires 52,915
rows; a celebrity-plus-four reader acquires 52,866, including 1 own pull.
That envelope has no app-card joins. Acquisition still grows with the
capped public source corpus, not only the reader's follow count. Neither
shape predicts a follow that reads online slot accounting.

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

## Wire into an app with posts, media and reposts

After installing with `--prefix feed`, keep the app's own `posts`, `follows`
and `reposts`. Fold the corresponding statements below into its existing
mutations; the example is `snapback/social.q` beside the installed module.
Only `feedFollowing` remains client-callable in the prefixed recipe; the
purge job runs as the system, and every former mutation is a `fn` helper
so clients cannot bypass the app's post validation or follow bridge.
Generated `src/following.ts` exports only the Following query wrapper.
`createPost` inserts one reference event and calls `feedDeliver(event)`;
`repost` resolves the original reference event and calls `feedRepost(event.id)`
in the same transaction. The helper takes `eventId: feedPosts`, not an app
`posts` reference; these IDs may differ. It creates and delivers the attributed
event. The app checks the original card and owns its repost attribution.
A new repost needs the original source event; existing reposts survive its removal.
The recipe never owns or copies
the media asset; Following joins `posts[.postId] postCard` and app repost
attribution at read time. Keep the merge in the app's query so its cursor
belongs to that query.

The app's `follow`/`unfollow` mutations are the one-mutation bridge: they
change the app edge and call `feedAddFollow`/`feedDropFollow` atomically.
Route all future follow changes through them, and backfill existing edges
through the same helpers before switching Following to this query. Register
existing authors first; backfill their existing post/repost reference events
before those edges so follow backfill can find them. Respect the recipe's
installed backfill bound and caps. The unprefixed recipe keeps its standalone
operations for a standalone reference-event model. A prefixed install exposes
only the app's bridged mutations; `feedRegister()` belongs inside `saveProfile`.
Call `feedDeliver` once per event the app inserts; `feedRepost` delivers its own
new event. Copy inserts are unconditional:
a new source or new follow already establishes that this delivery is new,
without an unknowable `if absent` probe into another reader's private inbox.
The backfill loop covers the 1,000-event schema cap and stops after the
newest `clamp(authors, 200, 917)` events; promotion and delivery loops cover the graph cap.
Follow and unfollow queue because their slot accounting is online-only;
profile saves and post creation remain eligible after acquisition.
New follow edges record `at: now`; an idempotent repeated follow preserves it.

This example fully syncs public post cards and repost attribution under
explicit caps. That adds their rows to acquisition; a private or online-only
app card keeps its own rule/residency, and a horizon can make a card join
incomplete. This is not a claim that the recipe makes arbitrary app cards
available offline. Here `deletePost` removes the feed event and retains the
app card so another author's independent repost can still render it. Choose
an explicit deleted-card representation if the app also removes the content;
never reuse an event ID. `unrepost` removes its event and app attribution.

```quarry
-- After: snapback4 init --recipe feeds --prefix feed
-- These are the app's tables and mutations in snapback/social.q.
table posts:
  authorId: principal
  body: text <=4000
  media: image <=1000000 ?
  at: time
  cap 60000
  public 'app post cards are public'
  insert <- .authorId = viewer
  sync public

table follows:
  followerId: principal
  followedId: principal
  unique byPair: followerId, followedId
  cap 1000 by followerId
  cap 100000
  public 'the app follow graph is public'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public

table reposts:
  actorId: principal
  postId: posts
  at: time
  unique byActorPost: actorId, postId
  cap 32000
  public 'app repost attribution is public'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public

table profiles:
  principal: principal
  name: text <=100
  unique byPrincipal: principal
  cap 32000
  public 'profile names are public'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public

shape postCard = { id, authorId, body, media, at }

mutation saveProfile(name: text <=100):
  upsert profiles[viewer] { principal: viewer, name }
  feedRegister()

mutation register():
  feedRegister()

mutation follow(authorId: principal):
  insert follows { followerId: viewer, followedId: authorId } if absent
  return feedAddFollow(authorId)

mutation unfollow(authorId: principal):
  delete follows[followerId = viewer, followedId = authorId]
  return feedDropFollow(authorId)

mutation createPost(postId: id, body: text <=4000, media: image <=1000000 ?):
  require not exists feedRemovedEvents[eventId = postId] else FEED_EVENT_REMOVED
  a = feedAuthors[viewer] ! else FEED_AUTHOR_NOT_FOUND
  p = insert posts { id: postId, authorId: viewer, body, media, at: now }
  event = insert feedPosts { id: postId, postId, actorId: viewer, authorId: p.authorId, repost: false, at: p.at, shared: a.shared }
  feedDeliver(event)
  return p postCard

mutation repost(postId: posts):
  original = posts[postId] ! else FEED_POST_NOT_FOUND
  if exists reposts[viewer, postId]:
    return null
  event = feedPosts[original.authorId, postId, false] ! else FEED_POST_NOT_FOUND
  r = insert reposts { actorId: viewer, postId, at: now }
  feedRepost(event.id)
  return { id: r.id }

mutation deletePost(postId: posts):
  event = feedPosts[viewer, postId, false]
  if event != null:
    feedRemoveEvent(event)
  return null

mutation unrepost(postId: posts):
  event = feedPosts[viewer, postId, true]
  if event != null:
    feedRemoveEvent(event)
  delete reposts[viewer, postId]

query following(c: cursor ?):
  entries = merge feedFeed after c last 20 by byReaderTime where not exists feedRemovedEvents[eventId = .eventId]:
    [viewer]
    feedBroadcast[p.authorId] for p in feedPulls[viewer] first 32 by byReaderAuthor
  return entries { *, post: posts[.postId] postCard, attribution: reposts[.actorId, .postId] }
```

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
score/time/postId/id order, including ties; a rescore can move rows between pages.
The post id breaks score/time ties just as it does in `trendingNow()`;
the ranked row's separately minted id comes last.

For an immediate answer, the live bounded query `trendingNow()` ranks the
trailing post day up to the 8,192-row examined ceiling. A day or its nested
reads past the meter is `complete: false`, so its top ten is of an incomplete
set. A maintain over expiring likes cannot replace that with an exact value
index (`E_QUARRY_MAINTAIN_EXPIRE`): stored contributions survive until the
sweep, while live values change at expiry. Rechecking only stored winners
can miss another group's new rank. Use this scheduled recipe when score lag
is acceptable; it does not promise exact rolling-like-window ranking.

## Trending: fresh ranking without a schedule

For a ranking that must be fresh at load time, use the fresh bounded recipe
below. It sorts authoritative live counts before taking the top ten, with no
schedule and no principal-writable score table. The price is read work over
all candidates within the meter, rather than a stored top-N index.

### Calendar-bucket alternative: positively-liked originals

A maintain fits a current-calendar-bucket ranking of positively-liked
originals with id ties. A Trending feed usually wants a rolling window over
post time and zero-like candidates; use the fresh bounded recipe below for
that contract. This narrower alternative indexes the maintained `value`
within the post's calendar day:

```quarry
table posts:
  authorId: principal
  parentId: posts ?
  at: time
  immutable authorId, parentId, at
  public 'posts'
  insert <- .authorId = viewer

table likes:
  postId: posts
  principal: principal
  isOriginal: bool          -- setLike derives this from the authoritative post
  postDay: int              -- setLike derives day(post.at), with UTC offset 0
  at: time
  unique byPair: postId, principal
  by byPrincipal: principal, id
  cap 1000 by principal
  public 'likes'
  insert <- .principal = viewer
  delete <- .principal = viewer

maintain trendScore: count likes where .isOriginal = true by postDay, postId
  read <- allow
  by byScore: postDay, value, id

mutation create(parentId: posts ?):
  if parentId != null:
    require exists posts[parentId] else POST_NOT_FOUND
  return insert posts { authorId: viewer, parentId, at: now }

mutation setLike(postId: posts, liked: bool):
  p = posts[postId] ! else POST_NOT_FOUND
  if liked:
    insert likes { postId: p.id, principal: viewer, isOriginal: p.parentId = null, postDay: day(p.at), at: now } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]

query trending(c: cursor ?):
  return trendScore[day(now)] after c last 10 by byScore { postId, score: .value }
```

The engine updates `trendScore` inside the source transaction. A maintain's target cannot be written by a principal, but
its score is only as trustworthy as the source rows' insert rule and the
mutations that construct those rows. The insert rule pins `principal` to
`viewer`; the unique pair permits one like per viewer per post. `setLike`
derives `isOriginal` and `postDay` from the authoritative post row, never
from caller arguments. The maintain cannot validate these denormalised
facts: its predicate compares row-local scalar columns and literals only,
and the owner rule does not prove the copied facts. `create` sets post time
on the server; post time and parent are immutable in this example.

The costs and limits of this calendar ranking are:

- **Zero-like posts are absent.** Launching with 40 posts and no likes
  returns `[]`. The first like creates a group; the last unlike deletes it.
  `complete: true` does not mean all posts have a candidate row.
- **Old buckets have no age-based retention bound.** A maintain target
  cannot expire or be capped. Each `(postDay, postId)` group stays as long
  as any contributing like remains, even when the query can no longer reach
  its day. The per-principal cap bounds one viewer's likes, not total
  historical groups across all viewers. The bounded recipe
  below selects posts by a live time range without a stored ranking target.
- **The window is the post's calendar day, and the query reads only today's
  bucket.** `day()` here uses UTC, not a rolling 24 hours. At 00:00:01 UTC,
  Trending is empty unless a post created since midnight already has a
  like. A post made at 23:50 that collects 400 likes at 00:10 stays in
  yesterday's bucket and is unreachable by this query from then on.
- **Unlike needs its own permission.** Without the `delete` rule, unlike
  is denied and this insert-only score can only rise. The rule and
  `setLike(false)` above remove only the viewer's own like; repeated set
  and clear calls do not double-count. Each viewer may hold at most 1,000
  likes, and unliking frees a slot.
- **Ties break by descending maintained id, not post time.** The index
  orders `value, id` within a day; the bounded post-window recipe uses score,
  post time and post id. Score changes can move rows between cursor pages;
  neither pagination is a snapshot across writes.
- **Nothing enforces that the writer's bucket offset matches the query's.**
  This block pairs `day(p.at)` with `day(now)`. For an offset, change both
  to `day(p.at, 8h)` and `day(now, 8h)` and rebuild the stored `postDay`
  facts. A UTC writer and an `8h` query can choose different day ordinals
  and silently return an empty ranking; there is no diagnostic for this
  mismatch. Changing only the query does not migrate existing likes.

With no source sync, `trending` is server-run and a load reads the committed
ranking as of that server read. An offline watch can retain its previous
server answer with `fresh: false`, or refuse `E_OFFLINE` without one.
`complete` describes page coverage under the meter, not freshness, rolling
eligibility or validation of the copied facts. An offline answer cannot
promise a fresh ranking.

### Fresh bounded ranking: post window and like window

Use this live bounded query when a window must roll without schedule lag.
`trending()` ranks posts in `(now - 24h, now]`, including zero-like posts,
by count, post time and post id descending. `rollingLikes()` instead ranks
posts of any age by their likes in the trailing 24 hours; zero-like groups
are absent and ties break by post id. A like lives for 24 hours from the
server's `now`. These are different windows; choose the query your feed means.

This standalone recipe keeps likes private and runs the ranking on the server.
A disconnected device can retain that answer with `fresh: false`, not compute
a complete ranking from only its own likes. For a locally computed public-like
variant, change the likes read rule to `read <- allow`, its sync to `sync public`,
and remove `online only` from `likeCounts`. The resulting `N_MAINTAIN_SYNCED`
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
  sync public

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
  require exists posts[postId] else POST_NOT_FOUND
  if liked:
    insert likes { postId, principal: viewer, at: now, expiresAt: now + 86400000 } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]

query trending():
  candidates = posts[at > now - 86400000, at <= now] first 8192 by byTime { postId: .id, at, score: likeCounts[.id] }
  return slice(sort(candidates, '-score', '-at', '-postId'), 0, 10)

query rollingLikes():
  candidates = likeCounts first 8192 by byGroup { postId, score: .value }
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
`rollingLikes` reports its next contribution expiry to the host. The post-time
range in `trending` is evaluated on each query: requery as the clock advances
to remove zero-like posts at the window edge or admit future-dated imports.

**Read cost:** sort the whole bounded candidate set, then slice. The 8,192
examined ceiling is shared with count lookups and live source contributions;
it is not permission to rank 8,192 posts plus their likes. A meter cut preserves
`complete: false` through sort/slice; those ten rows are not a certified global
top ten. The query has no ranking cursor: continuing an unsorted source page
cannot continue its sorted winners. Narrow the candidate scope or accept an
explicitly delayed materialisation when the full live set does not fit.

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

## N_PUBLIC_AGGREGATE_COPY: a public copy keeps ordinary write authority

N_PUBLIC_AGGREGATE_COPY is a note, not an error. A public column is assigned
directly from a declared `maintain`, but `insert <- allow` or `update <- allow`
(or a provably unrestricted equivalent) lets any principal set it through any
mutation that writes it. The column duplicates an aggregate the engine already
keeps. Read the maintain directly, or restrict both insert and update authority
so callers cannot choose the copied value. The fresh bounded Trending recipe
in `guide feeds` reads live counts and has no writable ranking table or copied score.

The client calls declared operations, not arbitrary table writes. This note
identifies latent table permission, not proof that a current mutation accepts
an arbitrary score. It covers direct scalar maintain-to-column assignments in
programs and helpers, including jobs, once per column and maintain. It does not
infer copies from names, matching group keys, increments, aliases or arithmetic.
Restricted rules, private targets and immutable columns do not receive it;
absence of the note is not a proof that a ranking cannot be forged. Sync and
`online only` do not change write authority.
