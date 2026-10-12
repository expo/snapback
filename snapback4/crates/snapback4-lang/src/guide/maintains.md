# Views: plan, maintain or materialize

**Start here:** Use `view` for derived data: filters and unions plan reads, while counts update in the source transaction. For public post totals, use this excerpt from the complete example below; do not maintain counters in client writes.

```quarry
view postCount: count posts by .author
query total(author: principal):
  return postCount[author]
```

- `E_MAINTAIN_READ_RULE`: grouping lost an authorization field; retain it as a bare key or declare the aggregate's intended read rule.
- `E_QUARRY_SYNTAX`: a view cannot have its own sync line; keep inherited sync or choose `online only` and lose offline coverage.
- `N_MAINTAIN_SYNCED`: the aggregate does not inherit the source horizon; measure it, or choose `online only` only if offline reads and prediction by the named dependent mutations are unnecessary (`predicts` then fails with `E_NOT_PREDICTABLE`).

## Reference

```quarry
table posts:
  author: principal
  body: text <=500
  at: time
  removed: bool default false
  public 'public posts'
  online only
table reposts:
  actor: principal
  post: posts
  at: time
  public 'public reposts'
  online only
view activity:
  posts where not .removed { post: .id, actor: .author, at, repost: false }
  reposts { post, actor, at, repost: true }
query global(c: cursor ?):
  return activity last 20 by .at after c
view postCount: count posts by .author
query total(author: principal):
  return postCount[author]
```

A filter or projection is planned when read. Branches form a union without a copied application table. An aggregate is maintained in the source write's transaction. Public Following is materialized per reader when its source and edge rules admit that disclosure (`guide feeds`).

Each union branch runs under its own source's read rule before filtering or projection. Branches have compatible fields and types. Identity includes both branch and source id; equal ids in different tables remain distinct events. The exposed `id` is the source id. Include a branch discriminator, such as `repost`, when forming a client list key. A predicate on a projected column reaches each source; a constant predicate selects branches. Order fields must map to source columns in every branch.

A maintained view has rows `{ id, <group columns>, value }`. A full group key returns a scalar. An authorized miss is zero; a hidden hit and hidden miss are both null. Pages return existing groups, using `first`/`last`, `by .column`
and `after c`. A domain may use an inherited product cap or the runtime meter.
Source caps can bound distinct groups; no new target cap is enforced.

During adoption, query and sync snapshot reads keep reading the previous backend. A newly added query answers pending until the views are complete. Writes wait, then execute once.
`check` reports N_ADOPTION_PAUSE; dev and deploy print it before activating. Plan the write pause before adopting. Source counts estimate work at measured eb1000 rates; the subtotal is not a floor. The modeled “up to” time is not an SLO or hard bound. Removed or rebuilt rows/indexes add an explicitly unestimated retirement pause, including tables whose names survive. Tables affected by read-through or inherited-expiry changes warn about retirement/recapture: the deletion subset depends on activation time, so their stored populations are not exact deletion counts. On a schema change, an unaffected read-through table separately rewrites every stored row to recompute deadlines; this rewrite count is exact, not a deletion subset. Both pauses remain unestimated. Maintained-column mirrors, cap resets and asset-home retirement also warn when unpriced. Payload width, fanout, cache and WAL/storage affect time.
Activation defaults to a 64 MiB combined main/temp cache target (half each). Set SNAPBACK4_ADOPTION_CACHE_MIB to 0–512; 0 keeps caller settings and larger caller caches are retained. Linux reduces the target for address-space headroom. Workspace is not an RSS cap: the prior 64 MiB main-cache run used about 147 MiB process RSS; sorter RAM follows the cache. SQLite NOMEM after enlargement rolls back and retries once at caller settings; choose 0 for constrained hosts.
The adoption line reports phases, capture fills and rebuilt views with source visits and milliseconds; nested details are included in their parent phase. A failed or interrupted attempt keeps the previous backend; restart retries the complete build.
Signed-in `GET /changes` waits for the whole adoption because reconnecting
requires a durable presence write. That wait grows with the store; it is not
bounded by a rebuild chunk. Query and sync reads have reserved admission capacity
so queued mutations cannot occupy all their request slots.

Omit `read` to derive readability: a public/allow source gives `read <- allow`;
otherwise every field in its read rule must survive as a bare group key, and
that same rule protects the aggregate. Calendar keys and reference paths do
not preserve rule fields. E_MAINTAIN_READ_RULE names missing fields; state an
explicit `read <-` when the aggregate needs its own audience. An explicit
rule always wins. Residency is unchanged: sync is inherited only when all
source audience columns survive as bare keys, without the source horizon;
otherwise the aggregate stays server-only. `online only` opts out.

E_SYNC on a public inherited view names the source, the missing horizon and
the conflicting explicit read. An owner-only read does not make public sync
private. E_QUARRY_SYNTAX refuses a separate sync line on any view. On this public inherited view, remove that
line, then keep the public read (or omit it) for the public offline summary,
or use `online only` and lose offline aggregate/absence coverage. Never narrow
the public source to make the view private. `guide offline-interactions` is
the example and replica census; N_MAINTAIN_SYNCED links it too. For viewer-owned
existence on an eligible public window, that card shows source owner-key
coverage with ordinary `exists` instead of a summary; it does not supply totals.

