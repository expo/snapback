# Schedules

`schedule` binds a row deadline (`time ?`) or a whole-minute period to a local
mutation or job, run as the owner. **Daily at 08:00 UTC:** use the persisted
row-clock recipe below. `every 24h` fires at 00:00 UTC; it has no phase syntax.

## Daily at a configured UTC hour

Add these tables to `schema.q`; only the system can write them:

```q
table digestClocks:
  nextAt: time ?
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny

table dailyDigestReceipts:
  principal: principal
  cutoff: time
  unique byPrincipalCutoff: principal, cutoff
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny
```

Run `snapback2 run admin.armDailyDigest '{"utcHour":8}' --as system` once.
The clock is persisted, not reinitialized on restart. This scheduling example
uses the fixture's profile counters and `digest` effect (`guide effects`):

```q
mutation armDailyDigest(utcHour: int):
  require utcHour >= 0 and utcHour < 24 else UTC_HOUR
  require digestClocks['daily'] = null else ALREADY_ARMED
  (_day, rem) = divmod(now - utcHour * 3600000, 86400000)
  insert digestClocks { id: 'daily', nextAt: now - rem + 86400000 }
  return null

job utcDigestSweep(clockId: digestClocks, cutoff: time):
  chunk p in profiles first 1 by byId:
    prior = dailyDigestReceipts[p.principal, cutoff]
    if prior = null and p.newFollowers + p.unreadMessages > 0:
      insert dailyDigestReceipts { principal: p.principal, cutoff }
      emit digest { to: p.principal, newFollowers: p.newFollowers, unreadMessages: p.unreadMessages }
  chunk clock in digestClocks first 1 by byId:
    if clock.id = clockId and clock.nextAt = cutoff:
      update digestClocks[clock] { nextAt: cutoff + 86400000 }

schedule utcDigest on digestClocks at .nextAt: utcDigestSweep(.id, .nextAt ! else DEADLINE)
```

Replace sample counters with eligible activity in `[cutoff - 86400000, cutoff)`;
source buckets need the same UTC offset. Cleanup precedes the clock chunk.
Unique receipt, digest/log and effect commit together; zero activity emits
nothing. Job restart/manual replay cannot duplicate logical emission; provider
delivery needs effect idempotency (`meta.id`). If the clock stalls, inspect
`trace`: resume a parked job; cancellation is terminal, so run `utcDigestSweep`
again with the same clock id and original cutoff. Never reset a running deadline. The cutoff guard prevents stale replays advancing newer clocks.
Catch-up processes every missed day serially from stored cutoff, never `now`.
No local-zone/DST or calendar semantics.

## Periods and expiry

```q
schedule expireMessage on messages at .expiresAt: delete .
```

`delete .` uses a private mutation with transactional settlement and native
removed events; periods cannot use it. `guide expiry` covers recipient custody.

```q
schedule dailyDigest every 24h: digestSweep()
```

`every` exposes `.periodStart` and `.periodEnd` (`time`): logical occurrence
boundaries after a late fire, not ambient `now`. Boundaries are whole-duration
Unix-epoch multiples. Midperiod install/reset arms the next boundary. Reopen
preserves a legacy offset start until that boundary without history lookup;
a full-period delay catches up to the latest whole interval.

```q
job periodDigestSweep(cutoff: time):
  chunk p in profiles first 1 by byId:
    cfg = settings() ! else CONFIG
    if cfg.replayMode = false:
      (_period, rem) = divmod(cutoff, cfg.digestPeriodMs)
      periodEnd = cutoff - rem
      periodStart = periodEnd - cfg.digestPeriodMs
```

Cleanup belongs in a later chunk of the same cutoff-bound job:

```q
schedule recipeDigest every 2m: periodDigestSweep(.periodEnd)
```

## Settlement and observation

`_timers` is transactional: present deadline enqueues, changed value reschedules,
null/delete cancels; writers certify `engineWrites: ["_timers"]`. Target,
settlement and schedule/occurrence/outcome ledger commit together. Jobs only
enqueue at fire time. Identity: `(schedule,row_id,at)` or
`(schedule,period_start)`. Queued/running jobs coalesce; other states are history.
Mutation targets must be idempotent.

Periods re-arm from their logical boundary; an outage fires only the latest
missed interval and records `skipped`. Rejected periods re-arm; rejected rows
settle. Retry a row by changing its deadline; same-value/unrelated writes do
not re-arm it. A false row `if` settles silently; past deadlines fire next turn.
Targets leave the client map (`E_OPERATOR_REQUIRED`); run manually `--as system`.

Use journey `tick(ms)` or `POST /control/clock`; inspect `/control/timers`,
`trace timer:<id>`, `logs`, `dev --status` (`due,next_at,rejected`) and test
receipts (`fired,late,rejected`). Lateness is measured, never promised.

`E_SCHEDULE_COLUMN`: use `time ?`. `E_SCHEDULE_TARGET`: local mutation/job,
typed arguments. `E_SCHEDULE_DURATION`: `Nm|Nh|Nd`, at least one minute;
no calendar/time-of-day syntax.

## Digest data obligations

Use current bounded follows/memberships and period counts, never lifetime
unread totals. Separate period custody, where needed, keys recipient, chat,
membership id and period; recipient/author rules require current membership,
and maintained counts stay owner-only. Send/read/unsend/expiry/self-leave
update it atomically. Count only the current membership incarnation.

Prune old buckets after emission in the same job. Explicit counters must
cover every create/delete/key change atomically; deny unpaired writers.
Receipt, digest/log and effect share a chunk; remove scratch before commit.
Guard replay at admission and sweep, keep relationship mirrors current,
exclude replay follows/posts, and match configured period to duration.
A pending-row cap bounds unread counting; paging cannot mark unseen rows read.

The two-minute fixture caps 500 follows, 100 memberships per principal and
50 members per conversation; row 101 refuses. This fixture does not cover a
1,000-membership hub. `guide fanout` explains complete job chunking.
