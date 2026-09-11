# snapback2: Quarry time arithmetic is inconsistent (`0 + now` accepted, `now - at` refused) and day bucketing is not expressible

**Date:** 2026-09-06 · **Area:** Quarry language / guide (guide-gap) · **Source:** Clique full run, astra-snapback2 (run-log line 55, M8 diary) and grok-snapback2 (M1, M8 diary, essay)

## What happened

Both builders needed the same two things for the brief's Insights milestone (seven UTC day
buckets) and edit/delete windows, and found the time rules inconsistent:

- `now <= msg.at + N` certifies (grok M4), but `now - at <= ms` is refused as nominal time (grok M1/M8).
- `divmod(now, …)` is refused, or "returns a quotient object" that cannot be used as a bucket key
  (astra M8, grok M8). grok shipped seven-day insight bars as "today plus zeros" because there was
  no way to derive a day bucket from a time.
- `0 + now` is **accepted** and yields a numeric epoch (astra M8), which is a coercion loophole
  around the nominal-time rule that the feature docs never mention. The builder called this
  "not obvious from the feature-level docs".

So the language says time is nominal, then admits arithmetic through a side door, and gives the
author no blessed way to do the one thing every app with a chart needs.

## Proposed

1. Decide the rule: either time supports a small blessed set of operations (difference in ms,
   truncation to a UTC day/hour bucket, comparison with an offset) or it is nominal and `0 + now`
   is refused too. Do not leave both.
2. Document the rule on the Quarry guide's grammar page with the accepted and refused forms side
   by side.
3. If day bucketing is added, the Insights shape in the Clique brief (seven day buckets maintained
   by the server) is the regression fixture.

## Partly addressed (2026-09-06, Clique findings program)

wave 1 L2 typed `time − time` and the time rules on the grammar page (main 0f5e6d27a); L9's `divmod(time, int)` yields int so a UTC day bucket is `divmod(now, 86400000).quotient` (main, pending L9 landing). Open: whether `0 + now` should refuse; the side-by-side accepted/refused table on the grammar page.

## 2026-09-11 triage and resolution

**Priority:** P2. **Disposition:** Closed; time arithmetic has one implemented
typed rule and the packaged grammar documents it.

Commit `284cb0a25` plus review fix `7da7e0f6a` established: `time - time`
returns int milliseconds; `time +/- int` and `int + time` return time;
`divmod(time, int)` returns integer quotient/remainder; all other time
arithmetic refuses. Thus `0 + now` is deliberately a time offset expression,
not the old numeric coercion: `divmod(10, 0 + now)` now refuses because its
divisor is time. Packaged `guide grammar` states the accepted and refused rule
and the epoch-bucketing form.

**Verification:** the 2026-09-11 compiler suite passed `Quarry time difference
and epoch divmod have integer parts`, `Quarry time arithmetic refuses undefined
and absent operands with the rule`, and `Quarry divmod tuple binds once and
preserves decimal and money parts`. The ticket's consistency, day bucketing,
and documentation acceptance is satisfied.
