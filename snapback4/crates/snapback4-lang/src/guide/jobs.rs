//! The jobs card. Quarry examples are compiled by tests/guide.rs.
// @ref LLP 3000.007#21.1 — digest work seeks the period through each recipient's memberships.
pub(super) const CARD: &str = r##"# Jobs and schedules: the server's own work, on its own clock

For a replay mode that must not emit notifications, run `snapback4 dev --replay`.
New emits are counted as `suppressed` by `doctor`, with no queued payload:
they are never delivered, including after restarting with or without `--replay`.
Mutations and explicitly run jobs keep their writes, results and meters.
Replay holds schedule admission; restart without it resumes at the next
boundary, skipping held periods. Already queued jobs still run, with their
new emits suppressed. Effects queued before replay keep their ordinary lifecycle.

`--hold-effects` only pauses worker claims: effects stay durable and become
claimable after restarting without the flag. `--hold-schedules` only holds
schedule admission, skipping held periods on restart. Use `--replay` when
new effects must never be delivered; use the effect hold to keep them queued.
The suppression policy stays on the dev store for local `run` invocations
until the next host start; a restart without `--replay` restores normal
emission for new writes and keeps the count. `serve` and release commands
refuse `--replay` with E_REPLAY_DEV_ONLY; production always emits normally.
With `--fresh`, the count dies with the in-memory store; `doctor` and local
`run` inspect the separate on-disk store.

Jobs in `snapback/jobs.q` are named `jobs.<name>` even in that file's schedules;
`schema.q` jobs use their bare names. `check --fix` qualifies an unambiguous bare module job.
Effects are global declarations shared by every file; jobs are module-qualified
operations. The worker dispatches by the declared effect name, while schedules
and `run` address an operation. If `digest.q` declares `effect notify` and
`job daily()`, write `emit notify { ... }`, register `effects: { notify: ... }`
in the worker, and schedule `digest.daily` (`schedule dailyDigest every 1d: digest.daily`).

```quarry
table invites:
  inviteeId: principal
  sentAt: time
  reminded: bool
  by byInvitee: inviteeId, id
  by bySentAt: sentAt, id
  immutable sentAt
  read <- .inviteeId = viewer
  insert <- deny
  update <- deny
  delete <- deny

job remind(periodStart: time, periodEnd: time):
  chunk i in invites[sentAt >= periodStart, sentAt < periodEnd] first 100 by bySentAt:
    if not i.reminded:
      update invites[i.id] { reminded: true }
schedule remindDaily every 1d at 08:00: remind          -- or `every 2m`, `every 1h`; the shortest period is 1m
```

A sweep by id visits every row ever written; a sweep by the period visits
the period.

A job is a sequence of sweeps, optionally preceded by statements. Those
statements run at the start of every chunk under its meter; their bindings
are visible in every chunk. A write belongs to a chunk, never the prelude.
Each `chunk x in table[prefix] first N by
index:` walks one index a page per commit as the system principal (every
rule passes; validation, constraints, aggregates and partitions apply)
under the job ceilings (guide bounds). The cursor commits with the rows, so
a chunk is wholly done or not started and a restart resumes at the next
one; the index's columns are `id` or `immutable`, so nothing moves under
the cursor, and rows inserted past the key captured when the sweep began
are not visited, so a sweep over its own table ends. A refused chunk parks
the job with its refusal (`snapback4 doctor` lists runs). No client calls
a job: a schedule fires it once per period boundary of the server's clock,
exactly once across restarts, passing `periodStart` and `periodEnd` when
the job declares them (and nothing else); a schedule first seen fires from
its next boundary. `snapback4 run <job> '{..}'` runs one here and now.

A schedule may also target an action: `schedule renewal every 1m as service:billing: remind`. The action must declare only `periodStart: time` and `periodEnd: time`, or no arguments. It runs under that service seat and its action rule, never as the system. Jobs cannot declare `as` (guide actions).

In tests, use `snapback4 clock advance <dur>` or `POST /dev/clock/advance`; each example line advances the running dev once.

