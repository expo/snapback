# Time: now, durations, calendar days and the dev clock

A `time` is Unix milliseconds in UTC, and `now` is the writing host's clock.
Durations are milliseconds too; `day`, `hour`, `bucket`, `month` and `year` turn a time into a calendar number.

```quarry
use personas alice, bob

table shifts:
  owner: principal
  title: text 1..80
  startsAt: time                          -- Unix milliseconds, UTC
  endsAt: time
  createdAt: time default now             -- stamped by the writing host's clock
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  cap 500 by owner
  sync to .owner

view shiftsByDay: count shifts by .owner, day(.startsAt)      -- a UTC day number per group
  read <- .owner = viewer

table checkins:
  person: principal
  at: time default now
  unique person, day(at) else ALREADY_CHECKED_IN 'One check-in per day.'
  read <- .person = viewer
  insert <- .person = viewer
  sync to .person last 30 by .at

query upcoming(c: cursor ?):
  return shifts where .owner = viewer and .startsAt >= now first 20 by .startsAt after c

query today():                            -- day: 20737; midnight: 1791676800000 (2026-10-11T00:00Z)
  return { day: day(now), midnight: day(now) * 1d, shifts: shiftsByDay[viewer, day(now)] }

query pacificToday():                     -- days that start at 08:00 UTC: midnight at UTC-8, no DST
  return { day: day(now, 8h), starts: day(now, 8h) * 1d + 8h }

query thisMonth():                        -- month: 681 (2026-10), year: 2026; [start, end) as times
  m = month(now)
  return { month: m, year: year(now), start: monthStart(m), end: monthStart(m + 1) }

mutation addShift(title: text 1..80, startsAt: time, hours: int):
  require hours >= 1 and hours <= 24 else BAD_LENGTH 'A shift is 1 to 24 hours.'
  require startsAt >= now - 1d else IN_THE_PAST
  return insert shifts { owner: viewer, title, startsAt, endsAt: startsAt + hours * 1h }

mutation checkIn():
  return insert checkins { person: viewer }
```

## Values

- `time` columns and arguments hold Unix milliseconds (UTC). On the wire and in JS a time is a number:
  `Date.now()`, `new Date(row.startsAt)`. Fixture rows use the same numbers.
- `now` is the clock of the host running the operation: the server, or the device for a predicted write.
  `default now` stamps an omitted field the same way.
- Duration grammar: one non-negative integer immediately followed by `ms`, `s`, `m`, `h` or `d`; no spaces, fractions or compound `1h30m` literals. Use `1h + 30m` in Quarry.
- Duration literals: `500ms`, `30s`, `15m`, `24h`, `7d`. They are plain integers of milliseconds:
  `now + 1h`, `.endsAt - .startsAt` (elapsed ms), `hours * 1h`, `.at >= now - 7d`.
- There are no time zones and no date type. Compute local wall-clock dates, weekdays and local months in
  the client from the millisecond number; UTC months are `month(t)` below.

## Calendar numbers: day, hour, bucket

- `day(t)` is the UTC day number, `floor(t / 1d)`: 20737 is 2026-10-11, not a timestamp.
  `day(t) * 1d` is that day's midnight UTC as a time; in JS `new Date(day * 86_400_000)`.
- `hour(t)` counts hours the same way; `bucket(t, 15m)` counts any period.
- An offset moves the boundary: `day(t, 8h)` days start at 08:00 UTC (midnight at UTC-8, without DST),
  `hour(t, 30m)`, `bucket(t, 1d, 8h)`. The offset is fixed, so a zone with DST shifts by an hour.
- Use them as group keys (`view … by .owner, day(.startsAt)`), in `unique person, day(at)` (one per day),
  and in range filters (`.at >= day(now) * 1d` is "since midnight UTC").
- A `time` column accepts any integer, so storing `day(now)` there type-checks and reads as January 1970.
  Store `day(now) * 1d`, or keep the day number in an `int` column.

## Months and years (UTC)