E_MAINTAIN_READ_EXPIRE means an aggregate over an expiring source has a read
rule that uses fields its group keys do not determine. This includes a source
with an effective deadline inherited through `read through`. Use `read <- deny`
and replace deny with a rule over the group keys, omit `read` to inherit the
source rule, or use `online only` with an explicit key rule. Neither a source
cap nor `online only` permits a value-dependent rule. Non-expiring sources
may authorize their stored value because it is already the live value.

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
rebuilds the view without adding a source column.

The following Clique summaries are online-only. Add source sync when its
audience is invertible, and omit the view's online only to inherit it
when every audience column survives as a bare key.

```quarry
table posts:
  authorId: principal
  parentId: posts ?
  at: time
  score: int
  immutable authorId, parentId, at
  public 'posts are public'
  online only

table likes:
  postId: posts
  at: time
  immutable postId
  principal: principal
  unique postId, principal
  public 'likes are public'
  online only

table reactions:
  messageId: id
  emoji: text <=20
  principal: principal
  cap 50 by messageId
  public 'reaction counts are public'
  online only

view originalPostCounts: count posts where .parentId = null by .authorId
  online only
view dailyPosts: count posts where .parentId = null by .authorId, day(.at)
  online only
view hourlyPosts: sum posts of .score by .authorId, hour(.at)
  online only
view periodPosts: count posts by .authorId, bucket(.at, 2m)
  online only
view digestPosts: count posts by .authorId, bucket(.at, 1d, 8h)
  online only
view reactionCounts: count reactions by .messageId, .emoji
  online only
view receivedLikes: count likes by .postId.authorId
  online only
view dailyLikes: count likes by .postId.authorId, day(.at)
  online only
view trend: count likes where postId.parentId = null by hour(postId.at), .postId.at, .postId
  online only
view receivedReplies: count posts where .parentId != null by .parentId.authorId
  online only
view postLikes: count likes by .postId
  online only

query today():
  return dailyPosts[viewer, day(now)]
query reactionChips(messageId: id):
  return reactionCounts where .messageId = messageId by .emoji { emoji, count: .value }
query mostLiked(c: cursor ?):
  return postLikes after c last 10 by .value { postId, count: .value }

query digestToday():
  return digestPosts[viewer, bucket(now, 1d, 8h)]
```

Order aggregate rows with `last 10 by .value after c`. For post-time ties
and zero-like posts, put `likeCount: count likes` on posts and read them
`last 10 by .likeCount, .at after c`. The planner supplies the index.
A direct page cursor binds its evaluated prefix and active
generation; reuse after adoption or under another prefix is refused. It stays
valid across ordinary writes in that generation; scores can move between pages. Only existing nonzero groups
appear: an unliked post does not acquire a zero-like candidate.

An aggregate group key or equality predicate may name ref.col, exactly one hop. The
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
Removing every aggregate view that uses a path drops it; re-adding it captures anew.
Capturing or dropping paths emits no row events for those sources and their
aggregate rebuilds: a new generation discards old device images and reacquires
snapshots. Later unrelated rebuilds still record their commits and events.
doctor reports null captures per source path and
live selected contributions with null attribution per aggregate view. A null capture
on an optional, unselected branch is normal; inspect the selected-contribution
count before treating it as missing credit. `sql` can inspect the recorded
fields on the affected source rows. Creating a missing target later does not
repair a recorded null.

Recorded fields belong to the engine. Any payload naming one refuses with
E_RECORDED_FIELD, including no-op updates, jobs, native jobs, seeds and fixture
imports. Trusted persistence restores keep them. Omit recorded fields from
application payloads; write the ordinary source columns instead. They travel on the sync wire
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
put `likeCount: count likes` on posts and read the predicate `.at > now - 1d
and .at <= now last 10 by .likeCount, .at`. `guide feeds` has the complete
query. Zero-like posts participate. A value-order index over an expiring
source remains refused: live values change before physical sweeping, so
stored top-N can miss a winner. Use live counts within the runtime meter or
an explicitly delayed job-written ranking for that different product.
Unranked expiring aggregates keep a physical total. A server read subtracts
only the group's unswept expired contributions, using an internal index ordered
by selected group, expiry (null last), and source id. Work is constant plus
that backlog, never the live group size. The backlog is what the server expiry
sweep has not reached: one tick per second, at most 2,000 rows per pass, with
short cooperative time slices. This is no maximum lag guarantee.
Zero-sum occupancy uses one entry. If the meter interrupts a backlog scan or a
maintained point lookup, the Quarry query returns `data: null, complete: false`
without a continuation; an unfinished count is neither zero nor a partial total.
A missing group still reads as zero when its lookup completes. An existence-only
rule probe seeks the first live contribution past `now`, skipping the expired
backlog; it keeps the one-probe cost. Rules still cannot compare the live value
of an expiring aggregate.

