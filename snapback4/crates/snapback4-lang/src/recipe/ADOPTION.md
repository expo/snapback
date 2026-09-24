# Existing apps with an installed recipe

These adoption instructions apply only to an already installed Following module.
The installer is retired in 0.3. Keep the installed module and its caps; there is
no migration to a declared timeline over its populated event and edge tables.

Call the following helpers inside the existing app mutations. With prefix
`feed`, their signatures and responsibilities are:

| Helper | App mutation responsibility and generated behavior |
|---|---|
| `feedAppRegister(profileId: profiles)` | Insert/save the caller's profile first; checks existence and ownership, then registers the recipe author. |
| `feedAppPublish(postId: posts)` | Insert a new card first; checks its owner/profile, copies its time, creates and delivers its reference event. |
| `feedAppRemove(postId: posts)` | Checks card ownership, resolves and removes the actual original event ID; retains the card. |
| `feedAppRepost(repostId: reposts)` | Insert the caller's attribution first; checks its owner and original card/event, creates and delivers a distinct event using attribution time. |
| `feedAppUnrepost(repostId: reposts)` | Removes the caller's actual repost event and deletes its attribution; absent attribution is already removed. |
| `feedAppFollow(authorId: principal)` | Checks both profiles, inserts the app edge and calls recipe follow atomically. |
| `feedAppUnfollow(authorId: principal)` | Deletes the app edge and calls recipe unfollow atomically. |

For example, after inserting `p` into the app post table, the creation mutation
calls `feedAppPublish(p.id)` and can return the same app card as before. It no
longer constructs `feedPosts` or passes a recipe event reference. A repost
mutation checks for an existing attribution, inserts `r` if absent and calls
`feedAppRepost(r.id)`. Follow/unfollow mutations call only their app helper.
Do not expose a second client mutation for delivery. A refusal rolls back the
app write and delivery together, including a failed shared-author promotion.
Self-reposts remain distinct from originals. Existing reposts survive original
removal; creating a new repost still requires the live original event.

Keep the app's Following merge and card/attribution joins, shown below. The
bridge does not change its cursor, acquisition, prediction boundary, 32 pull
slots or promotion policy. Public cards, profiles and attributions still add
rows to device acquisition; a small page does not bound those source rows.

Publish is for a newly inserted card or the explicit initial backfill below.
Retry an ordinary write with its original write ID. While a matching source
event remains live, repeating publish/repost returns its actual ID without
redelivery; that ID may differ from the app card ID in an older integration.
Remove also resolves the actual ID before writing its tombstone. Never
republish a removed card, even after tombstone purge. This helper is not a
permanent publication ledger: an older event ID's tombstone cannot be found
from the card ID, and purge intentionally erases removal markers. A new post
needs a new card ID. A new repost after unrepost needs a new attribution row
and a live original; replay the old write ID only to recover the old result.

For initial adoption, pause app publishing, removals and follow changes.
Register existing profiles as their owners, then backfill existing original
cards, then repost attributions, and finally app edges through these helpers.
Use bounded calls and checkpoints in that dependency order; repeating a live
event or follow is safe. Original and attribution timestamps are preserved.
Do not run this as an implicit system-viewer job: the helper requires the
actual owner's mutation context. Resolve cap/promotion refusals before
advancing a checkpoint or switching Following. Keep writes paused throughout
adoption, so a removal cannot race a later backfill into resurrecting a card.
The installed recipe's per-author follow backfill bound and caps still apply.

FEED_APP_NOT_FOUND means the mapped profile, post or attribution is absent.
Refresh the reference or resume adoption in dependency order. A typed reference
does not prove that its target still exists.

FEED_APP_OWNER means the caller does not own the mapped row. Call the helper
inside the owner's mutation; a reference does not grant another actor's rights.

FEED_APP_EVENT means a live recipe event disagrees with the selected app author
or timestamp. Reconcile that mapping before resuming; silently replacing it or
delivering another event would change identity and ordering.

## Wire into an app with posts, media and reposts

For an existing `feed`-prefixed module, keep the app's own `posts`, `follows`
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
newest `clamp(authors, 200, 865)` events; promotion and delivery loops cover the graph cap.
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
-- Existing installed feed module; not a new application starter
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
  immutable principal
  unique byPrincipal: principal
  cap 32000
  public 'profile names are public'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public

shape postCard = { id, authorId, body, media, at }

mutation saveProfile(name: text <=100):
  upsert profiles[principal = viewer] { principal: viewer, name }
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
  a = feedAuthors[principal = viewer] ! else FEED_AUTHOR_NOT_FOUND
  p = insert posts { id: postId, authorId: viewer, body, media, at: now }
  event = insert feedPosts { id: postId, postId, actorId: viewer, authorId: p.authorId, repost: false, at: p.at, shared: a.shared }
  feedDeliver(event)
  return p postCard

mutation repost(postId: posts):
  original = posts[id = postId] ! else FEED_POST_NOT_FOUND
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
    feedBroadcast[p.authorId] for p in feedPulls[viewer] by byReaderAuthor
  return entries { *, post: posts[.postId] postCard, attribution: reposts[.actorId, .postId] }
```

### Cold acquisition and the prediction boundary

Measured by `snapback4 test --residency --fixture fixture --as dev:reader500`
on the wired example below: 502 registered authors, 505 bridged edges
(5 and 500 follows), 526 app cards including one image, and 2 reposts.
Bytes are compact JSON row payloads, excluding transport framing.

The calibration-shaped wired app has 1,008-author and 5,921-edge caps:
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
posting or reposting with a foreign private follower still predicts the
ordinary recipe copies. Device reads hide that follower's copy because its
`readerId = viewer` rule fails for the author. The declared timeline skips
its engine-owned foreign inbox copies before writing them. `follow` produces 0 predicted rows
and backfills when the server commits it. Thus the acquisition counts above
apply to both the predicting writes and the queued follow, not two variants
with different privacy. Prediction is provisional: server caps and concurrent
changes can still refuse a queued write.

The standalone recipe's `createPost`/`repost` and installed generated-bridge
calls to `feedAppPublish`/`feedAppRepost` predict the whole ordinary fan-out,
including foreign private copies. Reads hide copies whose `readerId = viewer`
rule fails; the source event and readable copies stay predicted. Settlement
commits or removes the overlay. The declared timeline separately skips foreign
engine-owned copies before writing them.

| Operation in the wired example | Offline behavior after acquisition |
|---|---|
| `saveProfile`, `register` | Predict |
| `createPost`, `repost` | Predict when required app cards and source events are held; reads hide provisional private fan-out to another reader |
| `deletePost`, `unrepost` | Predict when the required app cards and source events are held |
| `follow`, `unfollow` | Queue without rows: online slot accounting is server state |
| `following` | Reads the reader's installed lanes on the device |
