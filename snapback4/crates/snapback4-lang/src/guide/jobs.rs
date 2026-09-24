//! The jobs card. Quarry examples are compiled by tests/guide.rs.
// @ref LLP 3000.007#21.1 — digest work seeks the period through each recipient's memberships.
// @ref LLP 3000.013#5 — streamed totals, adaptive sweeps and lifetime emission keys.
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

A top-level `for p in recipients:` is an adaptive sweep. It starts with 64
iterations per transaction, retries a meter-refused chunk at half that size,
and parks if one iteration cannot fit. Each successful chunk commits its
cursor and writes together. `doctor` and `run` report the chunk size, retry
count and peak heap. Explicit `chunk … first N by index` keeps its fixed size
and parks on any refusal. Inner domain loops share the chunk's meter. The sweep index must contain only
`id` or immutable columns. Its evaluated prefix and seek bounds are persisted
with the cursor; its prelude runs again before each chunk. Declare per-item
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

```quarry
effect periodDigest
table digestUsers:
  principal: principal
  public
  online only
table digestMembers:
  roomId: id
  principal: principal
  readOrdinal: int default 0
  unique byRoomPrincipal: roomId, principal
  by byPrincipal: principal, roomId, id
  read <- exists digestMembers[.roomId, viewer]
  online only
table digestMessages:
  roomId: id
  sender: principal
  ordinal: int
  at: time
  by byRoomTime: roomId, at, id
  read <- exists digestMembers[.roomId, viewer]
  online only
job daily(periodStart: time, periodEnd: time):
  for p in digestUsers:
    unread = 0
    for m in digestMembers[p.principal] by byPrincipal:
      unread = unread + count(digestMessages[m.roomId, at >= periodStart, at < periodEnd] by byRoomTime where .sender != p.principal and .ordinal > m.readOrdinal)
    if unread > 0:
      emit periodDigest { recipient: p.principal, unread } once [p.principal, periodEnd]
schedule dailyDigest every 1d: daily
```

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
schedule remindDaily every 1d at 08:00: remind          -- or: every 2m
```

A sweep by id visits every row ever written; a sweep by the period visits
the period.
`break` ends the sweep, `return` the job. Schedules accept `every 2m`,
`every 1h` and `every 1d at 08:00`; the shortest period is 1m.
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
Each `chunk x in table[prefix] first N by
index:` walks one index a page per commit as the system principal (every
rule passes; validation, constraints, aggregates and partitions apply)
under the job ceilings (guide bounds). The cursor commits with the rows, so
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
The example's `members` insert rule lets any member add a principal, who
then receives that chat's digest; where joining is by invitation, gate the
insert on an admin role instead (guide language).

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
  n = count(messages[conversationId, at >= periodStart, at < periodEnd] first 101 by byConversationTime where not .tombstone and .senderId != reader and .ordinal > readOrdinal)
  require n <= 100 else DIGEST_CHAT_BOUND
  return n

query inbox(periodStart: time, periodEnd: time):
  rows = []
  for m in members[viewer] first 1000 by byPrincipalConversation:
    rows = rows + [{ conversationId: m.conversationId, unread: unreadIn(m.conversationId, viewer, m.readOrdinal, periodStart, periodEnd) }]
  return rows

table digestMarkers:
  principal: principal
  periodEnd: time
  unique byPrincipalPeriod: principal, periodEnd
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny
  online only

job digest(periodStart: time, periodEnd: time):
  chunk p in profiles first 1 by byId:
    if exists digestMarkers[p.principal, periodEnd]:
      continue
    unread = 0
    chats = 0
    for m in members[p.principal] first 1000 by byPrincipalConversation:
      n = unreadIn(m.conversationId, p.principal, m.readOrdinal, periodStart, periodEnd)
      if n > 0:
        chats = chats + 1
        unread = unread + n
    if unread > 0:
      emit push { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, unread, chats }
    insert digestMarkers { principal: p.principal, periodEnd }
schedule daily every 1d at 08:00: digest
```