A keyed read or rule probe of an expiring aggregate always includes its source
in `tables`, even for an empty group or a denied read, so source writes invalidate
the result consistently. Authorization, rule probes and recounts collect provisional
deadlines. Only an emitted row or answer adds them to `next_expiry`; denial,
interruption or an unavailable answer discards them, keeping charges and cuts.
A partial page keeps deadlines from rows it already emitted. An empty page
does not publish a private deadline learned by its prefix authorization.
An authorized reader can observe the metered cost of the group's unswept expired
contributions, including an `unavailable` cut when the backlog exceeds the
examined ceiling. These contributions belonged to that reader's count; sweeping
bounds the backlog. Expired rows still cost examined work and steps.
Unauthorized denials remain identical across empty, expired-only and live groups.

An inherited aggregate has no horizon and remains until-revoked even when its
source retains delivered-history. After leave, retained source rows are
history, not a complete aggregate. A public inherited aggregate view sends every
group to every device; reading only the top ten does not shrink acquisition.
An online-only side effect does not prevent source-write prediction; reading
that aggregate does. An unknown local aggregate base is never assumed zero.
When a zero sum needs an occupancy decision, a held source witness keeps the
candidate; local absence needs complete source coverage (held, no horizon).
Otherwise the write queues without a predicted row. Devices still recompute
live contributions under the read meter; a large group can be unavailable.
The client then asks the server, which uses the backlog-bounded read. Physical
totals and private next-expiry metadata are not delivered to bypass that limit.
Live scalar misses and empty pages remain incomplete when source coverage is
incomplete. An inherited
aggregate over a public source with subset delivery runs on the server;
its local scalar and page coverage is unknown, including for the viewer.

Filtered counts disclose predicate membership, calendar groups disclose bucket
membership, and rank discloses relative values to the aggregate's read audience.
The filter grants no source-row read. N_MAINTAIN_DELTA names dependencies;
restrict the aggregate read rule when the delta is private (guide rules).

Even a hidden aggregate can disclose a constraint outcome: near an integer
endpoint, a hidden selected contribution can make a write fail with
E_OVERFLOW while an excluded contribution commits. Work reservation does not
prevent this overflow bit; the refusal names only the view and column,
and the failed transaction rolls back.

Adding or changing a filter, key, duration, offset, dependent literal default or index
is a derived rebuild at its declaration. Today's atomic activation rebuilds
populated stores before publishing the new generation; it is not resumable.
Attribution capture runs inside the same atomic activation, before that rebuild, preserving existing paths.

## Originals, replies and engagement credit

This example credits the author of the immediate target. A direct reply credits
the original author; a reply to a reply credits that reply's author. `postId`
always names the root original for thread membership. `replyTarget` names only
the immediate reply, never an id stored as the wrong table's reference.
The two like tables make target identity explicit. Their maintained totals
add at read time; no sum-type reference or recursive attribution is needed.

```quarry
table posts:
  authorId: principal
  body: text <=500
  immutable authorId
  public 'original posts'
  insert <- .authorId = viewer
  delete <- .authorId = viewer
table replies:
  postId: posts on delete keep
  replyTarget: replies ? on delete keep
  authorId: principal
  body: text <=500
  immutable postId, replyTarget, authorId
  public 'thread replies'
  insert <- .authorId = viewer
  delete <- .authorId = viewer
table postLikes:
  postId: posts on delete keep
  principal: principal
  unique postId, principal
  immutable postId, principal
  public 'likes of originals'
  insert <- .principal = viewer
  delete <- .principal = viewer
table replyLikes:
  replyId: replies on delete keep
  principal: principal
  unique replyId, principal
  immutable replyId, principal
  public 'likes of replies'
  insert <- .principal = viewer
  delete <- .principal = viewer

view originalLikesReceived: count postLikes by .postId.authorId
view replyLikesReceived: count replyLikes by .replyId.authorId
view directRepliesReceived: count replies where .replyTarget = null by .postId.authorId
view nestedRepliesReceived: count replies where .replyTarget != null by .replyTarget.authorId

mutation original(body: text <=500):
  return insert posts { authorId: viewer, body }
mutation reply(postId: posts, replyTarget: replies ?, body: text <=500):
  require exists posts[id = postId] else POST_NOT_FOUND
  if replyTarget != null:
    target = replies[id = replyTarget] ! else REPLY_NOT_FOUND
    require target.postId = postId else WRONG_THREAD
  return insert replies { postId, replyTarget, authorId: viewer, body }
mutation likePost(postId: posts):
  require exists posts[id = postId] else POST_NOT_FOUND
  return insert postLikes { postId, principal: viewer } if absent
mutation likeReply(replyId: replies):
  require exists replies[id = replyId] else REPLY_NOT_FOUND
  return insert replyLikes { replyId, principal: viewer } if absent
mutation unlikePost(postId: posts):
  if exists postLikes[postId, viewer]:
    delete postLikes[postId, viewer]
mutation unlikeReply(replyId: replies):
  if exists replyLikes[replyId, viewer]:
    delete replyLikes[replyId, viewer]
mutation deleteReply(replyId: replies):
  delete replies[id = replyId]
mutation deletePost(postId: posts):
  delete posts[id = postId]
query received(authorId: principal):
  return { likes: originalLikesReceived[authorId] + replyLikesReceived[authorId], replies: directRepliesReceived[authorId] + nestedRepliesReceived[authorId] }
```

