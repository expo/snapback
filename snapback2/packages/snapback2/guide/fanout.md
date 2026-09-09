# Fan-out

Fan-out is touching many rows because one row changed. The certifier refuses
any mutation `for` loop whose population is not provably complete and bounded
(`E_STRUCTURAL_FANOUT`). A number in that refusal is echoed from your own
loop bound, argument maximum, or schema cap — it is never a platform maximum.
There is no platform lane or fan-out constant: each shape below declares its
own envelope and certifies against the read and write budgets (`guide bounds`).

Pick the shape from the need:

| need | shape | bounded by | fresh |
| --- | --- | --- | --- |
| feed projection (rows from everyone the viewer follows) | `merge` lanes in a query | your declared lane bound | live |
| per-group counter over a population you can cap (a conversation's members) | `cap N by group` + the covering mutation loop | the schema cap; every write to the capped table is priced by N | per write |
| per-group counter over a population you must not cap (followers, likers) | `maintain` + a `chunk` job | the chunk size per step | at the period boundary |
| whole-table pass, backfill, erasure | `chunk` in a `job` | the chunk size per step | when the job completes |

A `cap` is a schema constraint: it refuses the next row past N in each group
and prices every write to that table by N. Cap a population only when the
product means it (a conversation's members); never cap followers to make a
loop certify.

**Synchronous per-write fan-out over an uncappable population has no shape
today.** A post cannot bump a counter on each of 900 followers inside the
posting mutation. That is the design, not a missing cap: compute at read
time (`merge`), or fold maintained counts in at digest time (`maintain` +
`chunk`), below.

## The feed: merge-on-read

The lane bound is yours. This certifies at 500 lanes; a heavier row shape
certifies at fewer, and `check` refuses with the real numbers when a budget
is exceeded — the budget, not a lane constant, is the binding surface.

```q
query followingFeed(c: cursor ?):
  page = merge posts after c last 20 by byAuthorTime:
    [viewer]
    [f.followed] for f in follows[viewer] first 500 by byFollower
  return page { body: .body }
```

## The digest counter: maintain + chunk job

`maintain periodPosts: count posts by author, period` keeps the per-author
count at insert. The job walks `follows` in resumable chunks and folds the
maintained count into each follower's digest row — nothing is written at
post time, so a 900-follower author costs nothing extra. Run it from a
`schedule` or on demand: `snapback2 run digestPass '{"period": 1}' --as system`.

```q
job digestPass(period: int):
  chunk f in follows first 50 by byId:
    n = periodPosts[f.followed, period]
    account = digests[f.follower, period] by byTargetPeriod
    if account != null:
      update digests[account] { newPostsInFollowing: account.newPostsInFollowing + n }
```

See `guide job` for chunk semantics, `guide maintain` for aggregates,
`guide merge` for lanes, and `guide bounds` for budgets and cap pricing.