- `month(t)` counts months since 1970-01: 681 is 2026-10, -1 is 1969-12. Arithmetic is continuous:
  `month(now) - 1` is last month, `month(.at) >= month(now) - 2` is the last three months.
- `year(t)` is the calendar year (2026); `month(t) / 12 + 1970` equals it.
- `monthStart(m)` and `yearStart(y)` are the first instants, as `time`s. A month is `[monthStart(m),
  monthStart(m + 1))`; there is no `monthEnd`, because ranges are half-open. They refuse E_OVERFLOW only
  beyond about ±285,000 years.
- Keys and views take them like `day`: `unique person, month(at) else ALREADY_THIS_MONTH`,
  `view … by .owner, month(.at)`, `checkins[viewer, month(now)]`.
- In JS: `Date.UTC(1970, m)` is the month's start; `(d.getUTCFullYear() - 1970) * 12 + d.getUTCMonth()`
  is the key. A JS `Date` spans ±8.64e15 ms, less than a `time`, so the extreme times are `Invalid Date`.
- Months and years are UTC; they take no offset. Local-time months (a time zone) are not available:
  for a fixed-offset zone west of UTC, store the client's local month in an `int` column.

## Schedules and expiry

- `schedule nightly every 1d at 03:00: digest` fires once per period of the server's clock, in UTC;
  periods are `every 2m`, `1h` or `1d [at HH:MM]` (`guide jobs`).
- `schedule billing every 1 month at day 1 09:00: bill` fires on calendar months (UTC); `every 3 months`
  fires in January, April, July and October, `every 1 year` in January. Days 1–28 only.
  `month(periodStart)` is the month that just ended.
- `expire at .expiresAt` ends a row's life at a time; a null time never expires (`guide expire`).
- `not before .opensAt` starts a server-enforced read lifetime when the server's
  durable clock reaches the value; null is immediately readable. Device wall
  clocks and server-time estimates never authorize early disclosure. The
  compiled `[opensAt, expiresAt)` recipe is `guide timed disclosure`.

## E_TIME_AUDIENCE_PENDING

E_TIME_AUDIENCE_PENDING means an opened row is still waiting for its bounded server publication. A read
never decides that the row is absent. HTTP queries wait for encountered live
publication dependencies, then reevaluate; a 30-second limit returns retryable
E_QUERY_RETRY (503). Other unavailable reasons can still return loading. A mutation rolls
back without retaining its operation id, so the client can retry the same
write. The refusal is retryable and reveals no row id or opening time.

- Catch-up: a schedule fires once per boundary, never twice. Boundaries it missed (the server was
  down, or `clock advance` jumped past them) coalesce into one run for the latest period once
  the server is back; `periodStart`/`periodEnd` describe that last period only. A schedule
  first seen fires from its next boundary.
- So a job that sweeps exactly `[periodStart, periodEnd)` never visits rows that fell due in the
  skipped periods. Sweep back from `periodEnd` and skip rows already handled, so one run catches up:

```quarry
table trains:
  name: text <=40
  departsAt: time
  open: bool default true
  immutable departsAt
  public 'the departures board'
  insert <- allow
  online only

job closeDeparted(periodStart: time, periodEnd: time):
  for t in trains where .departsAt >= periodEnd - 7d and .departsAt < periodEnd by .departsAt:
    if t.open:
      update trains[t.id] { open: false }

schedule closer every 1m: closeDeparted
```

- Where the decision is made by a caller, compare with `now` instead and need no job:
  `require t.departsAt > now else DEPARTED`. `guide recipes --section schedules` has both together.
- A period you still need runs by hand: `snapback4 run closeDeparted '{"periodStart":…,"periodEnd":…}'`.

## The dev clock

