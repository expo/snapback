# Derived-data probes on published Snapback 4 0.2.27

**Status: complete; a probe record, not a calibration.** Fourteen small projects, and two blind runs of shipped recipes on 0.2.28, run against
the **published `snapback4-darwin-arm64@0.2.27` binary** (`npm pack`, `snapback4 --version`
→ `snapback4 0.2.27`) on 2026-09-17, to test whether three shapes the 0.2.27 Clique record
called expressiveness holes — a rolling-window ranking, a derived table any principal can
write, a digest over expiring rows — are missing mechanisms or missing surface. They are
the evidence for [LLP 3000.007 §21](../../../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#21-derived-data-six-properties-and-three-holes-that-were-not-holes-2026-09-17).
Nothing here changes the product.

| | |
| --- | --- |
| Binary | published `snapback4-darwin-arm64@0.2.27`; no repository build |
| Method | `dev --memory` (or an on-disk dev store for jobs), `POST /seed`, `POST /q/<op>` with `meter: true`, `POST /m/<op>`, `snapback4 run <job>`, `snapback4 doctor`, `check`, `check --cost`, `check --residency` |
| Host | the shared development Mac, load average 12–37 during the runs; Node 24.18.0 |
| Evidence level | counters are the engine's deterministic meter; the few latencies are loopback HTTP p50s on a loaded host and are not magnitude claims |
| Run | `cd <probe> && SB=/path/to/snapback4 node measure.mjs` (`POSTS=40000` for the larger ranking run; `READ=<n>` sets the hub's read ordinal) |

One trap met on the way: the first launch of the freshly unpacked binary stalled more
than 120 s at `_dyld_start` on this host; every later launch took 19 ms.

## `trending/` — a rolling-24h ranking as 25 hour lanes over a value-indexed maintain

Likes carry the post's hour and time (derived from the authoritative post inside
`setLike`); `maintain trend: count likes by postHour, postAt, postId` with `by byScore:
postHour, value, id`; the query is `merge trend after c last 10 by byScore where .postAt >
now - 86400000:` over the 25 literal lanes `[hour(now) - 0]` … `[hour(now) - 24]`. Posts
are spread over 30 hours; about 1% are hot (50–199 likes), the rest have 0–11.

| Posts in the trailing day | Likes seeded | examined | complete / `next` | p50 / p95 | top ten vs. a JavaScript oracle | out-of-window rows |
| ---: | ---: | ---: | --- | --- | --- | ---: |
| 3,963 | 32,892 | 265 | true / yes | 2.92 / 4.32 ms | equal (197 … 166) | 0 |
| 31,937 | 264,722 | 276 | true / yes | 2.24 / 2.89 ms | equal (199 … 197) | 0 |

Page two continues on the one cursor (first score 161 and 195). `check`: no problems;
`N_NO_CURSOR` before the cursor was declared, no note after. A lane source written as
`[h] for h in range(hour(now) - 24, hour(now) + 1)` is refused: `E_QUARRY_SYNTAX: a merge
for lane requires a bounded range read`.

## `trending-validated/` — the same ranking with one copied fact, and a rule that checks it

The scale runs above store `postHour` and `postAt` on each like. This variant stores only
`postAt`, groups by the computed key (`maintain trend: count likes by hour(.postAt),
postAt, postId`, `by byScore: hour, value, id`), and makes the copy an invariant:
`insert <- .principal = viewer and exists posts[id = .postId, at = .postAt]`. `check`: no
problems, no notes. Likes are written through `setLike`, not seeded.

```
trending → mid:3  fresh:2  edge:1 | complete=true examined=3        (a 25-hour-old post with 3 likes is absent)
forge false postAt → failed E_RULE
forge true postAt  → sent
after unlike+like  → fresh:2  mid:2  edge:2                          (ties break by maintained id, not post time)
```

## `trending-tailfill/` — zero-like posts without a second table

The liked page is the same merge; the fill is `posts[at > since] last 10 by byTime where
trend[hour(.at), .at, .id] = 0` (a full group-key lookup answers 0 when no group exists).

```
liked-b:9  liked-a:5  liked-c:2  quiet-00:0  quiet-01:0  quiet-02:0  quiet-03:0  quiet-04:0  quiet-05:0  quiet-06:0
rows=10 complete=true cut=null examined=25 probes=11 steps=515
```

A 25-hour-old post with 50 likes and an old unliked post are both absent. Spellings met
on the way: there is no `in` for list membership; `+` does not concatenate two pages
(accumulate in a loop); a shape written straight after `where … - 86400000` binds to the
int (bind the page, then shape it).

## `trending-synced/` — the same query on a device

With `sync public last 2000 by byTime` on `posts` and `sync public` on `likes`,
`check --residency` reports `trend: sync public (inherited from likes)`, `trending: runs:
device` with all 25 lane scans `held, no horizon`, `create: predicts: eligible` and
`setLike: predicts: eligible except past the horizon at posts[postId]`. One note,
`N_MAINTAIN_SYNCED`: "one value row per postHour, postAt, postId reaches every device".
Without the two sync lines the query is server-run and both mutations never predict.

## `digest/` — a digest job that reads the expiring table directly

`messages` has `expire at .expiresAt`. The helper seeks the period and filters the ordinal:
`count(messages[conversationId, at >= periodStart, at < periodEnd] first 100 by
byConversationTime where not .tombstone and .senderId != reader and .ordinal >
readOrdinal)`. The job is `chunk p in profiles first 1 by byId:` over
`members[p.principal] first 1000`, emitting once when the total is positive; the UI's
`inbox()` query calls the same helper as the viewer. `check: ok … no problems`, no notes.

```
alice inbox: [{"conversationId":"c1","unread":1},{"conversationId":"c2","unread":2}] complete=true examined=11
bob inbox: [{"conversationId":"c1","unread":0},{"conversationId":"c2","unread":4},{"conversationId":"c3","unread":3}] complete=true examined=15
carol inbox: [{"conversationId":"c2","unread":0},{"conversationId":"c3","unread":0}] complete=true examined=9
run: { "chunks": 3, "error": null, "job": "digest", "rowsWritten": 0, "state": "done" }
doctor: effects   2 queued, 0 deferred
```

Fixture: c1 holds five messages from bob and alice has read two; of the other three one is
tombstoned and one is expired but unswept, so alice has 1. c2 holds two of alice's own and
two of carol's, so alice has 2 and carol (read through 5) has 0. c3 is bob and carol only,
and one message predates the period. Two effects are alice and bob; carol is silent. The
range-seek sweep `chunk msg in messages[at >= periodStart, at < periodEnd] first 100 by
byTime:` also compiles (`job activity` in the same schema).

## `digest-hub/` — work proportional to unread history parks; work proportional to the period runs

One profile in 1,000 chats of 99 messages, the newest 5 inside the period, nothing read
(`READ=0`); 102,001 rows seeded in 4.4 s; one profile per chunk; the job chunk ceiling is
16,384 examined.

```
digestByOrdinal: 125 ms → { "chunks": 0, "error": "E_BOUND: examined rows reached the ceiling 16384", "state": "parked" }
digestByTime:     57 ms → { "chunks": 1, "error": null, "rowsWritten": 0, "state": "done" }      effects 1 queued
```

`digestByOrdinal` seeks `ordinal > readOrdinal` and filters by time, so its work is the
principal's unread history. `digestByTime` seeks the period and filters by ordinal, so its
work is memberships plus the period's messages in those chats (about 1,000 + 5,000 here).
The envelope of the second form is memberships + period messages ≤ 16,384 per profile
chunk.

`parked.mjs` (1,000 chats × 20 messages; a small profile sorts before the hub) shows what a
parked run does when it is queued again: run 1 commits the small profile's chunk (one
effect) and parks on the hub; run 2 is a **new run** that starts from the first profile,
emits for the small profile a second time (effects 1 → 2) and parks again. A digest that
can park needs an idempotency key at the worker — `(targetUserId, periodEnd)` — or a
marker row.