Suppose Alice writes an original, Bob replies, Carol replies to Bob, and Dana
replies to Carol. The reply totals are Alice 1, Bob 1, Carol 1, Dana 0.
A like of each of those four rows credits its own author once. These are
counts of still-present contributions with recorded target authors, not counts
of all events ever created and not live joins against current targets.

Deleting Bob's reply removes its contribution to Alice. Carol's reply and a
like of Bob's deleted reply still credit Bob (`on delete keep`). Deleting either contributing row
removes that credit. Deleting and recreating the target with the same id never
reattributes old contributions; fresh contributions capture the new author.
The mutations above require live targets, while imported or pre-existing rows
may have absent targets and record null. Such a contribution belongs to the
null group and gives no named author credit. A live-target-only total would
require a different authored policy; these recorded totals do not promise it.

For existing data, first inspect `doctor` and `sql`, identify each intended
target from application evidence, and backfill the reference itself. When
adding `replyTarget`, keep the new column mutable during that explicit repair;
then make it immutable and add the maintained path. Activation captures all
existing sources against the targets live at that moment. Existing recorded
paths, including nulls, stay unchanged. Do not backfill recorded engine fields
or drop/re-add paths as an accidental history repair. An immutable incorrect
reference needs an explicit data migration with an author-chosen identity policy.

## Refusals

E_QUARRY_MAINTAIN means a predicate, grouping expression or read is outside
the aggregate view forms. For example, `view recent: count posts where .at > now by .authorId`
cannot maintain a moving time predicate without a write. Store a row-local
fact, group a required time column with `day(.at)`, or read the time predicate at query time (`guide feeds`). Predicates compare
source scalars, admitted recorded paths and literals; never viewer, now or helpers. Read a scalar
with every group key, such as `dailyPosts[viewer, day(now)]`; a partial key
reads a prefix page under the ordinary bounds rules (`guide bounds`).
The diagnostic names the expression to repair.

A generated aggregate target exposes its full path-named group columns. In a
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
view receivedLikes: count votes by .postId.authorId
view trend: count votes by hour(postId.createdAt), .postId.createdAt, .postId
query ranking(c: cursor ?):
  return receivedLikes after c last 10 by .value { authorId: .postId.authorId, count: .value }
query attributed(c: cursor ?):
  return trend first 20 by .hour, .postId after c { post: .postId, at: .postId.createdAt, count: .value }
```

Insert capture resolves each path inside the write transaction before row
validation, indexes and aggregate deltas. An untrusted import uses its batch's
winning target images and the import clock; an earlier committed null stays
null when a target arrives in a later batch. Imports reject supplied recorded
fields. Trusted restoration preserves stored captures without resolving them.
Expired targets are absent at capture time, including before physical sweeping.

## Maintained columns

When the group is a row, put its aggregate on that row:

```quarry
table posts:
  at: time
  likeCount: count likes
  public
  insert <- allow
  online only
table likes:
  postId: posts
  principal: principal
  unique postId, principal
  public
  insert <- .principal = viewer
  delete <- .principal = viewer
  online only
mutation like(postId: posts):
  post = posts[postId] ! else NOT_FOUND
  insert likes { postId: post.id, principal: viewer } if absent
query trending(c: cursor ?):
  return posts after c last 20 by .likeCount, .at { * }
