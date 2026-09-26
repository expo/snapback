# snapback4: live aggregate recounts scan outside the request allowance

**Status:** Open · **Filed:** 2026-09-25 · **Systems:** `snapback4-core/src/engine/live_aggregate.rs` (`live_aggregate_inner`) · **Source:** merge review of the LLP 3000.015 landing (Grok, 2026-09-25)

## What

`live_aggregate_inner` scans its expiring source group with `metered_scan` and charges examined units for rows it then skips (expired, unselected, unauthorized). LLP 3000.015 §2, as merged, says recounts draw from the request allowance; that is true of the row-keyed path (`disclosed_scratch`) and not of this one. The walk stops at the examined ceiling (default 8,192), so no logical receipt changes with a hidden population under the default ceilings; it is a stated-residual gap, not a disclosure.

## Done when

Either the scan takes a fixed internal reservation on the allowance (one constant public charge, as the row-keyed path does), or the §2 sentence is narrowed to the row-keyed path. A test asserts the examined meter of an inherited-aggregate recount is constant across 0 versus 1,200 skipped source rows.