## `invariant/` — a rule pins a hand-kept score to the maintained count

```quarry
  insert <- exists likeCounts[postId = .postId, value = .score] or (.score = 0 and not exists likeCounts[.postId])
  update (old, next) <- exists likeCounts[postId = next.postId, value = next.score] or (next.score = 0 and not exists likeCounts[next.postId])
```

```
bob likes      → result.score 1, state sent
alice likes    → result.score 2, state sent
bob forges 999 → state failed, why.code E_RULE
bob forges 2   → result.score 2, state sent      (the true value; harmless)
bob unlikes    → result.score 1, state sent
```

## `computed-key/` — a table index refuses a computed time key

```
schema.q:5:23 — E_QUARRY_SYNTAX: expected the end of the line, got "("      -- by byHourScore: hour(at), score, at, id
```

Only maintain groups take `day`, `hour` and `bucket` today.

## `presence-cost/` — ruling 32's required measurement: an effect row per connected recipient

On-disk dev store, `--hold-effects`; one room of 50 members; N = 150 sends a line after 10
warm-ups; "connected" = 49 Node fetch loops holding `GET
/changes?since=…&wait=25&heartbeat=1` and re-polling on every answer. Host load average
30+: read the latencies as shape.

```
sendQuiet   (no effects; nobody connected)          p50=2.88ms  p95=8.05ms
send        (49 offline -> 49 effects/msg)          p50=3.77ms  p95=7.26ms
sendQuiet   (49 connected; polls wake+re-poll)      p50=17.67ms p95=112.59ms
send        (49 connected -> 0 effects/msg)         p50=18.80ms p95=98.32ms
sendAlways  (49 connected -> 49 effects/msg)        p50=14.88ms p95=67.91ms
doctor: effects 22244 queued, 6724 deferred         storage: rows 143.6 KB · log 180.3 KB · ops 140.4 KB · file 9.7 MB
```