The period seek scales with memberships plus period messages in those chats,
including expired-but-unswept candidates, not the unread history. The meter
also includes scan attempts, profile and marker lookups, and page lookahead;
1,000 memberships plus 5,000 messages is not a 6,000-examination chunk.
Keep the entire profile's work at or below 16,384 examined rows, with the
other job meters also fitting (guide bounds). A refused profile commits
neither a marker nor an effect. Earlier profiles' committed effects remain.
The suite measures the current example and pins its examined boundary;
large bodies can hit the 16 MiB heap ceiling before the examined ceiling.

A schedule never fires twice for the same boundary across restarts; missed
boundaries coalesce into one run for the latest period, so a digest for a
day the server was down is never queued. The marker makes a new manual or
replacement run for the same recipient and period skip completed work,
including zero-unread recipients. The marker and any emit commit atomically
with the chunk's cursor. A crash before that commit leaves both absent;
a crash after it leaves both durable. Two queued runs use the same marker.

Markers contain no message bodies, are unreadable by ordinary principals
and never sync. Keep them for the life of the store in this recipe: deleting
a marker while accepting an old rerun reopens that delivery. The business
key `(targetUserId, periodEnd)` remains the same when implementation policy
changes. This is durable effect admission, not exactly-once external delivery.
Have the worker and provider deduplicate that business key when an effect
lease is retried; an effect's own `meta.id` alone does not identify the period.

## Past one profile's chunk envelope

This recipe computes exact live state for one recipient in one transaction.
It supports at most 1,000 memberships and 100 qualifying period messages per
chat, and the entire recipient must fit the unchanged job meters. The helper
reads up to 101 matches and refuses DIGEST_CHAT_BOUND before emitting if the
chat exceeds 100. `count(first N ...)` counts that page, not the whole range.
A larger `first` alone neither proves an exact total nor removes the heap
cost of decoding stored message bodies. Read projections still fetch the
stored rows before shaping them.

The membership limit is enforced by `cap 1000 by principal` in this schema.
A `first 1000` loop without that matching cap is not a proof that it visited
every chat. The per-chat helper uses a different proof: read one beyond its
100-message product limit and explicitly refuse. Keep the schema cap or the
overflow check when adapting either part; a completed job and durable marker
alone do not certify that an authored bounded count covered the whole domain.

Row width matters even when the result is just an integer. The retained
recipient-heavy count fixture has 5,000 candidates, 4,900 qualifying messages,
31-byte bodies and 50 recipient IDs per message; it exceeds the unchanged
16 MiB heap ceiling. That is not a 5,000-message universal limit: the existing
small-row fixture counts 10,000, while 10,000 rows with 2,000-byte bodies refuse.
Measure your stored message shape and all components of one recipient together.
Selecting fewer fields in a returned shape does not avoid decoding those
stored fields. No projected-count execution path is promised by this recipe.

The previous `digestLarge` example accumulated membership chunks and deleted
its totals after emitting. It was not a correct alternative for a live unread
digest: between counting and emission a message can expire, be deleted or
become read, or membership can end. Rechecking only membership cannot repair
those stale counts; deleting totals does not prevent a replacement run from
emitting twice. Do not use a paged live accumulator for this contract.

A larger chat or whole-recipient total may still park with E_BOUND. Inspect
`snapback4 doctor`, reduce the supported product scope or change the design,
and rerun only after the recipient fits. Earlier committed recipients keep
their markers and are skipped by the replacement run. There is no automatic
exact multi-chunk live digest or digest installer. Counts of followers or
Following posts are separate product components: add them inside this same
recipient transaction, prove their read scope and completeness, and include
their work when measuring the envelope. This message-only example does not
claim to implement those components.

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
name for a module job, such as `jobs.summarize`."##;
