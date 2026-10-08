# Snapback 4: enum `=` inside a job "never matched" (flashcard-duel-0225)

Status: Closed (not reproduced on 0.4.14 or main)
Date: 2026-10-08
Scope: Snapback 4 interpreter (job `if` comparisons)

## Evidence

App-farm round 1, single report flagged "possible defect": flashcard-duel-0225
(major, 15 min) — `if d.status = 'live'` in a scheduled job wrote 0 rows over 5
runs while `if d.status != 'done'` worked; `=` in mutation `require` worked.

## Repro attempt

```quarry
use personas alice
table duels:
  hostId: principal
  guestId: principal ?
  status: enum('open', 'live', 'done')
  endsAt: time
  immutable hostId, endsAt
  public 'lobby'
  insert <- .hostId = viewer
  update <- .hostId = viewer or .guestId = viewer
  online only
mutation open(endsAt: time):
  return insert duels { hostId: viewer, status: 'live', endsAt }
job finishEq(periodStart: time, periodEnd: time):
  for d in duels where .endsAt >= periodStart and .endsAt < periodEnd by .endsAt:
    if d.status = 'live':
      update duels[d] { status: 'done' }
```

`run open '{"endsAt":1000}'`, `run open '{"endsAt":2000}'`, then
`run finishEq '{"periodStart":0,"periodEnd":1500}'` → `rowsWritten: 1`, statuses
`['done', 'live']`; an unbounded sweep variant also matched. Same result with
the farm's 0.4.14 binary. The app's own schema matches this shape (period sweep
by `.endsAt`, enum status, `update <- .hostId = viewer or .guestId = viewer`).

## Likely explanation

The app's duels move `open → live` only when a guest joins
(`update duels[d] { guestId: viewer, status: 'live' }`); duels that expired
unjoined are `'open'`, which `!= 'done'` matches and `= 'live'` correctly does
not. A job run reports only `rowsWritten`, so "0 rows" gave no hint which rows
were visited and skipped.

## Resolution

Not a defect as far as reproduction shows. If round 2 repeats it, capture the
rows' statuses (`snapback4 data duels`) at the moment the job runs.