49 durable effect rows cost about 0.9 ms a send (about 18 µs a row). With 49 held polls a
send's p50 rises 2.9 → 15–19 ms whether or not it emits: every commit wakes every held
poll. 6,724 of the guarded `send`'s roughly 7,800 connected-recipient decisions were
recorded as *deferred* effects — under rapid sends most recipients are between a poll's
answer and its re-poll, in grace, so today's path already writes a durable row for most
connected recipients in a busy room.

`wake.mjs` and `wake-one.mjs` isolate the wake: p00 writes a room only p00 belongs to while
49 personas who belong to nothing hold polls. 160 commits produce **6,439 bystander poll
answers** and the writer's p50 goes 2.07 → 4.00 ms (`dev --memory`); one bystander's
answer, about 5 ms after the other principal's commit, is
`{"generation":1,"seq":2,"store_id":"…","tables":["messages"]}`. Filed as
`issues/20260917-snapback4-every-commit-wakes-every-held-poll.md`.

## `lane-list/` — a bounded list argument is refused as a merge lane source

`[a] for a in authors` with `authors: [principal] <=50` →
`E_QUARRY_SYNTAX: a merge for lane requires a bounded range read` — the same message
`range(..)` gets (ruling 28 admits both).

## `dangling-reference/` — a reference does not enforce that its target exists

`insert likes { postId, principal: viewer }` with `postId = 'no-such-post'` → `state: sent`.
LLP 3000.007.001 §3.3 (a maintained column counts pre-existing contributions at its
parent's birth) rests on this.

## `stream-image-ahead/` — a stream page carries an image newer than its own watermark

Found by the GPT-family blind review of LLP 3000.007.001 and reproduced here. A public
synced `counters` row; bob bumps it (sequence 2), alice bumps it (sequence 3); alice's
device asks for one event from watermark 1:

```
alice acquires      → watermark 1 image n = 0
bob bump seq 2 → n 1 | alice bump seq 3 → n 2
page(limit 1) from 1 → watermark 2, more=true, acks={}, events: seq 2 put n=2
```

The page ends before alice's commit and does not acknowledge it, yet its image already
includes it, so her device replays the pending `bump` over it and shows 3 until the next
page. Filed as `issues/20260917-snapback4-stream-page-serves-images-newer-than-its-watermark.md`.

## `column-gates/` — LLP 3000.007.001 §7's gates 1 and 2, measured by proxy

Maintained columns are not built, so the gates were measured on the published binary with
the form the column replaces: a hand-kept count column whose `update` puts the parent row
on every like. That is byte-for-byte what the design's mirror would put (LLP 3000.007.001
§3.5), so the hand-kept form **is** the column's stream and log cost; the two alternatives
beside it are a declared maintain that inherits public sync, and the same maintain `online
only`.

