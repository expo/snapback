# Feeds: Global, Following and Trending

Feeds present public originals and reposts as Global, Following or Trending.
Views define the event stream; a predicate read selects the trending posts.

## Global: a union view

Each original and repost is one event. The union reads each source's rules
before projection. It stores no extra rows. Equal source ids from different
branches remain distinct; include the branch's `repost` flag in a list key.

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

## Following: a view for the reader

Declare the view before adding posts, reposts or follows. This standalone
program includes replies in `posts` but selects only originals for the feed.
The three sources are public, fully synced and writable only by their owners.

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
  unique actorId, postId
  immutable actorId, postId, at
  public 'public reposts'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public

table follows:
  followerId: principal
  followedId: principal
  unique followerId, followedId
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

## Trending: a bounded predicate read

Put the count on the post. A like updates it in the same transaction.
Both time bounds define the rolling window; the compiler chooses the plan.
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

This example runs online. Pass `next` as `c`. A crowded window boundary or
meter cut makes the page incomplete. Likes can move a post across a cursor;
refresh the ranking as time passes. The upper bound excludes future events.

## Following contract

- Events appear newest first by event time, then event id.
- Your own events appear immediately. Followers receive new events shortly
  after, normally within a second on an idle host.
- Following someone copies their newest 50 live events immediately, then the rest
  of a 1,000-event window. Older posts remain in `posts` and are not copied.
- Unfollow hides that actor on the next read.
- `complete` is false while your backfill or cleanup is pending. It describes
  delivered inbox contents; pending delivery of a new event does not change it.
- Removal hides the event immediately. Removing an original keeps its card and
  independent reposts; a new repost requires a live original.

Following exposes `id`, `post`, `actor`, `at` and `repost`. Key its list by event
`id`; each repost has its own event id. To include the post card, append
`{ *, card: posts[.post] }` to the read. Do not hide an independent repost just
because its original card has `removed: true`.

Render an incomplete result as incomplete. Continue with `next` when present.
If a meter cut returns no continuation, retry the same cursor after cleanup.
Cursors are not snapshots: concurrent writes can change what later pages show.

Devices predict their own event's own-inbox copy when inputs are held and
covered. Follow and unfollow queue without prediction. Offline reads use the
last synced follows, removals and cards; remote changes arrive on reconnect.
Use the normal pending-write, freshness and completeness state (`guide app`).

## Boundaries and refusals

Following requires three distinct public, fully `sync public` source tables,
owner write rules and immutable actor/time/reference fields. The follow table
has one declared unique follower/followed principal pair. The originals filter
uses immutable row-local fields except the one-way removal flag. Private
sources, expiry, source horizons and hard deletion of original cards are refused;
do not widen a private audience to fit this shape.

Declare before source events or follows exist. Keep a populated declaration
unchanged. Seed through application mutations or restore a complete trusted
persistence image; importing source rows cannot reconstruct delivery history.
In development, use a fresh store when changing the declaration.

| Code | Meaning and next step |
|---|---|
| E_VIEW_FEED_SHAPE | The projection or viewer predicate is unsupported. Use the activity and Following views above |
| E_TIMELINE_SHAPE | The sources do not fit Following. Keep three distinct public sources, full sync and owner rules |
| E_TIMELINE_FOLLOWS | The edge key is invalid. Declare the immutable unique follower/followed pair |
| E_TIMELINE_FILTER | Selection is not stable. Make selection columns immutable; use `.parentId = null and not .removed` |
| E_TIMELINE_REMOVAL | Removal must be one-way. Insert false, change only false → true and retain the original card |
| E_TIMELINE_READ | The read is not one viewer's newest-first page. Read `following last 20 by .at after c`, then shape the rows |
| E_TIMELINE_OWNED | Derived rows belong to the engine. Write posts, reposts or follows |
| E_TIMELINE_SERVER | The mutation needs server-only state. Queue it without predicted rows |
| E_TIMELINE_ACTIVATE | Source events or follows already exist. Declare before adding them |
| E_TIMELINE_REDEFINE | A populated declaration changed. Keep it unchanged |
| E_TIMELINE_IMPORT | Import cannot reconstruct delivery history. Use application mutations or a trusted complete restore |
| FEED_POST_NOT_FOUND | A new repost needs a live original. Refresh the source |
| FEED_EVENT_REMOVED | A removed event cannot be resurrected. Use a fresh event id |
| FEED_CANNOT_FOLLOW_SELF | Self-follow is refused. Own events already appear without it |
| E_RULE | A non-owner `remove` is refused; remove only your own post |
| N_SPARSE_FILTER | A residual predicate may reject many rows. Use the Following view, or pin the deciding columns for another read |

