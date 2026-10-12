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
  is the key.
- Months and years are UTC; they take no offset. Local-time months (a time zone) are not available:
  for a fixed-offset zone west of UTC, store the client's local month in an `int` column.

## Schedules and expiry

- `schedule nightly every 1d at 03:00: digest` fires once per period of the server's clock, in UTC;
  periods are `every 2m`, `1h` or `1d [at HH:MM]` (`guide jobs`).
- `schedule billing every 1 month at day 1 09:00: bill` fires on calendar months (UTC); `every 3 months`
  fires in January, April, July and October, `every 1 year` in January. Days 1–28 only.
  `month(periodStart)` is the month that just ended.
- `expire at .expiresAt` ends a row's life at a time; a null time never expires (`guide expire`).
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

- `snapback4 dev --clock-offset +25h` starts the dev server 25 hours ahead; mutations stamp `now` from it.
- `snapback4 clock advance 2m [--port N]` moves a running dev forward, sweeps expiry and runs due
  schedules and jobs; over HTTP: `POST /dev/clock/advance` with `{"duration":"2m"}`. An advance across
  many boundaries runs each schedule once, and its reply names the period and `skippedPeriods`.
- The offset belongs to the process: restart with `dev --resume-clock` to continue from the store's
  newest stamp. `GET /dev/status` reports `now` and `clockOffsetMs`.
- `snapback4 run <op> --now +2h` (or milliseconds) pins the clock for one local run.
- In the client, `client.now()` is the server's time estimate; `useNow(deadline)` from `snapback4/react`
  re-renders at a deadline.
