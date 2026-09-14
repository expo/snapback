# Snapback 4: a helper with an early `return`, called in a page's shape, drops the page's `next` cursor

Status: Closed (2026-09-14)
Priority: P1
Date: 2026-09-14
Systems: Quarry helpers (`fn`, inlined per call), shapes, page cursors, completeness
Observed version: published `snapback4@0.2.12` (`a5ef8da61`)
Evidence status: builder observation in the 0.2.12 Astra calibration plus a minimal CLI reproduction by the catch-up lead

## Problem

A page projected through a shape that calls a helper whose body returns
early (a `return` inside a `for` or an `if`) comes back with `next: null` and
`complete: true` when more rows exist. The same page projected through an
equivalent helper that accumulates state and returns once keeps its cursor.
Paging stops silently: no diagnostic appears, and the completeness word
certifies a truncated page. Every row in the returned page is correct; only
the continuation is lost.

## Evidence

The 0.2.12 Astra Clique calibration
(`~/clique-sb4-20260914-astra-0.2.11/lanes/astra-snapback4/`) hit this in
M8. A 10,000-message group history, `messages[conversationId] after c last 50
by byConversationOrdinal messageCard`, whose shape calls `receipt(.)`,
returned 50 rows, `complete: true` and `next: null`. The same page without
the helper returned a cursor (`evidence/paging-diagnostic.json` and
`paging-diagnostic-console.txt`). Rewriting the helper to accumulate `state`
restored full paging: 10,000 messages in 200 pages without duplicates
(`paging-diagnostic-fixed-console.txt`). Run-log epochs 1789412141 (first
logged `ambiguous`) and 1789412421 (`snapback4-defect`). The builder's diary:
"The missing diagnostic was a warning that a helper could alter a caller's
continuation."

Minimal reproduction on the 0.2.12 binary, `snapback4 dev`, 12 seeded rows:

```quarry
use personas alice

table items:
  n: int
  flags: [text <=10] <=5
  by byN: n, id
  read <- allow
  insert <- allow

fn early(i: items):
  for f in i.flags:
    if f = 'x':
      return 'hit'
  return 'miss'

fn accumulated(i: items):
  state = 'miss'
  for f in i.flags:
    if f = 'x':
      state = 'hit'
  return state

query withEarly(c: cursor ?):
  return items[] after c last 5 by byN { id, n, mark: early(.) }

query withAccumulated(c: cursor ?):
  return items[] after c last 5 by byN { id, n, mark: accumulated(.) }

query plain(c: cursor ?):
  return items[] after c last 5 by byN { id, n }
```

```text
plain            rows 5 complete True next True
withAccumulated  rows 5 complete True next True   marks hit, miss, hit, miss, hit
withEarly        rows 5 complete True next False  marks hit, miss, hit, miss, hit
```

## Suspected mechanism (unverified)

Helpers are inlined per call (LLP 3000.007 §18.5, lane CU5). An early
`return` in the inlined body probably lowers to control flow that exits or
resets the enclosing page's position bookkeeping (`pages` / `page_depth` /
`opaque_cursor` in `crates/snapback4-core/src/engine/read.rs`) before the
outer page records its `PagePosition`. Verify before fixing.

## Lead's reading of the runtime (2026-09-14, unverified)

`crates/snapback4-core/src/engine/runner.rs`, `Stmt::Return` (around line
276 at `d54786859`), does
`self.page = self.page_plan.get(&site).and_then(|owner| self.pages.get(owner)).cloned();`
before yielding. An inlined helper's `return` inside a shape would set the
runner's page from the plan of the helper's return site, which owns no page,
and overwrite the outer page's position with `None`. That fits
`next: null`. Lane N2 (LLP 3000.007 §19.2) verifies this first.

## Acceptance

- The reproduction above returns a cursor for `withEarly`, on the server and
  on both device stores.
- A test covers an early return in a `for`, in an `if`/`else if`, and in a
  helper nested inside another helper, all inside a page's shape.
- Following the cursor pages through every row without duplicates.
- A page whose continuation is lost for any reason never reads
  `complete: true`.

## Resolution (lane N2, 2026-09-14)

Reproduced against base `ce15819ad71bd24c9d1b9ec228c083330dee3a31`
with the compiled Quarry on the server, SQLite device and memory device.
The initial regression run reported server **3 passed, 5 failed** and
device **6 passed, 10 failed**. Plain, accumulated and pure `if`/`else if`
helpers passed; the returning loop, nested helper, merge and matching
shapes lost `next`, and the completeness safeguard assertion failed.
The expanded final fixture was rerun against the same base: server
**3 passed, 7 failed**, device **6 passed, 14 failed**, then restored to
the intended core sources byte-for-byte.

The suspected runtime return was not the mechanism. In
`snapback4/crates/snapback4-lang/src/bind/program/control.rs:465`,
`helper_returns` already replaces the helper's `Return` with assignments
to its result and done flag. At line 474 it appends a conditional `Break`
to the helper's loop. The page analysis in
`snapback4/crates/snapback4-core/src/engine/pages.rs:159` recursively
counted that nested `Break` as an exit from the outer shape collector.
Consequently `origins` could not prove one output per page row and omitted
the query return's page owner. The actual query-level `Stmt::Return` in
`engine/runner.rs:279` then found no owner and selected `None`; no helper
return ran that arm. The scan's `PagePosition` remained in `pages`.

The analysis now distinguishes an outer collector exit from a nested
loop's `Break` or `Continue`. A real program `Return` still exits through
all loop levels. Helper expansion, runtime control flow, page depth,
serialized IR and values are unchanged. `engine/read.rs:646` centralizes
the page completeness safeguard used by both query hosts, including
native reads and retained-history fallback classification: without an
owned page, a scan that filled or had a continuation cannot read complete.
`PagePosition.filled` is private runtime bookkeeping. It also covers a
full five-row final scan whose collector returned just one row, for which
lookahead correctly produced no continuation. An owned final page remains
complete even when an auxiliary scan continues.
Native scans retain their existing completeness class: their continuation
travels in the scan response itself (`engine/native.rs:418`), not through
Quarry's returned-page ownership plan.

Regressions live in the simulator and device `tests/helper_pages.rs`,
sharing the fixture at `snapback4-sim/tests/common/helper_pages.rs`:
`early_return_in_for_keeps_page`, `early_return_in_if_else_if_keeps_page`,
`nested_returning_helper_keeps_page`, `returning_helper_keeps_merge_page`,
`returning_helper_keeps_matching_page`,
`auxiliary_scan_does_not_reclassify_the_final_page`,
`lost_continuation_is_incomplete`, and the program-return controls, beside
the ticket's `plain` and `withAccumulated` positive controls. Device cases
run separately on SQLite and memory. Final targeted results: server
**10 passed, 0 failed**, device **20 passed, 0 failed**. Every paged case
returns **12 distinct rows in 3 pages (5, 5, 2)**, **0 duplicates**, **0
gaps**. The merge draws from two populated lanes. The lost-position test
also uses exactly five stored rows. Mutations have no `next` field, so
the conditional mutation-continuation requirement does not apply.
