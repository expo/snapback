# Totals: count and sum in queries, mutations, jobs and views

Count rows or add up a column with `count` and `sum` inside a query, mutation or job. A view keeps a total per group current on every write, so reading it costs one row.

```quarry
table orders:
  owner: principal
  status: text <=10
  cents: int
  at: time default now
  immutable owner, at
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- deny
  delete <- deny
  online only
view spentByOwner: sum orders of .cents by .owner
  online only
view spentPerDay: sum orders of .cents by .owner, day(.at)
  online only

query myTotals(since: time):
  open = count(orders where .owner = viewer and .status = 'open')
  recent = sum(orders where .owner = viewer and .at >= since, .cents)
  return { open, recent, lifetime: spentByOwner[viewer], today: spentPerDay[viewer, day(now)], yesterday: spentPerDay[viewer, day(now) - 1] }
```

There are two spellings, and they do not mix:

- **Inside an operation** (query, mutation, job): `count(t where …)` and
  `sum(t where …, .col)`. The parentheses are required; the column is the
  second argument, written `.col`. `min` and `max` take the same arguments.
- **In a view** (declared at top level): `view name: count t by .key` or
  `view name: sum t of .col by .key`, optionally `where …` before `by`
  (`sum t of .col where … by .key`, in that order). Read
  it by its group key, `spentByOwner[viewer]`; a group with no rows reads `0`.
  A view over an `online only` table is read online; its own `online only`
  line is optional.

## In a job

A job's totals are ordinary domain reads inside its sweep; write them where a
screen can read them:

```quarry
table readings:
  owner: principal
  value: int
  at: time default now
  immutable owner, at
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- deny
  delete <- deny
  online only
table sensors:
  owner: principal
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- deny
  delete <- deny
  online only
table dailyStats:
  owner: principal
  day: time
  n: int
  total: int
  read <- .owner = viewer
  insert <- deny
  update <- deny
  delete <- deny
  online only

job dailyTotals(periodStart: time, periodEnd: time):
  for s in sensors by .id:
    n = count(readings where .owner = s.owner and .at >= periodStart and .at < periodEnd)
    total = sum(readings where .owner = s.owner and .at >= periodStart and .at < periodEnd, .value)
    insert dailyStats { owner: s.owner, day: periodStart, n, total }
schedule nightly every 1d at 00:05: dailyTotals
```

`periodStart` and `periodEnd` are the schedule's period, so each run totals
one day. When the job only needs a number a screen shows, a view is usually
simpler than a job: `view perDay: sum readings of .value by .owner, day(.at)`
read as `perDay[viewer, day(now)]`.

## Rows the caller partly reads

An inline total counts only what its caller may read, so `check` refuses one
whose read rule its pins do not decide (`E_QUARRY_BOUND`, or
`E_STRUCTURAL_FANOUT` in a mutation): it would be a different number for
each caller, and a capacity check would miss hidden rows. Three exact forms:
pin the deciding column (`.owner = viewer`: the caller's own total); or keep
the total in a view whose read rule names who sees it (the view discloses the
total, never the rows); or, in a mutation, `require` below a view's count.

```quarry
table staff:
  principal: principal
  role: text <=20
  unique principal
  read <- .principal = viewer
  online only
table requests:
  owner: principal
  dept: text <=20
  amount: money USD
  read <- .owner = viewer or exists staff[principal = viewer, role = 'finance']
  insert <- .owner = viewer
  online only
view requestsTotal: sum requests of .amount by .dept
  read <- exists staff[principal = viewer, role = 'finance']
view requestsByOwner: sum requests of .amount by .owner, .dept
  read <- .owner = viewer

query deptTotal(dept: text <=20):
  return requestsTotal[dept]
query myDeptTotal(dept: text <=20):
  return requestsByOwner[viewer, dept]
```

Finance reads every department's total; each requester reads their own.
`E_QUARRY_BOUND`'s rewrite prints this view for your table, column and group.
A view groups by at least one column (`count requests` alone does not parse):
for a whole-table total, give every row the same key (`totalKey:
enum('all') default 'all'`, `immutable totalKey`), group by it and read
`requestsCount['all']`.
A guard on the read rule's own grant admits an inline total, as it admits a
staff page (`guide indexes`): after `require exists staff[principal = viewer,
role = 'finance'] else …` (or inside `if` on it), `sum(requests, .amount)` is
every row's total, because every caller who reaches it reads every row. A guard
on any other role does not; use the view.

## Choosing

- A total a screen shows on every visit: a view. It is maintained on each
  write and read by key, constant work regardless of history.
- A rolling window (last 7 days): bucket the view by `day(.at)` (or
  `hour(.at)`, `bucket(.at, 15m)`) and add the buckets you need with point
  reads, `perDay[viewer, day(now)] + perDay[viewer, day(now) - 1]`.
- A one-off or filtered total (since an argument, by status): `count(...)` or
  `sum(...)` in the operation. It streams the domain under the meter: each
  row is authorized, filtered, folded and released. Its work grows with the
  matching rows, and `check --cost` says so; bound the predicate by an indexed
  time or a group key.
- `count(page)` and `sum(page, .col)` over a page you already read count only
  that page, not the population.

## Details

A meter cut never yields a partial total: the read is unavailable (the client
shows `loading`), including before `??`. On a device, an inline total needs
the device to hold its whole domain; otherwise the observation stays
`loading`, never a partial total. Sums take `int`, `decimal` or `money` columns; a total
that overflows refuses the transaction. `guide maintains` has every view form
(filters, reference paths, time buckets, offsets and sync); `guide reads`
covers totals beside pages and `exists`; `guide jobs` the sweep a job's totals
live in.

Common misspellings and what `check` says:

- `sum(orders of .cents)` (the view spelling inside an operation):
  `E_QUARRY_UNKNOWN: unknown shape of`. Write `sum(orders where …, .cents)`.
- `count orders where .owner = viewer` without parentheses:
  `E_QUARRY_UNKNOWN: unknown shape where`. Write `count(orders where …)`.
- `sum(orders where …, cents)`: `E_QUARRY_UNKNOWN: unknown name cents`. The
  column is `.cents`.

Reference-grouped views over `read through .parent` rows inherit the parent's
rule. Omit a read line that repeats `.parent.owner = viewer`; it is
`E_REDUNDANT_RULE`, and deleting the whole line preserves the inherited audience.
Maintained sums spell the value separately: `view total: sum expenses of .amount by .household`,
not `sum expenses.amount by .household`.
