# Feeds: Global, Following and Trending

**Start here:** Combine originals and reposts in a union view, then page it for Global; add the Following view below for per-reader delivery. This social-starter pattern uses the posts and reposts schema below; keep the branch flag in list keys.

```quarry
view activity:
  posts where not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
query global(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post] }
```

- `E_TIMELINE_FILTER`: unsupported selection; use immutable reply keys and `.parentId = null and not .removed` in `view activity`.
- `E_TIMELINE_READ`: the Following page uses another order; use `following last 20 by .at after c`.
- `E_TIMELINE_ACTIVATE`: deployment needs retained-source adoption approval; inspect the copy cost before using `--allow-feed-adoption`.

## Reference

## Global: a union view

Each original and repost is one event. The union reads each source's rules before projection. It stores no extra rows. Equal source ids from different branches remain distinct; include the branch's `repost` flag in a list key. For a moderate corpus without materialization, use planned `home` below.

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
table follows:
  followerId: principal
  followedId: principal
  unique followerId, followedId
  public 'public edges'
  online only
view activity:
  posts where not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
query global(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post] }
query home(c: cursor ?):
  return activity where .actor = viewer or exists follows[viewer, .actor] last 20 by .at after c
query profile(actor: principal, c: cursor ?):
  return posts where .authorId = actor and not .removed last 20 by .at after c
```

Planned `home` scans global time indexes and filters by follows; it is not a guaranteed complete-history reader. Unrelated posts consume work. Sparse history can exhaust the 16 MiB heap or 8,192-examination meter: `complete: false`, no `next`, never a complete empty page. An inbox cursor cannot continue this different reader. Starting below the inbox's oldest event can skip uncopied events from another author. Use the profile reader above for older posts.

## Following: a view for the reader

Dev adopts this view over retained sources automatically; deploy needs `--allow-feed-adoption`. This program excludes replies. The three sources are public and writable only by their owners. Posts and reposts acquire the newest 1,000 rows globally on a cold device.

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
  sync public last 1000 by .at

table reposts:
  actorId: principal
  postId: posts
  at: time
  unique actorId, postId
  immutable actorId, postId, at
  public 'public reposts'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public last 1000 by .at with own keys .actorId

table likes:
  postId: posts
  principal: principal
  at: time
  unique postId, principal
  immutable postId, principal, at
  public 'public likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 2000 by .at with own keys .principal

table follows:
  followerId: principal
  followedId: principal
  unique followerId, followedId
  immutable followerId, followedId
  public 'public edges'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  online only

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
query postState(postId: posts):
  return { liked: exists likes[postId, viewer], reposted: exists reposts[viewer, postId] }
query cards(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post] }
```

Own-key coverage is the default for this social example. The public windows stay bounded; a separate private partition contains every live unique key owned by this viewer. The same `postState` answers online and offline. A never-queried absent key is false and complete only after whole acquisition and catch-up publish durably. A key below the public window can be true without its row being held. Offline answers stay stale until sync; an unseen remote
delete cannot immediately change them. Another principal's missing key is
still unknown outside the public window. Do not render loading as false.

The policy needs non-expiring public windows, immutable total unique keys containing
the principal, and caller-owned writes. Keys must be readable and required; `id` and
`value` are reserved. The compiler chooses one qualifying unique key;
a direct `viewer` owner expression qualifies. Only existence is proved; row fields,
extra predicates, counts and write targets keep their own coverage. Predicted writes
overlay keys transactionally; unpredicted writes stay pending intents.
Sign-out preserves the replica and the owner's proof for an offline reopen as the
same principal. A different caller cannot use that partition's proof; acquire its whole
partition first. Interrupted acquisition/adoption proves no absence. Existing windows do not opt in.

Each viewer pays for lifetime keys plus the public window. The server pays for an
owner index, one maintained row per key and private log events in the source
transaction. Backfill precedes adoption publication. Private key delivery replaces public
interaction summaries; prolific owners remain unbounded. Measure with `client.residency()`.
Devices need the `owner-key-coverage` capability; upgrade before enabling it (`guide sync`).

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

Following deliberately shows each followed actor's newest 1,000 events at follow
time, plus new events afterward. Older posts are on the actor's profile: page with
the single server `profile(actor, c)` query above, passing its `next` as `c`. At the feed's
end (complete, no `next`, not updating), link followed actors: “See older posts on their profile”.

- Events appear newest first by event time, then event id.
- Your own events appear immediately. Followers receive new events shortly
  after, normally within a second on an idle host.
