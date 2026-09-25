//! The jobs card. Quarry examples are compiled by tests/guide.rs.
// @ref LLP 3000.007#21.1 — digest work seeks the period through each recipient's memberships.
// @ref LLP 3000.013#5 — streamed totals, adaptive sweeps and lifetime emission keys.
pub(super) const CARD: &str = r##"# Jobs and schedules: the server's own work, on its own clock

Jobs do background work on the server, with progress committed as they go.
Schedules start them at boundaries of the server's clock.

```quarry
table invites:
  inviteeId: principal
  sentAt: time
  reminded: bool
  immutable sentAt
  read <- .inviteeId = viewer
  insert <- deny
  update <- deny
  delete <- deny

job remind(periodStart: time, periodEnd: time):
  for i in invites where .sentAt >= periodStart and .sentAt < periodEnd by .sentAt:
    if not i.reminded:
      update invites[i.id] { reminded: true }
schedule remindDaily every 1d at 08:00: remind          -- or: every 2m
```

A top-level `for p in recipients:` is an adaptive sweep. The engine chooses
the iterations per transaction, retries a meter-refused chunk at a smaller size,
and parks if one iteration cannot fit. Each successful chunk commits its
cursor and writes together. `doctor` and `run` report the chunk size, retry
count and peak heap. Inner domain loops share the chunk's meter. The sweep index must contain only
`id` or immutable columns. Its evaluated prefix and seek bounds are persisted
with the cursor; its prelude runs again before each chunk.
An explicitly paged `for` before the first sweep stays
in that prelude and does not create commits of its own. Declare per-item
locals inside the loop. A prelude local assigned by the sweep is refused
because it cannot carry a value across independent commits. Rule, constraint
and generation refusals park immediately, without reducing the chunk size.

A domain `count` or `sum` has no page clause: it authorizes and filters each
row, folds its value, then releases the transient row. All work remains metered;
a job or mutation refuses the whole transaction if a total cannot finish.
Jobs run as the system principal; this example establishes each recipient's
scope by iterating that recipient's current memberships. Each recipient's
live counts and effect key below commit in one transaction.
`once` removes the need for a marker table; worker/provider delivery retries
still need an idempotency key.

Effects are global declarations shared by every file; jobs are module-qualified
operations. The worker dispatches by the declared effect name, while schedules
and `run` address an operation. If `digest.q` declares `effect notify` and
`job daily()`, write `emit notify { ... }`, register `effects: { notify: ... }`
in the worker, and schedule `digest.daily` (`schedule dailyDigest every 1d: digest.daily`).

A sweep by id visits every row ever written; a sweep by the period visits
the period.
`break` ends the sweep, `return` the job. Schedules accept `every 2m`,
`every 1h` and `every 1d at 08:00`. Periods accept `ms`, `s`, `m`, `h` and `d`:
`every 120s` equals `every 2m`, and `every 90s` fires at exact 90-second
boundaries. A schedule fires at most once a minute.
A job in `snapback/jobs.q` is named `jobs.<name>` in every schedule;
`schema.q` jobs use bare names. `check --fix` qualifies an unambiguous
bare module job. Jobs are not on `api.ts`.

One `use server` in any module (`schema.q` is usual) enables the whole
project; repeating it is harmless. Actions, routes and schedules naming an
action require it. Effects (including secrets, retry, backoff, deadline and
cancellation), jobs, schedules naming a job and service seats need no directive.
See `guide actions` and `guide routes` for the gated declarations.

A job is a sequence of sweeps, optionally preceded by statements. Those
statements run at the start of every chunk under its meter; their bindings
are visible in every chunk. A write belongs to a chunk, never the prelude.
A top-level `for x in table where predicate:` walks a stable domain as the
system principal. Every rule passes; validation, constraints, views and
partitions still apply. It runs under the job ceilings (guide bounds). The cursor commits with the rows, so
a chunk is wholly done or not started and a restart resumes at the next
one; the index's columns are `id` or `immutable`, so nothing moves under
the cursor, and rows inserted past the key captured when the sweep began
are not visited, so a sweep over its own table ends. A refused fixed chunk parks
the job with its refusal (`snapback4 doctor` lists runs). No client calls
a job: a schedule fires it at a period boundary of the server's clock,
never twice for the same boundary across restarts, passing `periodStart`
and `periodEnd` when the job declares them (and nothing else). Boundaries
missed while the server was down coalesce into one run for the latest
period; a schedule first seen fires from its next boundary. `snapback4 run <job> '{..}'` runs one here and now.

A schedule may also target an action: `schedule renewal every 1m as service:billing: remind`. The action must declare only `periodStart: time` and `periodEnd: time`, or no arguments. It runs under that service seat and its action rule, never as the system. Jobs cannot declare `as` (guide actions).

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
The example's `members` insert rule lets any member add a principal, who
then receives that chat's digest; where joining is by invitation, gate the
insert on an admin role instead (guide language).

