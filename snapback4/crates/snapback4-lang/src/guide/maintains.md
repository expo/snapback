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
non-optional scalars. It cannot read tables, viewer, now, helpers or arithmetic:
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

Value indexes have a prefix of group fields, then value, id; each field
appears once. For post-time ties, declare `likeCount: count likes by postId`
on posts and `by byLikes: likeCount, at, id` on that parent.
Pin every scope field before value; use value, id alone for global ranking.
last N descends by value and id on both stores; pass next
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
Capturing or dropping paths emits no row events for those sources and their
aggregate rebuilds: a new generation discards old device images and reacquires
snapshots. Later unrelated rebuilds still record their commits and events.
doctor reports null captures per source path and
live selected contributions with null attribution per maintain.

Recorded fields belong to the engine. Any payload naming one refuses with
E_RECORDED_FIELD, including no-op updates, jobs, native jobs, seeds and fixture
imports. Trusted persistence restores keep them. They travel on the sync wire
with the source's retention policy, but are absent from query rows, * shapes
and generated row types; sql and why expose them for inspection.
A predicted insert needs a live target covered by the device's current
partition. Unheld, retained-only and expired targets queue without a predicted
row. A continuous membership renewal preserves coverage. After a membership gap,
only targets delivered again count as covered until a replacement snapshot.
An unswept expired membership never hides a live replacement for the same key.
The server's capture is authoritative. check --residency lists that implicit
target dependency; check --cost lists the extra point reads.

A UTC day is not a rolling 24-hour window. For posts younger than a day,
put `likeCount: count likes by postId` on posts and index
`hour(at), likeCount, at, id`. Merge 25 hour lanes with the exact time filter;
`guide feeds` gives the full query. Zero-like posts are included and equal
scores put the newest post first. For contributions arriving in the last day on
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
Attribution capture runs inside the same atomic activation, before that rebuild, preserving existing paths.


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

A generated maintain target exposes its full path-named group columns. In a
shape or predicate, `.postId.authorId` selects that literal column on
`receivedLikes`; it does not traverse a reference. Named index keys use
`receivedLikes[postId.authorId = author]`, and sort uses
`sort(rows, 'postId.authorId')`. Source rows keep recorded fields internal;
ordinary source projections cannot select them.

```quarry
table writers:
  principal: principal
  immutable principal
  read <- allow
table articles:
  authorId: writers
  createdAt: time
  immutable authorId, createdAt
  read <- allow
table votes:
  postId: articles
  immutable postId
  read <- allow
maintain receivedLikes: count votes by postId.authorId
  read <- allow
  by ranking: value, id
maintain trend: count votes by hour(postId.createdAt), postId.createdAt, postId
  read <- allow
query ranking(c: cursor ?):
  return receivedLikes after c last 10 by ranking { authorId: .postId.authorId, count: .value }
query trending():
  rows = trend first 100 by byGroup { post: .postId, at: .postId.createdAt, count: .value }
  return sort(rows, '-at')
```

Insert capture resolves each path inside the write transaction before row
validation, indexes and maintain deltas. An untrusted import uses its batch's
winning target images and the import clock; an earlier committed null stays
null when a target arrives in a later batch. Imports reject supplied recorded
fields. Trusted restoration preserves stored captures without resolving them.
Expired targets are absent at capture time, including before physical sweeping.

## Maintained columns

When the group is a row, put its aggregate on that row:

```quarry
table posts:
  at: time
  likeCount: count likes by postId
  by byLikes: likeCount, at, id
  public
  insert <- allow
  online only
table likes:
  postId: posts
  principal: principal
  unique byPostPrincipal: postId, principal
  public
  insert <- .principal = viewer
  delete <- .principal = viewer
  online only
mutation like(postId: posts):
  insert likes { postId, principal: viewer } if absent
query trending(c: cursor ?):
  return posts after c last 20 by byLikes { * }
```