```

Omit `by` when exactly one source column references the parent, as above.
This also works for `total: sum likes of .weight`. With no reference or several,
E_MAINTAINED_COLUMN_REFERENCE lists the candidates: declare a reference if
needed, then select it with `likeCount: count likes by .postId`.

The other form is `total: sum source of .amount where .selected by .parentId`.
The predicate has the aggregate grammar above. The one grouping column must
reference this parent table; optional null references contribute nothing.
The source is ordinary and cannot expire. Tables a timeline maps are
ordinary here: `likeCount` on the posts a Following timeline maps is the
Trending form beside it. Tables the timeline owns refuse E_MAINTAINED_COLUMN.
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
Restrict the parent audience or use a separate aggregate view when that
disclosure is unwanted.

A contributing commit streams the whole parent image to each parent
partition, coalesced once per row. N_MAINTAINED_COLUMN_STREAM names that cost
on the parent's sync line. Use a column for a count readers want with the
row; use `view …` with `online only` when the counter changes far more often
than the row is read. Include the parent's size in that choice: a 4,000-byte
parent costs every holder about 4 KB per contributing commit.

An insert, if-absent insert, upsert or update result has the ordinary fields and id, without maintained fields. It remains a write key. Read the row under
its read rule to see the aggregate; selecting the field from a write result
refuses with E_MAINTAINED_COLUMN_RESULT. Native results follow the same rule;
the generated `PostsWrite` type contains the ordinary fields and id.

Every source write pays the server's fixed private-maintenance reservation on the device, including schemas without receipts. The compiler exports complete per-source prices, not private formulas or totals. Receipt-derived sums require server settlement because provisional contributions can overflow. A device skipping online-only public aggregates pays their shared worst-case reservation; an ordinary server insert may charge less actual delta work. Writers still predict when the reservation fits.

The device receives server values and preserves them through page application and cold restoration. It never predicts the aggregate or accepts assignments
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
Only the mirror re-runs when the parent's `expire at` changes, or the type,
optionality or default of the column it names.
Expired unswept parents stay untouched. Removal drops the private totals;
re-adding recounts from source rows.

Activation emits no row events and always commits a parent-table invalidation,
even for all-zero totals. Devices discard old images and reacquire snapshots;
server-run watches re-run. Unchanged declarations preserve totals.
`check --cost` reports composed source/mirror work and derived byte bounds;
`why` and `test --residency` attribute values and acquisition to the parent.

The Postgres evaluation backend refuses maintained columns and their private
maintains with E_POSTGRES_MAINTAINED_COLUMN. Use the SQLite engine for this form.

## N_PUBLIC_AGGREGATE_COPY: a public derived column keeps ordinary write authority

N_PUBLIC_AGGREGATE_COPY is a note, not an error. Every write to a public or
uniformly readable column is computed from table or aggregate reads, but
`insert <- allow` or `update <- allow` (or a provably unrestricted equivalent)
lets any principal run any mutation that writes it. The note names the column
and a written expression, such as `p.score + 1` in `like`. Declare
`likeCount: count likes` on the parent row, as Trending does above.
For a derivation a column cannot express, pin a copied score to the engine's
count in both insert and update rules:

```quarry
table posts:
  author: principal
  public 'posts'
  insert <- .author = viewer

table likes:
  postId: posts
  principal: principal
  unique postId, principal
  immutable postId, principal
  public 'likes'
  insert <- .principal = viewer
  delete <- .principal = viewer

view likeCounts: count likes by .postId
  online only
table ranked:
  postId: posts
  score: int
  unique postId
  immutable postId
  public 'ranking'
  insert <- exists likeCounts[postId = .postId, value = .score] or (.score = 0 and not exists likeCounts[postId = .postId])
  update (old, next) <- exists likeCounts[postId = next.postId, value = next.score] or (next.score = 0 and not exists likeCounts[postId = next.postId])
mutation refresh(postId: posts):
  post = posts[postId] ! else NOT_FOUND
  upsert ranked[postId = post.id] { postId: post.id, score: likeCounts[post.id] }
```

The zero case matters: a count group has no row without contributions. These
rules reject a forged score; keeping a copy fresh is still the application's
responsibility. For another derived fact, pin the copied value to its source
row with an `exists` rule. Maintains produce numeric counts and sums; the note
leads with the pinning rule for a non-numeric copy, such as a nullable author.

The client calls declared operations, not arbitrary table writes. This note
identifies latent table permission, not proof that a current mutation accepts
an arbitrary score. It follows values through bindings, helper calls, objects,
shapes, arithmetic and loops across all Quarry programs and helpers, including
jobs, once per column. The written value must be computed from reads (possibly
with ambient values); an argument may choose which derived value is written
but may not supply the value itself or how many values contribute to it.
A purely ambient write (`viewer`, `now`,
a minted id or a literal) disqualifies the column, except a literal insert or
omitted literal default may initialize a
column that has another read-derived write. A literal update or upsert is not
that exception. Presence (`connected`) is ambient, not a table aggregate.
An upsert's returned id keeps the supplied id key's data provenance: an
argument supplies it, a read derives it, and an id minted without an id key
is ambient.

A collection carries cardinality separately from its items: a read page's is
read-derived, an argument list's or argument-bounded range's is supplied, and a
literal list's is ambient. Shapes, slices and sorts preserve that cardinality;
a filter may add its predicate's dependence. `count` consumes cardinality,
while sums, element picks and loop accumulations consume it with their data.
Branches, loop exits, sort/group keys and slice/element positions
carry control provenance through helper writes and nested fields; that control
does not enter the verdict. The note names a caller-dependent choice, such as
`p.score + 1` or `p.score - 1`, chosen by `liked` in `setLike`. An unknown
dependence or an exhausted analysis budget stays silent; it never becomes read
evidence. Literal insert initialization keeps the exception above, including
inside a branch.

Restricted rules, private targets, immutable columns, append-only tables and
aggregate targets do not receive it. Job-only writers under `deny` stay silent.
Actions have no Quarry write body; their external steps call declared mutations,
whose arguments are included. A native job can write tables outside this syntax
census, so its presence makes the all-writers proof unknown and silent. The note does not infer meaning from column names,
and its absence is not proof that a ranking cannot be forged. Sync and
`online only` do not change write authority.

## A value per member: Clique unread

N_SHAPE_METER warns about raw counts per inbox row, including inside `unreadIn`. Use `unreadCounts[.id]` instead.

The receipts-compatible count uses ordinals, join floors and seen watermarks. Sends still predict; counts wait for settlement.

A row-keyed view inherits its member's read rule and sync audience. Its key is one
reference equality; other conjuncts compare source/member fields or source-only values.
Cap members by that parent; `check --verbose` prints the key, fanout and recount bound.

```quarry
table conversations:
  title: text <=100
  timer: int ?
  lastOrdinal: int default 0
  read <- allow
  sync public last 500 by .id