```sh
snapback4 clock advance 36s
curl -X POST http://127.0.0.1:4400/dev/clock/advance -H 'Content-Type: application/json' -d '{"duration":"36s"}'
```

For development and tests, `snapback4 dev --clock-offset +25h` starts the
server 25 hours ahead of wall time. Mutations at `POST /m/<op>`
stamp `now` from this clock. The clock keeps ticking monotonically;
`snapback4 clock advance 2m [--port N]` moves a running dev forward and waits
for expiry sweeps and queued job chunks to finish. Missed periods fire once,
not once per skipped boundary; `--hold-schedules` still holds admission.
The response reports `now`, `advancedMs`, and work counts (including parked
jobs); if maintenance fails, time remains advanced and the normal tick retries
pending work, so do not blindly repeat the advance. The offset belongs to
this process and resets on restart; supply it again when continuing a test.
Rows stamped under an offset keep their times after restart; use a fresh store per offset test.
An advance extends held effect and action leases, including actions' viewer sessions, by its duration; ordinary sessions and retry times stay put.
Clients receive ordinary row times, nextExpiry and sync deletions; their
own clocks and the application wire do not change.

`snapback4 run <op> --now 1789352669447` pins just that local invocation
(query, mutation or job) to Unix milliseconds; `--now +25h` pins it relative
to wall time. Use an absolute past time to create an old post without a seed.
It does not advance a running host or fire schedules. Durations are positive
whole numbers with `ms`, `s`, `m`, `h`, `d` or `w`, optionally prefixed `+`;
a startup offset may also be negative. Backward/zero advances and invalid
values refuse E_CLOCK_INPUT. `serve` refuses clock flags and the control
endpoint with E_CLOCK_DEV_ONLY. The endpoint is dev-only loopback
`POST /dev/clock/advance` with `{"duration":"+2m"}`.

## A digest is a job that reads

Seek the period, filter the ordinal. The helper below serves both the UI's
`inbox(periodStart, periodEnd)` as the viewer and the scheduled job as the
system. Compare them for the same period and row state: an all-history inbox
can quite properly show more unread than this period's digest. A job may
read a table with expiry; an expired row is absent from its expiry instant,
even before the sweep deletes it. Tombstoned, own, already-read and
out-of-period messages do not contribute.

Authorization is structural here: the loop walks each principal's own
memberships. A job passes every rule, so a digest reading messages by any
other path must re-prove membership by hand before emitting to a principal.
A period-bucketed public activity counter does not establish that authority.

```quarry
use personas alice, bob, carol
effect push

table profiles:
  principal: principal
  unique byPrincipal: principal
  public 'profiles are public'
  insert <- .principal = viewer

table conversations:
  title: text <=80
  read <- exists members[.id, viewer]
  insert <- allow
  after insert <- exists members[.id, viewer]
  sync to members[.id]

table members:
  conversationId: conversations
  principal: principal
  readOrdinal: int default 0
  unique byConversationPrincipal: conversationId, principal
  by byPrincipalConversation: principal, conversationId, id
  cap 50 by conversationId
  cap 1000 by principal
  immutable conversationId, principal
  read <- exists members[.conversationId, viewer]
  insert <- exists members[.conversationId, viewer] or created conversations[.conversationId]
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to members[.conversationId]

table messages:
  conversationId: conversations
  senderId: principal
  ordinal: int
  body: text <=4000
  tombstone: bool default false
  at: time
  expiresAt: time ?
  unique byConversationOrdinal: conversationId, ordinal
  by byTime: at, id
  by byConversationTime: conversationId, at, id
  by byExpiresAt: expiresAt
  immutable conversationId, senderId, ordinal, at
  read <- exists members[.conversationId, viewer]
  insert <- .senderId = viewer and exists members[.conversationId, viewer]
  update <- .senderId = viewer
  expire at .expiresAt
  sync last 500 by byConversationOrdinal

fn unreadIn(conversationId: conversations, reader: principal, readOrdinal: int, periodStart: time, periodEnd: time):
  return count(messages[conversationId, at >= periodStart, at < periodEnd] first 100 by byConversationTime where not .tombstone and .senderId != reader and .ordinal > readOrdinal)

query inbox(periodStart: time, periodEnd: time):
  rows = []
  for m in members[viewer] first 1000 by byPrincipalConversation:
    rows = rows + [{ conversationId: m.conversationId, unread: unreadIn(m.conversationId, viewer, m.readOrdinal, periodStart, periodEnd) }]
  return rows

job digest(periodStart: time, periodEnd: time):
  chunk p in profiles first 1 by byId:
    unread = 0
    chats = 0
    for m in members[p.principal] first 1000 by byPrincipalConversation:
      n = unreadIn(m.conversationId, p.principal, m.readOrdinal, periodStart, periodEnd)
      if n > 0:
        chats = chats + 1
        unread = unread + n
    if unread > 0:
      emit push { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, unread, chats }
schedule daily every 1d at 08:00: digest
```