N_PUBLIC_AGGREGATE_COPY names a public derived column whose ordinary write rules
allow arbitrary values. Use `likeCount: count likes` for an engine-owned count;
for another copied value, pin its source in both write rules (`guide maintains`).

Full public source partitions and the private inbox reach the device. A small
page does not bound acquisition or storage. Measure populated data with
`snapback4 test --residency --as <principal>`; inspect dependencies with
`snapback4 check --residency --verbose`. If a maintained count is synced,
N_MAINTAINED_COLUMN_STREAM warns that each contributing commit streams the
whole parent image to each holder (`guide maintains`).

## How it works

A post commits a durable delivery record with the source and own inbox copy.
Delivery and cleanup run in metered chunks of 256; each cursor commits with its
writes. A crash resumes from that cursor without duplicate copies. Follow uses
an edge epoch and a 1,000-event window. Transaction sequence and write ordinals
separate backfill from later delivery, so delayed delivery cannot enlarge history
or revive an old follow. Reads check the current edge epoch and removal tombstone
for every examined row. Removal purges copies before tombstone retirement.
`snapback4 doctor` lists pending and parked work.

A merge cursor from generation N can
continue after compatible adoption; a direct page cursor binds its generation.

## Older spellings that still compile (do not use in new apps)

The older recipe measurement used 40 events with the newest 20 removed.
Returning the remaining 20 took 82 examinations, including 41 tombstone probes;
a 25-examination ceiling returned an incomplete empty page without `next`.
These are measurements of the older recipe, not the Following view above.

FEED_ORIGINAL_REQUIRED and FEED_NOT_AUTHOR belong to older recipe operations:
pass an original event to their original-event operation and remove only its
author's event. The current `remove(postId: posts)` instead refuses a non-owner
with E_RULE; a repost reference does not have the `posts` parameter type.

The older declaration and viewer-keyed read remain accepted:

```quarry
table oldPosts:
  author: principal
  at: time
  removed: bool default false
  immutable author, at
  public
  insert <- .author = viewer
  update <- .author = viewer
  sync public
table oldReposts:
  actor: principal
  post: oldPosts
  at: time
  unique actor, post
  immutable actor, post, at
  public
  insert <- .actor = viewer
  delete <- .actor = viewer
  sync public
table oldFollows:
  follower: principal
  followed: principal
  unique follower, followed
  immutable follower, followed
  public
  insert <- .follower = viewer
  delete <- .follower = viewer
  sync public
maintain oldFeed: timeline
  events oldPosts by author, at removed by removed
  reposts oldReposts by actor, post, at
  edges oldFollows by follower, followed
query oldHome(c: cursor ?):
  return oldFeed[viewer] after c last 20
```

`authors` and `size` lines are unused compatibility inputs. Remove them;
N_TIMELINE_COMPAT reports their presence and E_TIMELINE_SIZE rejects invalid
old sizing syntax. N_TIMELINE_PROFILE_CAP means an older profile cap is below
the declared author count; raise it or keep the intentional application limit.
Do not add sizing or promotion logic to a new application.

Installed recipes and bridges retain their existing behavior. E_RECIPE_RETIRED
means the installer wrote nothing; use the new view for a new app. Existing apps
must follow the [adoption instructions](https://github.com/expo/snapback/blob/main/snapback4/crates/snapback4-lang/src/recipe/ADOPTION.md),
including paused writes and dependency-ordered backfill. There is no in-place
conversion of populated source tables to a newly declared Following view.

For those installed recipes, FEED_PULL_CAP means the caller uses all 32
shared-author slots. Unfollow a shared author and retry with a new write ID.
FEED_PROMOTION_PULL_CAP means another follower is full: the follow and promotion
roll back. Every saturated follower must free a slot; freeing only the caller's
slot cannot repair it. A server-run query over public follows and pullCounts can
find `used = 32` blockers in 51 reads. Do not expose private route author ids.
FEED_PULL_COUNT_MISSING requires a consistent trusted restore of routes/counts;
FEED_AUTHOR_NOT_FOUND requires the author's registered profile.

FEED_APP_NOT_FOUND means a mapped profile, card or repost is absent. Refresh it;
a typed reference does not prove existence. FEED_APP_OWNER requires the mapped
row's owner. FEED_APP_EVENT means a bridge disagrees with its card's author or
time: stop adoption and reconcile the mapping. Only the existing recipe's own
mutations may write its authors, pulls, broadcast or feed projections; their
permissive write rules depend on those helpers to pin ownership and recipients.