- Following someone copies their newest 50 live events immediately, then the rest
  of a 1,000-event window. The first copy commits on the server with the follow;
  device publication follows sync. Older posts remain in `posts` and are not copied.
- Unfollow hides that actor on the next read after the device observes its edge.
- `complete` is false while your backfill or cleanup is pending, or your own
  follow/unfollow is unsettled or unobserved. New-event delivery alone does not change it.
- Removal hides the event immediately. Removing an original keeps its card and
  independent reposts; a new repost requires a live original.

Key events by `id`; shape `{ *, card: posts[.post] }`, keeping reposts of removed cards.

Source floors are **global and non-sliding**, fixed at acquisition, not per actor.
New arrivals accumulate without eviction. The private inbox acquires its newest
1,000 copies per reader, separately from the history window per followed actor.
Events follow sources: fully synced kinds keep owned event rows; floored kinds keep
event slots on held sources; online-only kinds keep neither. Removal records stay fully synced.
Application follows may use any public residency; the feed uses its private owned edges.

An inbox page within its floor needs no posts. A shaped page is complete offline
only when every card is held too. A recent repost of an old original, or a quiet
author's old post, may need the server even on the first page. A horizon card miss, required online-only card, or inbox scan past its floor withholds the
**whole observation** as `{ loading: true }`, with no data or continuation. Offline,
while a predictable write remains unobserved, or for a `held` query, it stays
withheld. Otherwise the client retries the original input cursor on the server;
a transport failure stays loading. One-shot `query()` settles under `guide client`. Remembered answers never replace this result.

An examined-meter cut above the floor remains partial data with its continuation.
A full page ending at the floor is data; its next page is withheld. Pending
backfill or cleanup stays `complete: false` data. Heap/scalar exhaustion remains
unavailable. The server cannot replace a prediction before it is observed.

Your follow/unfollow call or recovery marks mounted answers `revalidating` (loading
with `keep: false`); re-reads stay incomplete until observation. Then posts appear or
disappear; a quiet author's page is complete and empty. Remaining work stays incomplete.
Render `loading || revalidating || !complete` as “Updating…” before testing
`data.length === 0` for “No posts”. Continue with `next` or retry after cleanup;
cursors are not snapshots.

Devices predict their own inbox copy with held, covered inputs. Follow/unfollow queue
without prediction. Offline reads use last-synced edges, removals and cards until reconnect.
Reposts need a held original, its event slot and a removal probe; otherwise they
queue without a row. A repost horizon can still make unique-pair absence unknown.
`check --verbose` classifies transitions by residency; follow/unfollow stay `predicts: never`.
A synced aggregate over owned events stops prediction only when a transition
inserts or removes an event of a kind that is not fully synced. Replies and body
edits still predict. `check` names the aggregate; argument-dependent filters and
source-slot lookups are decided at runtime. Slot schemas require an event-slot
capability, so older devices refuse installation or adoption until upgraded.
Other owned-event reads withhold on a missing row or a range with an unheld kind;
a key naming a fully synced kind keeps known absence. See pending writes in `guide app`.

## Boundaries and refusals

Following needs three distinct public sources, owner writes, immutable
actor/time/reference fields and a unique immutable follower/followed pair.
The originals filter uses immutable row fields except the one-way removal flag.
Private sources, expiry and hard deletion of cards are refused; keep private
audiences private.

Posts and reposts accept `sync public`, `sync public last N by .at`, or
`online only`. Use the mapped time column; its index must be exactly `(at, id)`.
Follows accept any admitted public horizon order. Online-only cards withhold as
above; their writes queue without prediction. Sync changes advance the generation
and reacquire; returning to full sync reacquires the whole table.