```quarry
use personas alice, bob, carol
effect push

table profiles:
  principal: principal
  unique principal
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
  unique conversationId, principal
  cap 50 by conversationId
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
  unique conversationId, ordinal
  immutable conversationId, senderId, ordinal, at
  read <- exists members[.conversationId, viewer]
  insert <- .senderId = viewer and exists members[.conversationId, viewer]
  update <- .senderId = viewer
  expire at .expiresAt
  sync last 500 by .ordinal

fn unreadIn(conversationId: conversations, reader: principal, readOrdinal: int, periodStart: time, periodEnd: time):
  return count(messages where .conversationId = conversationId and .at >= periodStart and .at < periodEnd and not .tombstone and .senderId != reader and .ordinal > readOrdinal)

query inbox(periodStart: time, periodEnd: time, c: cursor ?):
  return members where .principal = viewer first 20 by .conversationId after c { conversationId, unread: unreadIn(.conversationId, viewer, .readOrdinal, periodStart, periodEnd) }

job digest(periodStart: time, periodEnd: time):
  for p in profiles:
    unread = 0
    chats = 0
    for m in members where .principal = p.principal:
      n = unreadIn(m.conversationId, p.principal, m.readOrdinal, periodStart, periodEnd)
      if n > 0:
        chats = chats + 1
        unread = unread + n
    if unread > 0:
      emit push { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, unread, chats } once [p.principal, periodEnd]
schedule daily every 1d at 08:00: digest
```

The period predicate seeks messages in each recipient's current memberships.
Expired, tombstoned, own, already-read and out-of-period messages contribute
nothing. Streaming releases each decoded row after counting it; it retains no
page of bodies. All examinations, steps and retained values still count against
the job's meters. A meter refusal rolls back the whole attempted chunk before
retrying fewer recipients. One recipient that cannot fit parks the job with
E_BOUND; inspect `snapback4 doctor` and the named read before rerunning.

Each recipient's live total and emission key commit together. A crash before
commit leaves both absent; a crash after it leaves both durable. Rerunning the
same period skips an already emitted effect. A zero-unread recipient records
no key and can emit on a later rerun if its live state changed. `once` is
emission deduplication, not a completion marker or a snapshot across chunks.
The worker still deduplicates `(targetUserId, periodEnd)` at its provider.

A schedule never fires twice for the same boundary across restarts. Missed
boundaries coalesce into one run for the latest period. No automatic backfill
for missed days is implied. Do not accumulate a live unread total over several
commits: expiry, membership and read ordinals can change between them.

DIGEST_CHAT_BOUND belongs to the older bounded digest recipe. That refusal
rolled back the recipient without an effect or marker. Replace its paged
count with `count(messages where .conversationId = conversationId and .at >=
periodStart and .at < periodEnd)` and its marker with `emit … once` as above.
The runtime meter still refuses work that cannot finish.

## Operations

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
Devices keep the server's time for predictions, reads and expiry, including offline starts.
`clock advance` and `--clock-offset` reach connected devices at their next response.
Estimated server time is unfloored: it refines the offset and schedules server-answer refetches.
Issued device time (`client.now()`) is monotonic: it drives device execution, predictions, expiry and rendering.
Freshness labels (`since` / `syncedAt`) use wall time, so "as of three minutes ago" stays meaningful.

`snapback4 run <op> --now 1789352669447` pins just that local invocation
(query, mutation or job) to Unix milliseconds; `--now +25h` pins it relative
to wall time. Use an absolute past time to create an old post without a seed.
It does not advance a running host or fire schedules. Durations are positive
whole numbers with `ms`, `s`, `m`, `h`, `d` or `w`, optionally prefixed `+`;
a startup offset may also be negative. Backward/zero advances and invalid
values refuse E_CLOCK_INPUT. `serve` refuses clock flags and the control
endpoint with E_CLOCK_DEV_ONLY. The endpoint is dev-only loopback
`POST /dev/clock/advance` with `{"duration":"+2m"}`.

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

## Refusals

Optional presence filters belong inside a sweep body: `for row in tasks:`
followed by `if status = null or row.status = status:`. A conditional read
cannot be the sweep domain. E_JOB_SWEEP parks stored job IR with no recorded
table sweep or an unsupported top-level work loop before running a chunk,
including when valid sweeps appear alongside that loop. Bounded setup loops
before a sweep may compute its prefix, such as `sum([{ n: 1 }], .n)`, provided
both their domains and bodies are write-free and emit-free. They run again
under each chunk's meter. Inner loops keep their existing execution. Rebind
unsupported work as ordinary sweeps and queue the job again.

E_QUARRY_JOB_SCHEDULE separates work from its clock. Replace
`job sweep every 1h:` with `job sweep():`, keep the indented body, and add
`schedule sweepEvery every 1h: sweep` as a separate declaration.

E_JOB_CURSOR_INDEX means a chunk's scan key can move while the job writes.
For example, a sweep `for t in tasks by .score:` is unsafe
when `score` is mutable: moving a row could skip or revisit it. Use `for t in tasks:` to sweep by id, or declare its order columns `immutable` when they truly
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
name for a module job, such as `jobs.summarize`."##;
