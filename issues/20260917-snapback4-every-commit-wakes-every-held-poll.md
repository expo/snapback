# Snapback 4: every commit wakes every held `/changes` poll — bystanders answer, re-poll, and learn which tables someone else wrote

Status: Open
Priority: P2 (a scale ceiling and an activity side channel; the owning design exists — LLP 3000.009 §7.1, increment E — and asks for exactly this measurement before it is built)
Date: 2026-09-17
Systems: `snapback4` `serve_changes.rs` (the held poll and its `check`), `serve.rs` (`Shared.seq`, `committed`), the client's `changes.ts`; LLP 3000.009 §7.1
Observed version: published `snapback4@0.2.27`
Evidence status: measured on the published binary while taking ruling 32's effect-row cost (LLP 3000.007 §21.3 P6)

## What happens

A held `GET /changes?since=…&wait=25` waits on the store's one commit counter
(`serve_changes.rs`: "the counter only wakes polls; the store decides whether its head
changed"). Any commit moves the head, so **every held poll of every principal answers**,
with `{ seq, tables, generation, store_id }`, where `tables` is the union of the tables
touched by every commit after `since` (`check`, `commits_after`) — not filtered by what
the polling principal may read. The client then re-polls (and a replica device syncs and
receives nothing).

## Measurement (`benchmarks/runs/2026-09-17-snapback4-derived-probes/presence-cost/`)

`wake.mjs` — principal p00 writes messages into a room only p00 belongs to; 49 other
personas, members of nothing, hold polls (`dev --memory`, 160 commits, host load 30+):

```
p00 writes its own room; nobody else connected       p50=2.07ms p95=2.55ms  poll answers=0    for 160 commits
p00 writes its own room; 49 UNRELATED polls held     p50=4.00ms p95=7.18ms  poll answers=6439 for 160 commits
```

About 40 of the 49 bystanders answer each commit (the rest are between an answer and their
re-poll), and the writer's p50 doubles. `wake-one.mjs` shows one bystander's answer, about
5 ms after the other principal's commit:

```
{"generation":1,"seq":2,"store_id":"…","tables":["messages"]}
```

In the 50-member room of `measure.mjs` (on-disk store) the same effect takes a send's p50
from 2.9 ms to 15–19 ms whether or not the send emits anything.

## Why it matters

- **Scale.** Work per commit is proportional to connected clients, not to the commit's
  audience: N answers, N re-polls, and for replica devices N empty syncs. At 1,000
  connected clients and 10 commits a second that is on the order of 10⁴ requests a second
  that carry nothing. It is the fan-out LLP 3000.009 §7.1 says to measure, and it applies
  to replica devices as well as to the online tier's table-granular re-runs.
- **Disclosure.** Every authenticated principal learns when *any* principal commits and the
  names of the tables written, including tables it can never read. LLP 3000.007 §4's
  principle 7 allows a write to disclose its outcome to its writer and a read to disclose
  rows its rule admits; this is a third channel — coarse (no keys, no rows), but it is
  activity timing per table for the whole store.

## Direction (not a design; §7.1 owns it)

- A commit already knows its partitions (`runner.events`) and its tables. Wake a held poll
  only when the commit touched a partition that principal holds (its own, `public`, its
  groups) or a table one of its server-run watches read; leave the rest asleep until their
  deadline. That is an in-memory filter on the broadcast, smaller than §7.1's key-range
  read sets and compatible with them.
- Answer `tables` from the commits that woke *this* poll, not from every commit after
  `since`.
- Keep the head-advance property the comment in `check` protects (a saturated page
  invalidates everything) and the restore detection of LLP 3000.007 §18.2.
- **An obligation from LLP 3000.007 ruling 32 (lane W15a).** A push guarded by absence is recorded
  and deferred a few seconds when its recipient holds a poll, and is cancelled only by a poll that
  *arrives after the commit*. Today that arrival is guaranteed by the accident this ticket removes:
  every commit wakes every poll, so a healthy recipient re-polls within milliseconds. A filtered wake
  must therefore also wake the held polls of every principal a commit names as an unconfirmed
  presence dependency (`_effect_presence`), whether or not the commit touched a partition that
  principal holds — otherwise a connected recipient of a row-less effect is pushed while connected.
  The failure is a duplicate notification, never a lost one, so it is safe to land the two in either
  order; it is still a regression this fix must test.
- Regression shape: the two probes above — a bystander's poll stays held across an
  unrelated commit and answers at its deadline with no table names it did not earn.
