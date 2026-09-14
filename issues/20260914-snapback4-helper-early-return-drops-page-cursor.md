# Snapback 4: a helper with an early `return`, called in a page's shape, drops the page's `next` cursor

Status: Open
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

## Acceptance

- The reproduction above returns a cursor for `withEarly`, on the server and
  on both device stores.
- A test covers an early return in a `for`, in an `if`/`else if`, and in a
  helper nested inside another helper, all inside a page's shape.
- Following the cursor pages through every row without duplicates.
- A page whose continuation is lost for any reason never reads
  `complete: true`.