A first-use view atomically starts the feed now: all retained own
events and the newest 1,000 live events per current follow, without refill after
removal. This can include older events a historical inbox never received; repost
ids are fresh. Writes and syncs wait, detached reads keep the predecessor, and
devices drop images and reacquire after commit. `check` (also `--store <path>`) notes the launch contract, copies and lock time
at the view; deploy requires `--allow-feed-adoption`. `serve` attaches the release. Above 5,000,000 copies activation
refuses before starting: use the planned `home` above. Removing a view needs
`--allow-destructive` in deploy; re-add with a fresh name. Redefinition stays
refused. Original ids remain post ids; old edge/delivery history is not restored.
Measured lock: 46.90 s for 340,697 copies (calibration #22 shape), 696.67 s at 10×
(3,407,033 copies). Estimates use 7,000 row writes/s; hardware and load vary.

| Code | Meaning and next step |
|---|---|
| E_VIEW_FEED_SHAPE | The projection or viewer predicate is unsupported. Use the activity and Following views above |
| E_TIMELINE_SHAPE | The sources do not fit Following. Keep three distinct public sources and owner rules; posts/reposts may use `sync public last N by .at` or `online only`, and follows accept full sync, a public horizon, or online only |
| E_TIMELINE_FOLLOWS | The edge key is invalid. Declare the immutable unique follower/followed pair |
| E_TIMELINE_FILTER | Selection is not stable. Make selection columns immutable; use `.parentId = null and not .removed` |
| E_TIMELINE_REMOVAL | Removal must be one-way. Insert false, change only false → true and retain the original card |
| E_TIMELINE_READ | The read is not one viewer's newest-first page. Read `following last 20 by .at after c`, then shape the rows |
| E_TIMELINE_OWNED | Derived rows belong to the engine. Write posts, reposts or follows |
| E_TIMELINE_SERVER | The mutation needs server-only state. Queue it without predicted rows |
| N_TIMELINE_ADOPT | `check` previews automatic dev launch, copies and lock time; deploy requires `--allow-feed-adoption` |
| E_TIMELINE_ACTIVATE | Dev adopts automatically. Deploy needs `--allow-feed-adoption`; the refusal prints the copy estimate and lock time. Above 5,000,000 copies use planned `home`; use fresh owned names |
| E_TIMELINE_REDEFINE | A declaration changed or experimental reconstruction remains. Retire it, deploy and add with a fresh name, or use the planned `home` above; 0.3 stores need their matching engine |
| E_TIMELINE_IMPORT | Import cannot reconstruct delivery history. Use application mutations or a trusted complete restore |
| FEED_POST_NOT_FOUND | A new repost needs a live original. Refresh the source |
| FEED_EVENT_REMOVED | A removed event cannot be resurrected. Use a fresh event id |
| FEED_CANNOT_FOLLOW_SELF | Self-follow is refused. Own events already appear without it |
| E_RULE | A non-owner `remove` is refused; remove only your own post |
| N_SPARSE_FILTER | A predicate rejects many rows. Narrow the read; the planned `home` can fail closed. Materialized Following can adopt retained sources |

N_PUBLIC_AGGREGATE_COPY names a public derived column whose ordinary write rules
allow arbitrary values. Use `likeCount: count likes` for an engine-owned count;
for another copied value, pin its source in both write rules (`guide maintains`).

`check --cost` reports source and owned-table acquisition floors, full-synced
dependencies, the unchanged history window and card fallback. Measure the partition with
`snapback4 test --residency --as <principal>`; inspect dependencies with
`snapback4 check --residency --verbose`. If a maintained count is synced,
N_MAINTAINED_COLUMN_STREAM warns that each contributing commit streams the
whole parent image to each holder (`guide maintains`).

## How it works

A post commits a durable delivery record with the source and own inbox copy.
Delivery and cleanup run in metered chunks of at most 256, yielding between rows
after a short time slice; each cursor commits with its writes. Waiting requests
get the engine before the next chunk, and delivery retains a turn under continuous
request traffic. An item among P pending items gets a slice within P visits to its declaration. New arrivals can pass unfinished work; event arrival is not FIFO.
Disk transactions use WAL `synchronous=FULL`, so a published device watermark needs no later request to make its commit durable.
A crash resumes the committed cursor without duplicate copies. Transaction sequence
and write ordinals separate backfill from later delivery; delayed delivery cannot
enlarge history or revive an old follow. Reads check the current edge epoch and
removal tombstone per examined row. Removal purges copies before tombstone retirement.
`snapback4 doctor` lists pending and parked work.

A merge cursor from generation N survives compatible adoption; direct cursors bind it.

## Older spellings that still compile (do not use in new apps)

The older recipe measurement used 40 events with the newest 20 removed. Returning 20 took
82 examinations (41 tombstone probes); a 25-examination ceiling returned an
incomplete empty page without `next`. Older recipe only.

FEED_ORIGINAL_REQUIRED needs an original event; FEED_NOT_AUTHOR needs its author.
Current `remove(postId: posts)` uses E_RULE for non-owners and the `posts` type.

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
must follow the [adoption instructions](./FOLLOWING-ADOPTION.md) in the installed `snapback4` package,
including paused writes and dependency-ordered backfill. Recipe history is not imported by atomic launch; a new view starts now.

FEED_PULL_CAP means the caller uses all 32 shared-author slots. Unfollow a shared author and retry with a new write ID.
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
