# Maintains: filtered contributions, calendar groups, pages and rank

A maintain is an engine-owned table with rows { id, <group columns>, value }.
A full group-key lookup returns its scalar, zero when no group exists.
An explicit first/last page returns existing rows, with ordinary shapes and
cursors. A short key needs a page operator. byGroup orders the complete group
tuple. Source caps can prove a distinct-group bound; no new target cap is
enforced.

A predicate accepts scalar comparisons, and/or/not, boolean literals and bare
required boolean columns. Equality permits null; ordering requires compatible
non-optional scalars. It cannot read tables, viewer, now, helpers or arithmetic:
store that fact on the source, or use a bounded job. False rows contribute
nothing; updates subtract and add once, coalescing equal groups. Literal
defaults mean the same thing on writes, devices, expiry and adoption.

day(.at), hour(.at) and bucket(.at, 2m) take required time columns. Their int
outputs are floor ordinals from the Unix UTC epoch; day(-1 ms) is -1.
Computed fields are named day, hour and bucket, once each; id and value are
reserved. The same functions work in queries as day(now), hour(now) and
bucket(now, 2m).
An optional literal offset anchors the boundary: day(.at, 8h) or
bucket(.at, 1d, 8h) groups 08:00 UTC through just before the next 08:00.
The ordinal is floor((at - offset) / period); offsets are nonnegative whole
durations smaller than the period, including 0ms. hour(.at, 30m) works too.
The same offset belongs in scalar lookups: day(now, 8h). Days remain exactly
86,400,000 ms; no timezone or daylight-saving adjustment is applied.

The following Clique summaries are online-only. Add source sync when its
audience is invertible, and omit the maintain's online only to inherit it
when every audience column survives as a bare key.

```quarry
table posts:
  authorId: principal
  parentId: id ?
  at: time
  score: int
  by byAuthor: authorId, id
  public 'posts are public'
  online only

table likes:
  postId: posts
  authorId: principal
  principal: principal
  unique byPostPrincipal: postId, principal
  public 'likes are public'
  online only

table reactions:
  messageId: id
  emoji: text <=20
  principal: principal
  by byMessage: messageId, id
  cap 50 by messageId
  public 'reaction counts are public'
  online only

maintain originalPostCounts: count posts where .parentId = null by authorId
  read <- allow
  online only
maintain dailyPosts: count posts where .parentId = null by authorId, day(.at)
  read <- allow
  online only
maintain hourlyPosts: sum posts of score by authorId, hour(.at)
  read <- allow
  online only
maintain periodPosts: count posts by authorId, bucket(.at, 2m)
  read <- allow
  online only
maintain digestPosts: count posts by authorId, bucket(.at, 1d, 8h)
  read <- allow
  online only
maintain reactionCounts: count reactions by messageId, emoji
  read <- allow
  online only
maintain postLikes: count likes by postId
  read <- allow
  online only
  by byCount: value, id

query digestToday():
  return digestPosts[viewer, bucket(now, 1d, 8h)]
query today():
  return dailyPosts[viewer, day(now)]
query reactionChips(messageId: id):
  return reactionCounts[messageId] first 50 by byGroup { emoji, count: .value }
query mostLiked(c: cursor ?):
  return postLikes after c last 10 by byCount { postId, count: .value }
```

Value indexes have zero or more distinct group fields, then value, id.
Pin every scope field before value; use value, id alone for global ranking.
last N descends by value and then canonical group id on both stores; pass next
as the cursor. A direct page cursor binds its evaluated prefix and active
generation; reuse after adoption or under another prefix is refused. It stays
valid across ordinary writes in that generation; scores can move between pages. Only existing nonzero groups
appear: an unliked post does not acquire a zero-like candidate. Author
attribution remains a validated source field, with no automatic join.

A UTC day is not a rolling 24-hour window. Exact trailing-day Trending,
including zero-like posts, keeps the ranked/expiry recipe on guide feeds.
A value-order index over an expiring source is refused: use a live bounded
query or the scheduled ranked-table recipe. Unranked expiring aggregates
recompute live contributions before the sweep; every expiring maintain uses
an internal selected-group/source-id index. Zero-sum occupancy uses one entry. Large live groups can still be incomplete at the meter.

An inherited aggregate has no horizon and remains until-revoked even when its
source retains delivered-history. After leave, retained source rows are
history, not a complete aggregate. A public inherited maintain sends every
group to every device; reading only the top ten does not shrink acquisition.
An online-only side effect does not prevent source-write prediction; reading
that aggregate does. An unknown local aggregate base is never assumed zero.
When a zero sum needs an occupancy decision, a held source witness keeps the
candidate; local absence needs complete source coverage (held, no horizon).
Otherwise the write queues without a predicted row. Live scalar misses and
empty pages remain incomplete when source coverage is incomplete. An inherited
aggregate over a public source with subset delivery runs on the server;
its local scalar and page coverage is unknown, including for the viewer.

Filtered counts disclose predicate membership, calendar groups disclose bucket
membership, and rank discloses relative values to the aggregate's read audience.
The filter grants no source-row read. N_MAINTAIN_DELTA names dependencies;
restrict the aggregate read rule when the delta is private (guide rules).

Even a hidden aggregate can disclose a constraint outcome: near an integer
endpoint, a hidden selected contribution can make a write fail with
E_OVERFLOW while an excluded contribution commits. Work reservation does not
prevent this overflow bit; the refusal names only the maintain and column,
and the failed transaction rolls back.

Adding or changing a filter, key, duration, offset, dependent literal default or index
is a derived rebuild at its declaration. Today's atomic activation rebuilds
populated stores before publishing the new generation; it is not resumable.
