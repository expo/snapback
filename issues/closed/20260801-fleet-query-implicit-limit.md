# Fleet bakeoff: implicit query prefix was mistaken for mutation loss

**Status:** Resolved
**Impact:** 5
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Severity:** P1
**Systems:** JS queries, Query completeness, Mutations, Testing
**Date:** 2026-08-01
**Resolved:** 2026-08-01
**Governing:** LLP 0003, LLP 0004

## Report

The Fleet Observatory bakeoff reported that one JavaScript mutation returned
`result: 1000` but a later query saw none of the expected updated rows. The
retained report suspected a mutation-settlement failure.

## Root cause

The transaction was correct. An exact 250,000-event reproduction on the
current `origin/main` binary returned a confirmed mutation at version 310 with
`changed_count: 1000`; all 1,000 patches committed.

The observing query used `collect()`, then sorted the returned rows in
JavaScript and sliced the first 100. `collect()` supplied the portable implicit
prefix of 1,024 matching rows. At this fixture size the actual global-tail rows
the burst patched were outside that prefix. The smaller 10,000-event witness,
whose critical subset fit within the cap, observed all 100 expected updates.

## Resolution

An implicit `ctx.db.query(...).collect()` now fails closed with
`SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED` when its result reaches the 1,024-row
ceiling. Authors who intend a bounded prefix must put its ordering and filters
in the query builder and call `.take(n)` explicitly. The guide and LLP 0004
record that completeness contract, and a regression pins both the refusal and
the correctly ordered explicit prefix.

The bakeoff's Fleet handler should be repaired as:

```js
await ctx.db.query('events')
  .withIndex('by_fleet_severity_page')
  .eq('fleetKey', args.fleetKey)
  .eq('severity', args.severity)
  .order('pageKey', 'desc')
  .take(100)
  .collect();
```

No timeout, batch-size, transaction, or live-delivery behavior was weakened.