table members:
  conversationId: conversations
  principal: principal
  joinedOrdinal: int
  immutable conversationId, principal, joinedOrdinal
  unique conversationId, principal
  cap 50 by conversationId
  read <- exists members[.conversationId, viewer]
  insert <- exists members[.conversationId, viewer]
  sync to members[.conversationId]
table messages:
  receipts chat by .conversationId, .ordinal from .senderId to members:
    counter .lastOrdinal
    floor .joinedOrdinal
    count .recipients
    watermarks .deliveredOrdinal, .seenOrdinal
  conversationId: conversations
  ordinal: int
  recipients: int
  senderId: principal
  tombstone: bool default false
  expiresAt: time ?
  unique byConversationOrdinal: conversationId, ordinal
  immutable conversationId, ordinal, senderId, recipients
  expire at .expiresAt
  read <- exists members[.conversationId, viewer]
  insert <- .senderId = viewer and exists members[.conversationId, viewer]
  sync to members[.conversationId] last 500 by byConversationOrdinal
view unreadCounts: count messages by members m
  where .conversationId = m.conversationId and .ordinal > m.seenOrdinal
    and .ordinal > m.joinedOrdinal and .senderId != m.principal and not .tombstone
mutation send(conversationId: conversations):
  conversation = conversations[conversationId] ! else NOT_FOUND
  m = insert messages { conversationId, senderId: viewer,
    expiresAt: now + conversation.timer if conversation.timer != null else null }
  return m.id
query myUnread(member: members):
  return unreadCounts[member] ! else NOT_ALLOWED
query unreadBadges(conversationId: conversations, c: cursor ?):
  return unreadCounts where .conversationId = conversationId first 50 after c { member, value, recountPending }