On published 0.2.27, a hub in 1,000 chats of 99 messages, newest 5 in the
period and nothing read, parked at E_BOUND when the helper sought
`ordinal > readOrdinal` and filtered time (125 ms). Seeking the period and
filtering the ordinal finished in one chunk, 57 ms, zero row writes and one
effect. These shared-host times describe that run, not a latency promise.
The suite uses 1,000 chats of 20 messages with the same 5 in the period:
the time seek examines 7,003, while the ordinal seek attempts examination
16,385 and parks at the 16,384 ceiling. Work scales with memberships plus
period messages in those chats, including expired-but-unswept candidates,
not the unread history. The exact meter also includes one attempt per scan,
the profile row and any page lookahead; 1,000 memberships plus 5,000 messages
is not a 6,000-examination chunk.

Keep that total examined work at or below 16,384 per profile chunk, with
the other job meters also fitting (guide bounds). With one profile, 1,000
memberships and no lookahead or expired candidates, 14,381 period messages
fit exactly at 16,384 examined; one more parks the chunk. This example covers at
most 1,000 memberships and at most 100 qualifying messages per chat; those
`first` bounds are not promises of an unbounded count. A busier single chat
needs its own message paging too. Past the chunk ceiling, `snapback4 doctor`
shows a parked run with `E_BOUND: examined rows reached the ceiling 16384`;
that profile emits nothing, and earlier profiles' committed effects remain.

A schedule fires once per period boundary across restarts, and a chunk's
emits commit with its cursor. A digest that finishes therefore emits once
per profile with positive unread in that run; zero-unread profiles are silent.
This is durable emission, not exactly-once external delivery. A run that parks
midway and is queued again is a new run: profiles already done emit again.
The regression's small profile emits, the hub parks, and queueing the same
period again moves queued effects from 1 to 2. Manually running a period
already completed also creates another run. For both cases, have the worker
treat `(targetUserId, periodEnd)` as its idempotency key, or check and write
an `emitted` marker row in the same chunk as the emit. A worker must still
make external delivery idempotent when an effect lease is retried.

## Past one profile's chunk envelope

Only when a profile exceeds that envelope does this digest need a totals
table. Sweep memberships by id in smaller chunks, accumulate into one table
keyed by `(principal, periodEnd)`, then sweep that period's totals to emit
and delete in the same chunk. The table is job-written only: `insert <- deny`
and `update <- deny` keep principals out. This complete alternative uses
25 memberships per chunk; it retains the helper's per-chat bound and reads
membership and message state at each chunk, not one snapshot of the whole
run. Resume the same run after a restart. Before starting a replacement run
for the same period, clear/rebuild any unfinished totals; otherwise earlier
contributions accumulate twice. Deleting a total is not a permanent emission
marker, so the worker's idempotency key still protects re-runs.