- CLI clock durations use one positive whole number and `ms`, `s`, `m`, `h`, `d` or `w`, optionally prefixed `+`: use `90m`, not `1h30m`. Quarry uses `7d` instead of `1w`.
- `snapback4 dev --clock-offset +25h` starts the dev server 25 hours ahead; mutations stamp `now` from it.
- `snapback4 clock advance 2m [--port N]` moves a running dev forward, sweeps expiry and runs due
  schedules and jobs; over HTTP: `POST /dev/clock/advance` with `{"duration":"2m"}`. An advance across
  many boundaries runs each schedule once, and its reply lists firedWindows and
  skippedBoundaries with periodStart/periodEnd and a literal run command for each
  skipped window. Add --each-boundary (HTTP eachBoundary:true) to admit every crossed
  window in chronological order. Jobs see final advanced now; use period arguments
  for historical windows, or separate advances to test now at each boundary.
  The advance refuses more than 10000 total crossed windows before changing time.
  If work fails after time advances, inspect now/skewMs; normal maintenance resumes
  queued work. Reset the scenario with reset --clock reset rather than repeating
  the advance blindly. E_CLOCK_INTERRUPTED means shutdown stopped the drain:
  time already moved; inspect queued jobs before restarting the test.
- Clock and reset discover a unique live dev in the current project, including `dev --memory --port N`. Multiple hosts list their addresses and require `--port N`; no default port is guessed. Registrations live in `.snapback4/dev-hosts`, contain no secrets, and stale hosts are ignored.
- The offset belongs to the process: restart with `dev --resume-clock` to continue from the store's
  newest stamp. `GET /dev/status` reports `now`, `skewMs` and `clockOffsetMs`. `/dev/clock/status` and reset
  also carry now/skewMs; `await dev.now()` from snapback4/proof reads it afresh.
  They include a persisted timed-disclosure floor, which may hold served time
  after restart; --resume-clock continues the store’s advanced clock.
- `snapback4 run <op> --now +2h` (or milliseconds) pins the clock for one local run.
- In the client, `client.now()` is the server's time estimate; `useNow(deadline)` from `snapback4/react`
  re-renders at a deadline.

## Monthly billing (UTC) with `money`

One invoice per subscription per calendar month, billed by a monthly
schedule. `month(t)` is the month ordinal (681 is 2026-10), so the months to
bill are plain ints and `unique subscription, month` makes each invoice once.

```quarry
table plans:
  name: text 1..40
  price: money USD
  unique name
  public 'the price list'
  insert <- deny
  cap 20
  sync public

table subscriptions:
  owner: principal
  plan: plans
  startMonth: int
  billedThrough: int                     -- the last month invoiced
  immutable owner, plan, startMonth
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- deny
  online only

table invoices:
  subscription: subscriptions
  owner: principal
  month: int
  amount: money USD
  unique subscription, month
  immutable subscription, owner, month, amount
  read <- .owner = viewer
  insert <- deny
  update <- deny
  delete <- deny
  online only

mutation subscribe(plan: plans):
  require exists plans[plan] else NOT_FOUND
  m = month(now)
  return insert subscriptions { owner: viewer, plan, startMonth: m, billedThrough: m - 1 }

query myInvoices(c: cursor ?):
  return invoices where .owner = viewer last 12 by .month after c

job bill(periodStart: time, periodEnd: time):
  due = month(periodStart)                -- the month that just ended
  for s in subscriptions:
    p = plans[s.plan] ! else NOT_FOUND
    upto = min(due, s.billedThrough + 12)  -- at most twelve months per subscription per run
    if s.billedThrough < upto:
      for m in range(s.billedThrough + 1, upto + 1):
        insert invoices { subscription: s.id, owner: s.owner, month: m, amount: p.price } if absent
      update subscriptions[s.id] { billedThrough: upto }

schedule billing every 1 month at day 1 09:00: bill
```

The schedule fires at 09:00 UTC on the 1st. Missed boundaries coalesce into
one run, so the job bills from `billedThrough`, not just `periodStart`'s
month: after a two-month outage the next run bills both months, and a rerun
writes nothing (`if absent`, then `billedThrough` has moved). A backlog
longer than twelve months shrinks by eleven a run. Charge a payment provider
from an `effect` keyed by the invoice id, the provider's idempotency key;
the unique invoice stops duplicate rows, not duplicate charges. Test with
`snapback4 clock advance 62d` on a running `dev`. Months here are UTC; a
local-time month needs a time zone, which Quarry does not have.
