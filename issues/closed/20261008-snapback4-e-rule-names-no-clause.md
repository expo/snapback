# Snapback 4: E_RULE lists four causes and no clause; `check` does not flag unreachable mutation writes

Status: Closed 2026-10-08 (lane S1; LLP 3000.036 §3 B, C and D)
Date: 2026-10-08
Scope: Snapback 4 core rules refusal text (`snapback4-core` E_RULE) and a `check` note (`snapback4-lang`)
Reproduced: partly, on main cd2fa88d8b and 0.4.14 (same text)

## Evidence

App-farm round 1 cluster 4 (S-ERULE): 8 builds (GPT 1, Muse 7), 9 diaries,
worst severity major. remodel-change-orders-0084 lost 8 min: `submitOrder`
failed E_RULE because the table had `update <- deny`, and "the message lists
five possible causes; nothing says your mutation's own update goes through the
table update rule". late-bus-alerts-0243 (5 min) asked for a `check` note when
a mutation writes a table whose rule no caller can pass. driveway-route-0189,
flashcard-duel-0225, bag-valet-0540 hit the same shape.

## Repro

```quarry
use personas alice
table orders:
  title: text <=80
  author: principal
  submitted: bool default false
  read <- .author = viewer
  insert <- .author = viewer
  update <- deny
  cap 100 by author
table alerts:
  body: text <=80
  read <- allow
  insert <- deny
mutation create(title: text <=80):
  return insert orders { title, author: viewer }
mutation submit(o: orders):
  update orders[o] { submitted: true }
mutation alert(body: text <=80):
  insert alerts { body }
```

`snapback4 check` → `check: ok`, no note. Then:

```
$ snapback4 run submit '{"o":"<id from create>"}'
failed E_RULE: orders's update rule does not admit this viewer, or a sequence insert requires read authority independent of its ordinal, or a unique key or cap group contains a row you cannot read, or authorization cannot be established within its physical work allowance; to write into another principal's row use `upsert` under an `update` rule, or let a `maintain` keep the count
```

Over the wire the refusal has no `site` or `rule`. The table and verb are now
named ("orders's update rule"), which the synthesis said was missing; the
failing clause (`update <- deny`, schema.q:9) and the mutation's write site are
not, and three of the four listed causes cannot apply here.

## Suggested fix (lead session)

- E_RULE: when the table rule itself evaluated false, say so first and name it
  with its site ("orders: `update <- deny` (schema.q:9) refuses every caller;
  the write at schema.q:21 in `submit` runs as the caller"), listing the other
  causes only when they were the ones checked.
- `check`: a note (or error) when a declared mutation writes a table whose
  matching rule is `deny` or can never admit a non-system caller — "this write
  is unreachable for every caller; jobs run as the system".
- `guide writes`: one sentence that mutation writes still pass the table's
  insert/update/delete rule.

## Resolution

Closed 2026-10-08 by app-farm lane S1, as LLP 3000.036 §3 recommends (B, C
and D; not A as written). The wire refusal is unchanged: naming the clause
only when the rule itself evaluated false would make its absence an existence
oracle.

- `snapback4 run`, locally and when forwarded to a live dev, prints the dev
  refusal trace under the refusal on stderr:
  ``dev: orders refused it: `update <- deny` (schema.q:9:3), at submit:2 — …``,
  with "a mutation's writes pass the table's insert, update and delete rules
  as the caller; only a job runs as the system". The dev console already
  printed the clause.
- `check` notes `N_WRITE_DENIED` for each mutation write effect, and each
  upsert arm, whose rule is `deny` or omitted (jobs, receipt recipe
  operations and owned-field-only patches exempt).
- `guide rules` says that a mutation's writes pass the table's rules as the
  caller.

