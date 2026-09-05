# Schedules

Two triggers, one kind. A row timer fires once per row when a `time ?` column
is reached; a period timer fires once per whole-minute period. The target is a
mutation or a declared job of this project, run as the owner.

```q
schedule expireMessage on messages at .expiresAt:
  purgeMessage(.id)
```

```q
schedule dailyDigest every 24h:
  digestSweep
```

The engine keeps `_timers` as it keeps an index: writing a present `expiresAt`
enqueues, a different value reschedules, `null` or delete cancels, all inside
the row's own transaction; every program that writes the table certifies
`engineWrites: ["_timers"]`. Firing is one transaction on the owner's
background turn: the target runs (a job target is enqueued, not finished), the
timer settles or re-arms, and the ledger row `{ kind: "schedule", schedule,
occurrence, outcome }` commits with them. Occurrence identity is
`(schedule, row_id, at)` for a row timer and `(schedule, period_start)` for a
period: a job already queued or running for that occurrence coalesces, and a
mutation target must be idempotent on its arguments. A period re-arms to
`period_start + duration`; after an outage it fires once, for the latest missed
period, and records `skipped`. A rejected target settles with its refusal and
does not re-fire (row) or re-arms anyway (period). `if predicate` is evaluated
against the row at fire time; false settles silently. A row already past its
`expiresAt` when written fires on the next turn.

Development: `POST /control/clock` past a timer fires it on the next background
turn; a journey writes `expiresAt`, calls `tick(ms)`, and asserts the purge.
`GET /control/timers`, `trace timer:<id>`, `logs`, and `dev --status`
(`timers: { due, next_at, rejected }`) show firings; the `test` receipt gains
`schedules: { fired, late, rejected }`. Lateness is measured, never promised.

Refusals (`schedule`): `E_SCHEDULE_COLUMN` (declare the column `time ?`),
`E_SCHEDULE_TARGET` (a mutation or job whose arguments the row expressions
satisfy; `every` targets take none), `E_SCHEDULE_DURATION` (`Nm`, `Nh`, or
`Nd`, at least one minute; no time-of-day or calendar syntax).

Customers: the `chat` template's disappearing messages (`purgeMessage` writes
the `expired` log rows and deletes the body) and the `digestSweep` job fixture
(one effect per profile with a non-zero count, restart-idempotent by occurrence).
