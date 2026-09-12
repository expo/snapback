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
The persisted clock survives restart. The fixture supplies counters and
`digest` (`guide effects`):

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
Receipt, log and effect commit together; zero emits nothing. Restart/replay
cannot duplicate logical emission; provider delivery uses `meta.id`.
Inspect stalled jobs with `trace`; resume parked work. After cancellation,
rerun `utcDigestSweep` with the original id/cutoff. Never reset the deadline.
The guard prevents stale replay advancing newer clocks. Catch-up uses stored
cutoffs serially, with no local-zone/DST or calendar semantics.

## Periods and expiry

```q
schedule expireMessage on messages at .expiresAt: delete .
```

`delete .` uses a private mutation with transactional settlement and native
removed events; periods cannot use it. `guide expiry` covers recipient custody.

```q
schedule dailyDigest every 24h: digestSweep()
```

`every` exposes logical `.periodStart`/`.periodEnd` times at Unix-epoch duration
multiples. Midperiod install/reset arms the next boundary. Reopen preserves
a legacy offset until then; a full-period delay selects the latest interval.

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

`_timers` enqueues deadlines, reschedules changed values, cancels null/delete;
writers certify `engineWrites: ["_timers"]`. Target, settlement and ledger commit
together; jobs only enqueue. Identity is `(schedule,row_id,at)` or
`(schedule,period_start)`. Queued/running jobs coalesce. Mutations must be idempotent.

Periods re-arm; outages select the latest missed interval and record `skipped`.
Rejected rows settle; retry by changing the deadline. Same-value/unrelated
writes never re-arm. False `if` settles silently; past deadlines fire next turn.
Targets require `--as system` (`E_OPERATOR_REQUIRED`).

At most 64 timers fire per turn; chunks use that pinned clock after none remain
due (`guide job`).

Use journey `tick(ms)` or `POST /control/clock`; inspect `/control/timers`,
`trace timer:<id>`, `logs`, `dev --status` and test receipts.

`E_SCHEDULE_COLUMN`: use `time ?`. `E_SCHEDULE_TARGET`: local mutation/job,
typed arguments. `E_SCHEDULE_DURATION`: `Nm|Nh|Nd`, at least one minute;
no calendar/time-of-day syntax.

## Digest data obligations

The two-minute fixture admits 500 follows and 1,000 memberships per recipient,
50 members per chat. Excess writes refuse. At emission it reads recipient/period
message and chat counts, then recounts 500 current follows; it never scans
memberships or accumulates stale partial totals.

`periodUnread` keys message/recipient and carries immutable author, chat,
membership id and source period. `periodChats` keys recipient/chat/membership/
period; its explicit `total` increments/decrements with each unread insert/delete,
and zero deletes the chat. Count maintains on these two tables supply digest
totals. Send/read/unsend/expiry/leave/admin removal pair cleanup atomically,
including pruning in the later chunk of the same cutoff-bound job. Rejoin
starts empty. Deny unpaired writers; conversation deletion needs its own job.

Clique's source rows stay recipient/author/admin-readable. Its chat total is
current-member-readable, like existing unreadCounts: this also discloses the
period split. Recipient totals stay owner-only. Former members and outsiders
cannot read chat totals.

Receipt, log and effect share one chunk; zero activity is silent and scratch
is deleted before commit. Guard replay at source admission and sweep; post
deletes decrement only replay-eligible counters. Match period to schedule.
Expiry is exact only after successful synchronous timer cleanup (`guide job`).
