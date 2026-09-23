# Maintains: filtered contributions, calendar groups, pages and rank

A maintain is an engine-owned table with rows { id, <group columns>, value }.
A full group-key lookup returns its scalar, zero when no group exists.
An explicit first/last page returns existing rows, with ordinary shapes and
cursors. A short key reads a prefix: a proven source cap supplies its bound,
or a uniform query loop/lane may use the meter; otherwise write first/last N.
byGroup orders the complete group
tuple. Source caps can prove a distinct-group bound; no new target cap is
enforced.

A predicate accepts scalar comparisons, and/or/not, boolean literals and bare
required boolean columns. Equality permits null; ordering requires compatible
non-optional scalars. It cannot read arbitrary tables, viewer, now, helpers or arithmetic:
store that fact on the source, or use a bounded job. False rows contribute
nothing; updates subtract and add once, coalescing equal groups. Literal
defaults mean the same thing on writes, devices, expiry and adoption.

day(.at), hour(.at) and bucket(.at, 2m) take required time columns.
They also accept an admitted reference path, such as hour(postId.at); a null
recorded time produces the null group. Their int
outputs are floor ordinals from the Unix UTC epoch; day(-1 ms) is -1.
Computed fields are named day, hour and bucket, once each; id and value are
reserved. The same functions work in queries as day(now), hour(now) and
bucket(now, 2m).
The same three functions are table index components over required time columns
at any key position; see `guide indexes` for listings and daily uniqueness.
An optional literal offset anchors the boundary: day(.at, 8h) or
bucket(.at, 1d, 8h) groups 08:00 UTC through just before the next 08:00.
The ordinal is floor((at - offset) / period); offsets are nonnegative whole
durations smaller than the period, including 0ms. hour(.at, 30m) works too.
The same offset belongs in scalar lookups: day(now, 8h). Days remain exactly
86,400,000 ms; no timezone or daylight-saving adjustment is applied. Changing the offset
rebuilds the maintain without adding a source column.

The following Clique summaries are online-only. Add source sync when its
audience is invertible, and omit the maintain's online only to inherit it
when every audience column survives as a bare key.

```quarry
table posts:
  authorId: principal
  parentId: posts ?
  at: time
  score: int
  immutable authorId, parentId, at
  by byAuthor: authorId, id
  public 'posts are public'
  online only

table likes:
  postId: posts
  at: time
  immutable postId
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
maintain receivedLikes: count likes by postId.authorId
  read <- allow
  online only
maintain dailyLikes: count likes by postId.authorId, day(.at)
  read <- allow
  online only
maintain trend: count likes where postId.parentId = null by hour(postId.at), postId.at, postId
  read <- allow
  online only
maintain receivedReplies: count posts where .parentId != null by parentId.authorId
  read <- allow
  online only
maintain postLikes: count likes by postId
  read <- allow
  online only
  by byCount: value, id

query today():
  return dailyPosts[viewer, day(now)]
query reactionChips(messageId: id):
  return reactionCounts[messageId] by byGroup { emoji, count: .value }
query mostLiked(c: cursor ?):
  return postLikes after c last 10 by byCount { postId, count: .value }

query digestToday():
  return digestPosts[viewer, bucket(now, 1d, 8h)]
```

Value indexes have a prefix of group fields, then value, then any remaining
group fields, then id (implicit when every group field is present), until
maintained columns ship; each field appears once.
Pin every scope field before value; use value, id alone for global ranking.
last N descends by value, trailing group fields and id on both stores; pass next
as the cursor. A direct page cursor binds its evaluated prefix and active
generation; reuse after adoption or under another prefix is refused. It stays
valid across ordinary writes in that generation; scores can move between pages. Only existing nonzero groups
appear: an unliked post does not acquire a zero-like candidate.

A maintain key or equality predicate may name ref.col, exactly one hop. The
source ref must have a table reference type and be immutable; the target's read
rule must be public or allow; col must be immutable on that target, or its id.
Private targets, mutable references/columns, unknown columns and further hops
refuse with E_QUARRY_MAINTAIN and a rewrite. Ordered comparisons on a path
refuse because recorded fields are optional.
Calendar functions also accept recorded time paths: a null capture belongs
to the null group, never the epoch-zero bucket. Equality uses ordinary null
semantics, so two nulls compare equal.

The engine records each distinct path once on source insertion, inside the
writing transaction, at one extra point read per path. A null reference or an
absent/expired target records null without refusing. Deleting a target or
reusing its id never changes an existing contribution. Incremental writes,
unswept expiry reads and aggregate rebuilds all read these stored facts.
The source still needs its independent insert rule, such as .principal = viewer.

Adding a path captures existing rows once against live targets at activation;
an id reused before capture supplies its new value. Rebuilding or changing a
predicate over an existing path preserves all captures, including nulls.
Removing every maintain that uses a path drops it; re-adding it captures anew.
Activation emits no row events: a new generation discards old device images
and reacquires snapshots. doctor reports null captures per source path and
live selected contributions with null attribution per maintain.

Recorded fields belong to the engine. Any payload naming one refuses with
E_RECORDED_FIELD, including no-op updates, jobs, native jobs, seeds and fixture
imports. Trusted persistence restores keep them. They travel on the sync wire
with the source's retention policy, but are absent from query rows, * shapes
and generated row types; sql and why expose them for inspection.
A predicted insert needs a live target covered by the device's current
partition. Unheld, retained-only and expired targets queue without a predicted
row. After rejoining a retained group, only targets delivered again count as
covered until its replacement snapshot arrives. The server's capture is authoritative. check --residency lists that
implicit target dependency; check --cost lists the extra point reads.

A UTC day is not a rolling 24-hour window. For posts younger than a day,
group non-expiring likes by hour(.postAt), postAt, postId, index hour, value,
postAt, postId, and merge the last 25 hours with `where .postAt > now - 86400000`:
guide feeds gives the validated source rule, full query and zero-like fill.
Equal scores put the newest post first; groups persist as long as any like remains.
Whole old buckets are never visited; rejected rows in the oldest included
hour still cost examinations. For contributions arriving in the last day on
posts of any age, its `rollingLikes()` sorts live counts at read time;
a meter cut makes that bounded ranking incomplete. The optional scheduled
ranked-table recipe buys a job-computed score or stored device page, with
delayed scores. A value-order index over an expiring source remains refused:
the sweep updates physical aggregates and indexes transactionally, but live
values change before the sweep, so stored top-N can miss a winner.
Unranked expiring aggregates recompute live contributions before the sweep;
every expiring maintain uses an internal selected-group/source-id index.
Zero-sum occupancy uses one entry. If the meter interrupts a live group or a
maintained point lookup, the Quarry query returns `data: null, complete: false`
without a continuation; an unfinished count is neither zero nor a partial total.
A missing group still reads as zero when its lookup completes.

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
Attribution capture runs separately before that rebuild, preserving existing paths.


## Refused maintain expressions

E_QUARRY_MAINTAIN means a predicate, grouping expression or read is outside
the maintain forms. For example, `count posts where .at > now by authorId`
cannot maintain a moving time predicate without a write. Store a row-local
fact, group a required time column with `day(.at)`, or use the bounded live
query or scheduled Trending recipe on `guide feeds`. Predicates compare
source scalars, admitted recorded paths and literals; never viewer, now or helpers. Read a scalar
with every group key, such as `dailyPosts[viewer, day(now)]`; a partial key
reads a prefix page under the ordinary bounds rules (`guide bounds`).
The diagnostic names the expression to repair.
