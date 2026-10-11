# Time: now, durations, calendar days and the dev clock

A `time` is Unix milliseconds in UTC, and `now` is the writing host's clock.
Durations are milliseconds too, and `day`, `hour` and `bucket` turn a time into a calendar number.

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
- There are no time zones and no date type. Compute local wall-clock dates, weekdays and months in the
  client from the millisecond number.

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

## Schedules and expiry

- `schedule nightly every 1d at 03:00: digest` fires once per period of the server's clock, in UTC;
  periods are `every 2m`, `1h` or `1d [at HH:MM]` (`guide jobs`).
- `expire at .expiresAt` ends a row's life at a time; a null time never expires (`guide expire`).

## The dev clock

- `snapback4 dev --clock-offset +25h` starts the dev server 25 hours ahead; mutations stamp `now` from it.
- `snapback4 clock advance 2m [--port N]` moves a running dev forward, sweeps expiry and runs due
  schedules and jobs; over HTTP: `POST /dev/clock/advance` with `{"duration":"2m"}`.
- The offset belongs to the process: restart with `dev --resume-clock` to continue from the store's
  newest stamp. `GET /dev/status` reports `now` and `clockOffsetMs`.
- `snapback4 run <op> --now +2h` (or milliseconds) pins the clock for one local run.
- In the client, `client.now()` is the server's time estimate; `useNow(deadline)` from `snapback4/react`
  re-renders at a deadline.