```

Predicted writes freeze only affected parent groups: source/member base and current images name
both groups of a move; deletes durably save keys even for canceled inserts. Other groups stay live. Dirty counts
return the settled snapshot with `recountPending: true` and `complete: false`; a new member has no
count yet. O(pending) point reads are cached per target/query; unknown or computed group keys fall
back to the whole target. These flags also describe incomplete live counts, so for receipt-derived
badges always show a stable number with a quiet refreshing indication, never `L+`. Settlement or
refusal clears the overlay; expiry/range coverage resumes. Mutations reading the count still cannot
predict. Sends retain maintenance reservations; see `guide receipts` for the refusal boundaries.

The view carries only the member's read-rule columns, `id`, `member` (the same member id), `value` and
`recountPending`. It never copies unrelated member columns or engine-recorded attribution keys. Delivery
keeps the member horizon: snapshots select members within that horizon before fetching their view values,
and catch-up emits no view put for a member outside it. The horizon order columns remain on the member
table. For a view without receipt dependencies, a device predicts source deltas for every held, current
member even outside other members' horizons; retained members are not updated.

The receipts clause allocates positions per conversation; the view excludes pre-join history.
Own sends and tombstones are excluded explicitly. A source expired at commit is retired in that transaction before adding a contribution; it will not be subtracted later. Server certification
may first probe a necessary predicate index: at most 65 stored keys decide whether at most 64 candidates
can certify the count. These candidates include unswept expired inputs; expiry and the full predicate
exclude them from the count. Larger ranges and background recounts use the null and future ranges of the
parent/expiry index, seeking past expired inputs. An abandoned probe stays charged against the writer's
recount allowance; a count that cannot finish leaves a pending recount and commits the mark. Server reads
certify live counts above the writer allowance whenever the source **or member** can expire, including
inherited expiry over non-expiring sources. Expiring members always use authorized input: maintenance may
have skipped them while absent. Restoring their lifetime recounts or leaves pending work. For non-
expiring members, a settled server basis can reuse its count while its version matches, its basis is not
in the future, and its deadline has not arrived. A recount restarts its prefix on clock rollback. Source
writes maintain that proof with the count. Every read still checks current member and source-group
authority. Pending, due or unsupported row-dependent disclosure cases use the full authorized live
recount. Identity and copied read-rule fields follow the member transactionally; private work never flips
them; bounded durable chunks reconcile them without publishing redundant recount commits or changing
watermarks. Each private chunk counts against the maintenance allowance and releases the engine lock
before the next chunk. Both paths keep the fixed public reservation; probes and walks use the internal
ledger for queries and count-dependent writers. Schema adoption atomically rebuilds a count when its
member table, predicate inputs or expiry interpretation changes, including a default on a legacy absent
expiry field. Stored counts carry an internal basis timestamp. Physical sweeps subtract only
contributions present in that basis, so a sweep after a mark cannot subtract an expired input twice.

With whole-group coverage the device keeps its live-basis scan, seeking past expired backlog. Otherwise
it scans `.ordinal > m.seenOrdinal`, still testing sender, tombstone and expiry; unswept expired
candidates cost device work. Its `last 500` window certifies the badge exactly when the encoded lower
bound lies at or above this conversation's acquired floor key, and the scan finishes within the read
allowance. This works offline and after a cold reload; expiry removes contributions at their deadline
without a sync. Deleting or expiring the floor row never moves that saved floor. With two lower bounds on
ordinal it uses the greatest; null is the weakest bound. Only when every range operand is null does it
require the whole group.

For views without receipt dependencies, if the unread range extends below the floor, `value` counts current,
authorized, live matching rows examined locally, with `recountPending: true`
and `complete: false`. Only this live lower bound can be shown as `L+`; online, the client asks the server for
its exact count when permitted: an unobserved predicted write or a `held` query
still blocks replacement. The pending bound is not speculative. Retained history never contributes. This bound describes the
evaluated replica, including its usual optimistic writes, not settled server
truth. A covered scan cut by the meter also returns its pending partial, but
asks nothing. Without a range the device still requires the whole group.
Non-expiring pending views retain their last settled value, not a lower bound.

Every member-row reader must be able to read the whole counted parent group. Admission proves this for a
public source, the same parent-only `exists` grant on source and member, or a non-expiring member whose
owner read rule itself witnesses the source's unique `exists members[parent, viewer]` membership probe.
Other combinations refuse with E_VIEW_KEY, including an independently owned member with source `read <-
.senderId = viewer`, `deny`, or an unrelated `exists access` grant. The limit also applies to raw server
schemas and device open/adoption. Recount work is selected only from an image the writer can read. Every
member insert/update, including over public sources, needs a readable new member image and destination
source group. Otherwise E_VIEW_KEY refuses before selecting recount work: make the member row readable to
its writers before marking. An ordinary server mutation retains its caller and adds no authority. A blind
non-reader cannot use an unchanged private parent to select a public group's recount. Deletion needs no
source recount. Recount commits use global watermarks and `/changes`; filtering the view image alone
would still expose hidden cardinality through that traffic. A defensive unreadable-group image remains
zero/pending, not a certified count. Private-view scans must pin their audience or use a member key.

On the server, for an admitted member reader, an equal current live basis produces the same
certified count, completeness, count-dependent writer result, reserved meter,
snapshots and recount traffic. This includes an expired prefix inserted before
the member and a large live suffix inserted afterward, read before any mark.
Pending state, expired rows, tombstones and own sends never change that meaning. Global activity by other
principals remains observable through the shared sequence/log protocol.

A pure view-existence witness reads only the member's indexed existence and
expiry metadata under a fixed reservation. It never loads unrelated member
payloads. Its lifetime reaches `nextExpiry` only through the complete rule's
verdict: a timeless successful alternative removes the deadline, and a later
surviving witness extends it. A count read reserves declared decoder scratch, authorizes the member,
then charges its materialized result; the member's heap is transient and its peak
and any meter cut remain charged. Large declarations can exceed the reservation
even when a stored value is empty; see the shared caller accounting law in `guide rules`.

A small mark change scans the changed interval in the generated parent/ordinal
index and updates the count in that transaction. On the server, expiring sources
seek the live expiry ranges and establish a fresh count basis. A newly readable member whose
old image was unreadable uses a recount from the readable new image, so the old
private mark cannot select its background work.
View refreshes do not depend on whether the hidden delta is zero.
A larger change commits the
mark and leaves a non-expiring last settled count **pending** within the same parent:
reads report `complete: false`. A parent change discards that fallback and
publishes zero/pending until the new parent settles.
The server settles a durable recount in chunks of at most 256 source rows;
source edits and deletes during the recount adjust its already-counted prefix.
Expiry-index cursors resume only in live ranges; an expiry of a counted
contributor restarts the recount from the current live basis.
The writer examines at most 1,024 source rows, further limited by its remaining
meter. Recounts restart for a changed member predicate and resume after a server
restart. A single source row too large for a chunk parks that member's recount
so other members can settle. Changing a member field used by the predicate to a
different value retries its recount. Any source edit in that member's parent
group, including shrinking the oversized row, allows one retry chunk even when
the recount has not yet acquired a cursor.
A covered device predicts within its certification allowance. Without source
coverage, a non-expiring count keeps its settled value and queues the mark
without prediction. An acquired horizon suffix can
cover the changed interval; a device recount that exceeds its allowance also
queues without prediction. Expiring sources or members need covered live input to certify
a count: an uncovered device reports a pending count until it can
certify that live input. A device mutation that cannot certify the count,
including an already settled count above its local allowance, enters the
outbox without a predicted result; the server decides and settles it.
Rules and writers on `value` require certification; composed rule deadlines follow count-predicate truth transitions, within the shared physical allowance. Incomplete values cannot decide a rule. `recountPending` and device `pending` may be selected only directly into query result data; returning the row also preserves them. For a non-receipt live lower bound, use `recountPending` with `complete` to display `L+`; incomplete receipt-derived badges use a quiet refreshing indication. Every other selection refuses with E_VIEW_KEY: bindings (even unused ones), helpers, conditions, comparisons, arithmetic, sort/group keys, aggregates, `exists`, all rules, sync, indexes and constraints. Compute with `value`, identity or copied member fields. Objects, lists, helpers and projections preserve the row's static type. Any assignment of a maintained row, even in a skipped branch or loop, makes that local maintenance-carrying at every use in its scope; a later reset cannot clear it. Helper parameters and results join all call sites and return paths. If you reuse a local for other data, use a separate variable for the row. Any nested maintenance-bearing value is refused by inspecting builtins, including min/max, share, sort/group, aggregates and hashing: project the field you need first, for example `min(row.value, row.value)` or `share(1, [row.id], row.id)`. Only explicitly non-inspecting selectors/cardinality (`first`, `last`, `at`, `slice`, `count`) and list concatenation may forward these values; text conversion/JSON encoding during evaluation refuses. Future builtins default to inspecting. Private `$basis`/`$recount` rows and their `id`, `cursor`, `total`, `parked`, `at`, `deadline` and `version` are never application data. On a public view these names refuse unless declared copied member columns; a copied `total` is ordinary data. Other undeclared names, including `$private`, refuse too. Dynamic/heterogeneous receivers and recursively widened raw types cannot prove a receiver type; their field access refuses conservatively. Helper-block, intermediate and ordered-view maintenance projections also refuse: select status in the final query shape, or return the row and display its status in the UI. Indexes/ranking by `value` or `recountPending` refuse
with E_VIEW_KEY. Pure view existence follows the member's lifetime, including
when its count is zero. `online only` on the view opts
out of member-audience delivery. E_VIEW_KEY includes the admitted rewrite.

The Postgres evaluation adapter has no background recount runner and refuses
this form with E_VIEW_KEY; use the SQLite server and either device store.
Member rows reserve `member`, `value` and `recountPending` for the generated
view. The count form is admitted; row-keyed sums are not yet admitted.

A private `written by` member field may parameterize a row-keyed count only
when the member's read rule requires that field's owner. Otherwise declare
`readable by audience` before deriving the count. Row-read authority alone
does not disclose another owner's private predicate input.
Read-through limits and repair steps: `why E_READ_THROUGH`,
`why E_READ_THROUGH_ADOPT`, `why E_PARENT_HAS_CHILDREN` and
`why E_READ_THROUGH_SCAN`.

Aggregate views also accept `public` (optionally followed by a reason), with
the same read authority as `read <- allow`. This never changes inherited sync
or bypasses aggregate disclosure checks. Use it only for intentionally public totals.

## A page of messages with each message's reaction totals

Pin the parent inside the message page. Each nested read authorizes that
message before enumerating its emoji groups. A complete group-key lookup,
`reactionTotals[message, emoji]`, returns one scalar; a parent prefix returns
aggregate rows whose count is `.value` or `.count`; `{ emoji, count }` is shorthand.
`where .count = 2 first 10 by .count` filters and orders totals. A real group
column named `count` keeps precedence in predicates, keys, projections and ordering. The source's cap of 50 bounds its
number of emoji groups. Without such a cap, use a bounded page and cursor.

```quarry
table messages:
  owner: principal
  at: time
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner last 500 by .at
table reactions:
  message: messages
  principal: principal
  emoji: text 1..32
  unique message, principal
  cap 50 by message
  immutable message, principal
  read through .message
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync last 500 by .id
view reactionTotals: count reactions by .message, .emoji
fn reactionSummary(message: messages):
  own = reactions[message.id, viewer].emoji
  return reactionTotals where .message = message.id { emoji, count, mine: own = .emoji }
query messagesWithTotals(c: cursor ?):
  return messages[owner = viewer] last 20 by .at after c { *, reactions: reactionSummary(.) }
```

Keep the original parent page's audience key, predicates, order and cursor.
The nested aggregate inherits the parent's read rule; do not add a separate
read rule. Writing `exists members[.message.conversation, viewer]` repeats a parent traversal, not a local field: when it exactly repeats the parent rule, `check --fix` replaces that whole read line with an inheritance comment. Dropping `.message` would change its meaning. An unpinned aggregate scan still refuses `E_READ_THROUGH_SCAN`.
The aggregate group-key index lives on the server: this nested page uses server
fallback on devices, even if they hold all child rows. Complete-key scalar totals
can still recount held children locally. The builder's separate raw-reaction
query remains suitable for offline reaction UI. Missing parent/source coverage
is unknown; expired or retained history does not contribute to current totals. All pages and recounts share
the operation's ordinary meter.