The other form is `total: sum source of amount where .selected by parentId`.
The predicate has the maintain grammar above. The one grouping column must
reference this parent table; optional null references contribute nothing.
The source is ordinary and cannot expire. Neither parent nor source may be
timeline-owned or mapped into a timeline: E_MAINTAINED_COLUMN refuses that
combination. Use ordinary tables outside the timeline, or a separate maintain.
The parent may expire; the mirror
leaves expired rows and their stored values untouched. Zero-like parents are
included in its indexes, and ties can use the parent's time.
A deleted parent can be recreated with the current total. A missing field
reads as 0. E_MAINTAINED_COLUMN refuses an application assignment, including
an explicitly submitted 0, because the engine owns the field. Write the source
rows instead.
Rules, constraints, defaults, expiry, sync audiences and horizons, word
tokenization and other aggregates cannot depend on it. Ordinary reads and ordered
pages can. A cursor remains in the same generation across ordinary writes;
counts can move a row across the cursor, so paging a moving ranking is not a
snapshot and can repeat or miss rows.

E_MAINTAINED_COLUMN_PRIVATE refuses addressing the column's private storage.
No program, native call, rule, constraint, seed, fixture, import, or raw IR or
schema can name it, not even as the system. Read the parent row or write the
source rows instead.

Parent readers learn the count or sum of contributing rows, even when those
rows are private; a predicate discloses selection and an index discloses
relative order. N_MAINTAINED_COLUMN_DISCLOSURE prints when source readability
is not proven for those readers. Source writers can observe aggregate
overflow. The meter reserves the same schema-bounded ceiling for private
aggregation and both mirror attempts whether the parent is present, absent,
expired or differently valued. These are equal charged ceilings, not equal
physical storage work.

A contributing commit streams the whole parent image to each parent
partition, coalesced once per row. N_MAINTAINED_COLUMN_STREAM names that cost
on the parent's sync line. Use a column for a count readers want with the
row; use `maintain … online only` when the counter changes far more often
than the row is read. Include the parent's size in that choice: a 4,000-byte
parent costs every holder about 4 KB per contributing commit.

An insert, if-absent insert, upsert or update result has the ordinary fields
and id, without maintained fields. It remains a write key. Read the row under
its read rule to see the aggregate; selecting the field from a write result
refuses with E_MAINTAINED_COLUMN_RESULT. Native results follow the same rule;
the generated `PostsWrite` type contains the ordinary fields and id.

The device receives server values and preserves them through page application
and cold restoration. It never predicts the aggregate or accepts assignments
to it. A predicted source write changes its own rows; the parent's aggregate
changes when the server image arrives. Provisional parent rows are authorized
at read time; an unreadable provisional parent stays hidden. Implicit 0 applies
only after the row passes read authorization. A readable predicted parent insert reads 0 on a pending row
until a server row image supplies its authoritative value.
A write acknowledgement carries no maintained fields; synchronization or an
ordinary read supplies the row image. An acknowledgement does not replace a
previously synchronized maintained value with a missing field.

Adding or redefining a column atomically rebuilds its private total and
mirrors each live parent whose value differs, including nonzero to zero.
An initial zero stays absent in storage and reads 0; it is not an authored
literal default. Ordinary fields and other maintained columns are preserved.
Every rebuild re-runs the mirror: addition, kind, source, predicate or `by`
changes, and changes to a depended-on source column's type, optionality or default.
Only the mirror re-runs for changes to the parent's `expire at` or the named
column's type, optionality or default.
Expired unswept parents stay untouched. Removal drops the private totals;
re-adding recounts from source rows.

Activation emits no row events and always commits a parent-table invalidation,
even for all-zero totals. Devices discard old images and reacquire snapshots;
server-run watches re-run. Unchanged declarations preserve totals.
`check --cost` reports composed source/mirror work and derived byte bounds;
`why` and `test --residency` attribute values and acquisition to the parent.

The Postgres evaluation backend refuses maintained columns and their private
maintains with E_POSTGRES_MAINTAINED_COLUMN. Use the SQLite engine for this form.