**Gate 1 — what one like costs** (`gate1.mjs`; 2,000 posts, `sync public last 2000 by
byTime`, likes public and synced; 100,000 likes by one principal round-robin over the
posts; a bystander device acquires first and follows the log afterwards; on-disk dev store,
checkpointed, against a zero-like baseline of the same store):

| Form | Parent body | Wire bytes per like (bystander) | Stream events per like | Log rows per like | Log bytes per like | Database growth per like |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| hand-kept column (the mirror's proxy) | 500 B | 823 | 2 | 2 | 851 | 1,794 |
| synced maintain | 500 B | 329 | 2 | 2 | 334 | 1,170 |
| `online only` maintain | 500 B | 182 | 1 | 1 | 190 | 997 |
| hand-kept column | 4,000 B | 4,323 | 2 | 2 | 4,351 | 5,667 |
| synced maintain | 4,000 B | 329 | 2 | 2 | 334 | 1,152 |
| `online only` maintain | 4,000 B | 182 | 1 | 1 | 190 | 979 |

The like row itself is 182 bytes on the wire in every form. The **count's own cost** is the
rest: 641 B a like as a column on a 500-byte parent against 147 B as a synced maintain row
(4.4×), and 4,141 B against 147 B on a 4,000-byte parent (28×); over 100,000 likes the
store grows 567 MB, 115 MB and 98 MB for the three forms at 4,000 bytes. The partition log
stores the whole image of every `put`. Throughput on this loaded host was 700–2,300 likes a
second and is not a claim. Raw rows: `gate1.result.txt`.

**Gate 2 — rows a device gains beyond its horizon** (`gate2.mjs` on the engine,
`gate2-analysis.mjs` on the fixture alone; the workload LLP 3000.007.001 §7 pinned before
measuring: the Clique scale fixture's recorded like stream, unmodified; posts and replies as
one table; a bystander acquires at the `# checkpoint 50%` marker):

```
seeded 25100 rows at or before the checkpoint; the device acquired 2000; horizon 2026-01-01T11:54:17.000Z
likes replayed after the checkpoint: 2500 (failed 0); stream: 17 pages, 5045105 bytes
distinct posts rows sent to the device: 26321 = created after acquisition 25100 + already held 56 + BEYOND ITS HORIZON 1165 (of which not older than the horizon: 0)
rows gained beyond the horizon: 1165 = 58.3% of the 2000 held at acquisition — gate: 10% a day; this replay's remaining span is 7.67 h
```

The engine and the fixture analysis agree to the row (1,165; 1,125 for top-level posts
alone, 56.3%). **The gate fails by a factor of six in a third of a day.** The recorded
stream is block-structured (all of a half's likes follow all of its posts, one a second,
half of them on posts older than 7.5 hours), so it is a harsh workload, and it is the one
that was pinned. The growth is not introduced by a maintained column: the hand-kept score
it replaces does exactly this today, and so does an edit to an old post.

## `horizon-gap/` — the same growth is a wrong answer: a device pages past its horizon from scattered rows

Measuring gate 2 raised the question of what a device *does* with rows beyond its horizon.
`posts` with `sync public last 5 by byTime`, twelve posts, `timeline(c)` = `posts after c
last 3 by byTime`; the **published client** (`snapback4@0.2.27`, wasm device, in Node)
against the published binary:

```
control page 1 (before any like)   p12 p11 p10   {"complete":true,"cut":null,"fresh":true}
control page 2 (before any like)   p09 p08 p07   {"complete":true,"cut":null,"fresh":true}
control page 3 (before any like)   p06 p05 p04   {"complete":true,"cut":null,"fresh":true}
  — alice likes p02 and p04 (a hand-kept score: the parent row is put) —
device page 1 (after likes)        p12 p11 p10   {"complete":true,"cut":null,"fresh":true}
device page 2                      p09 p08 p04   {"complete":true,"cut":null,"fresh":true}
device page 3                      p03 p02 p01   {"complete":true,"cut":null,"fresh":true}
server page 2                      p09 p08 p07
server page 3                      p06 p05 p04
```

Before the likes the page that crosses the device's horizon is handed to the server. After
them the device answers it from `p04` — a row it holds only because it was liked — and
**`p07`, `p06` and `p05` never appear, on pages marked complete and fresh**. The device's
coverage rule (`engine/read.rs`: same index, descending, more rows held below) assumes its
rows are a contiguous newest suffix; the stream applies no horizon and `Device::apply`
stores every `put`, so any update to an old row breaks the assumption. Filed as
`issues/20260917-snapback4-device-page-past-horizon-answers-from-scattered-rows.md` (P1).
Run: `SB=<binary> PKG=<unpacked snapback4 npm package> node measure.mjs`. Re-run the same day against the
just-published `0.2.28` binary and client: identical (`RESULT-0.2.28.txt`).

**`horizon-gap-group/` — the same in a chat thread.** `messages` synced to a conversation's
members with `sync last 5 by byConversationOrdinal`, twelve messages, `thread(c)` three at
a time; alice **edits** `m02` and `m04` (an ordinary `update`), published 0.2.28:

```
control page 2 (before any edit)   m09 m08 m07    {"complete":true,"cut":null,"fresh":true}
device page 2 (after the edits)    m09 m08 m04*   {"complete":true,"cut":null,"fresh":true}
device page 3                      m03 m02* m01   {"complete":true,"cut":null,"fresh":true}
```

`m07`, `m06` and `m05` are skipped. So the exposure is not only a hand-kept score on a
public feed: any chat longer than its horizon in which an old message is edited,
tombstoned or otherwise updated shows a gapped thread on every device that was connected
at the time.

## `published-0.2.28/` — the two recipes this program shipped, pasted blind from the published binary

0.2.28 carries the hour-lanes Trending (wave 12's lane W12R1c, from §21.1 item 1) and the
period-seeking digest (lane W14b, item 2). Each block was extracted from the **published
0.2.28 binary's own card** (`snapback4 guide feeds`, the block containing
`trendingWithZeros`; `snapback4 guide jobs`, the block containing `job digest(`), written
to `snapback/schema.q` unedited, and run.

- **Digest:** `check: ok — 4 tables (3 synced), 2 operations, no problems`. `inbox(period)`
  as each viewer: alice `{c1: 1, c2: 2}`, bob `{c1: 0, c2: 4, c3: 2}` (the message older
  than the period is out), carol zeros. `snapback4 run digest` → done, 3 chunks, 0 rows
  written; `doctor`: `effects 2 queued` — alice and bob; carol, with nothing unread, is
  silent. The shipped card carries both review corrections (missed schedule boundaries
  coalesce; what the example's `members` insert rule admits).
- **Trending:** 3,000 posts over 30 hours, 20,393 likes. Page 1's scores equal an
  independent oracle's (`196,186,182,181,174,159,144,143,141,140`), `complete: true`,
  `next`, **286 examined** for 2,207 liked posts in the window; pages 1 and 2 together: no
  duplicate post and twenty scores equal to the oracle's, across a tie at 140;
  `trendingWithZeros` returns ten rows, complete. A like through `setLike` as another
  principal is `sent`.

Run: `SB=<published binary> node measure.mjs` in a project holding the extracted block.

## What this record does not show

A device store was run only in `horizon-gap/` (elsewhere the residency facts are the compiler's); no wall-clock claim is
made; the ranking probe's likes are seeded rows, not mutations (`invariant/` exercises the
maintain under `setLike`); presence (grader
finding d-05 of the 0.2.27 record) was reasoned from the effects card and LLP 3000.007
§19.1, not executed.