```quarry
use personas alice, bob, carol
effect push

table profiles:
  principal: principal
  unique byPrincipal: principal
  public 'profiles are public'
  insert <- .principal = viewer

table conversations:
  title: text <=80
  read <- exists members[.id, viewer]
  insert <- allow
  after insert <- exists members[.id, viewer]
  sync to members[.id]

table members:
  conversationId: conversations
  principal: principal
  readOrdinal: int default 0
  unique byConversationPrincipal: conversationId, principal
  by byPrincipalConversation: principal, conversationId, id
  cap 50 by conversationId
  cap 1000 by principal
  immutable conversationId, principal
  read <- exists members[.conversationId, viewer]
  insert <- exists members[.conversationId, viewer] or created conversations[.conversationId]
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to members[.conversationId]

table messages:
  conversationId: conversations
  senderId: principal
  ordinal: int
  body: text <=4000
  tombstone: bool default false
  at: time
  expiresAt: time ?
  unique byConversationOrdinal: conversationId, ordinal
  by byTime: at, id
  by byConversationTime: conversationId, at, id
  by byExpiresAt: expiresAt
  immutable conversationId, senderId, ordinal, at
  read <- exists members[.conversationId, viewer]
  insert <- .senderId = viewer and exists members[.conversationId, viewer]
  update <- .senderId = viewer
  expire at .expiresAt
  sync last 500 by byConversationOrdinal

fn unreadIn(conversationId: conversations, reader: principal, readOrdinal: int, periodStart: time, periodEnd: time):
  return count(messages[conversationId, at >= periodStart, at < periodEnd] first 100 by byConversationTime where not .tombstone and .senderId != reader and .ordinal > readOrdinal)

query inbox(periodStart: time, periodEnd: time):
  rows = []
  for m in members[viewer] first 1000 by byPrincipalConversation:
    rows = rows + [{ conversationId: m.conversationId, unread: unreadIn(m.conversationId, viewer, m.readOrdinal, periodStart, periodEnd) }]
  return rows


table digestTotals:
  principal: principal
  periodEnd: time
  unread: int
  chats: int
  unique byPrincipalPeriod: principal, periodEnd
  by byPeriod: periodEnd, id
  immutable principal, periodEnd
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny

job digestLarge(periodStart: time, periodEnd: time):
  chunk m in members first 25 by byId:
    if not exists profiles[m.principal]:
      continue
    n = unreadIn(m.conversationId, m.principal, m.readOrdinal, periodStart, periodEnd)
    if n > 0:
      t = digestTotals[m.principal, periodEnd]
      if t != null:
        update digestTotals[t.id] { unread: t.unread + n, chats: t.chats + 1 }
      else:
        insert digestTotals { principal: m.principal, periodEnd, unread: n, chats: 1 }
  chunk t in digestTotals[periodEnd] first 100 by byPeriod:
    emit push { targetUserId: t.principal, kind: 'digest', periodStart, periodEnd, unread: t.unread, chats: t.chats }
    delete digestTotals[t.id]
schedule dailyLarge every 1d at 08:00: digestLarge
```

## Refused jobs and schedules

E_JOB_CURSOR_INDEX means a chunk's scan key can move while the job writes.
For example, a sweep `chunk t in tasks first 100 by byScore:` is unsafe
when `score` is mutable: moving a row could skip or revisit it. Sweep by
`byId`, or declare the index's non-id columns `immutable` when they truly
never change. Keep mutable scores out of the resume key; the chunk cursor
and its writes commit together.

E_JOB_GENERATION means a queued job's definition changed or disappeared
before its next chunk. For example, editing `jobs.rescore` during its sweep
parks the old run instead of running a new body from an old cursor. Inspect
`snapback4 doctor`, check the new definition, and queue the job again with
`snapback4 run jobs.rescore '{}'`. Earlier committed chunks remain, so make
the new sweep safe over the work already done.

E_SCHEDULE means the clock cannot call the named target with its supplied
authority and arguments. For example, `schedule hourly every 1h: summarize`
cannot target a query; target a job, or an action with
`as service:billing`. A scheduled target accepts no arguments or only
`periodStart: time` and `periodEnd: time`. Jobs run as the system and
forbid `as`; actions need a seat their rule admits. Use the qualified
name for a module job, such as `jobs.summarize`.
"##;
