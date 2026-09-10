# Schedules

`schedule` declares two triggers, one kind. A row timer fires once per row when a `time ?` column
is reached; a period timer fires once per whole-minute period. The target is a
mutation or a declared job of this project, run as the owner.

`schedule expireMessage on messages at .expiresAt: delete .` deletes its trigger
row through a private mutation. It has the same admission, settlement and
rejection reporting as a named target; generated removed events reach original recipients; rollback is
transactional and priced per fired row. Periods cannot use `delete .`.

```q
schedule expireMessage on messages at .expiresAt: delete .
```

```q
schedule dailyDigest every 24h: digestSweep()
```

An `every` binding may pass `.periodStart` or `.periodEnd`, both `time`, to
the target. These are the logical boundaries of the scheduled occurrence,
even when the owner fires it late; they are not ambient `now`.

```q
job periodDigestSweep(cutoff: time):
  chunk p in profiles first 1 by byId:
    cfg = settings() ! else CONFIG
    if cfg.replayMode = false:
      (_period, rem) = divmod(cutoff, cfg.digestPeriodMs)
      periodEnd = cutoff - rem
      periodStart = periodEnd - cfg.digestPeriodMs
```

Put cleanup in a later chunk of that same job, then bind the logical cutoff:

```q
schedule recipeDigest every 2m: periodDigestSweep(.periodEnd)
```

The engine keeps `_timers` as it keeps an index: writing a present `expiresAt`
enqueues, a different value reschedules, `null` or delete cancels, all inside
the row's own transaction; every program that writes the table certifies
`engineWrites: ["_timers"]`. Firing is one transaction on the owner's
background turn: the target runs (a job target is enqueued, not finished), the
timer settles or re-arms, and the ledger row `{ kind: "schedule", schedule,
occurrence, outcome }` commits with them. Occurrence identity is
`(schedule, row_id, at)` for a row timer and `(schedule, period_start)` for a
period: a job still queued or running for that occurrence coalesces (a done,
cancelled, or parked one is history, and the firing enqueues a fresh job), and
a mutation target must be idempotent on its arguments. A period re-arms to
`period_start + duration`; after an outage it fires once, for the latest missed
period, and records `skipped`. A rejected target settles with its refusal and
does not re-fire (row) or re-arms anyway (period). `if predicate` is evaluated
against the row at fire time; false settles silently. A row already past its
`expiresAt` when written fires on the next turn. A target is a system program:
like a job it leaves the client operation map and `/api/*` refuses it
(`E_OPERATOR_REQUIRED`); `run <target> --as system` runs it by hand, and a
client-callable version is a second program.

Development: `POST /control/clock` past a timer fires it on the next background
turn; a journey writes `expiresAt`, calls `tick(ms)`, and asserts the purge.
`GET /control/timers`, `trace timer:<id>`, `logs`, and `dev --status`
(`timers: { due, next_at, rejected }`) show firings; the `test` receipt gains
`schedules: { fired, late, rejected }`. Lateness is measured, never promised.

Refusals (`schedule`): `E_SCHEDULE_COLUMN` (declare the column `time ?`),
`E_SCHEDULE_TARGET` (a mutation or job whose arguments the row expressions
satisfy; `every` exposes only typed `.periodStart` and `.periodEnd`),
`E_SCHEDULE_DURATION` (`Nm`, `Nh`, or `Nd`, at least one minute; no time-of-day
or calendar syntax).

Customers: the chat template's `schedule expireMessage on messages at .expiresAt: delete .`
deletes the body and emits native `removed` events; `periodDigestSweep` runs periodic work.
For a digest, stamp source rows with `[periodStart, periodEnd)`, read current
bounded follows and memberships at emission, and combine them with
transactionally maintained per-author and per-chat period counts. Do not make
lifetime unread totals a period's eligibility. When lifetime receipts have
different cleanup authority, keep separate period custody keyed by recipient,
chat, membership id, and period. Its row rule can admit the recipient or the
message author only with an explicit current-membership conjunction; keep its
maintained count owner-only. Send, mark-read, unsend/expiry, and self-leave must
update period custody atomically. Count only the current membership id, so an
admin remove/rejoin cannot revive an old incarnation; an owner chunk job may
prune rows strictly older than the last completed bucket. Put that prune in a
later chunk of the same cutoff-bound digest job: a separate schedule can race
or overtake the digest that still needs the bucket.

A compact explicit post counter can replace an over-budget `maintain`, but
every create, delete, or key-changing update must adjust it in the same
transaction; deny any unpaired writer. This does not make arbitrary deletes
auto-maintained. Write the unique principal/period digest, application log and
effect in the same profile chunk; delete its transaction-local scratch before
commit. An all-zero period writes and emits nothing. Keep the configured period
equal to the `schedule` duration. Guard replay activity when each source row is
admitted as well as at the sweep: if replay mode can turn off inside a period,
a sweep-only guard leaks earlier replay writes. Keep current relationship
mirrors current during replay, but mark those follow events ineligible and skip
manual post-period counters until replay ends. A per-chat
pending-row cap is also the unread counting envelope: reading only the first
page must not claim later rows read. The compiled recipe admits at most 500
follows and 100 memberships per principal; row 101 refuses at write time
instead of disappearing behind a `first 100` digest read. Its separate
50-members-per-conversation cap remains.

See `guide expiry` for the complete timer → recipient log → tombstone →
reconnect drain recipe, including departed original recipients.
