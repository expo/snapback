# Snapback 4: a backward clock (or schedule-shape change) double-fires a period

Status: Closed
Priority: P2
Date: 2026-09-13
Systems: `fire_schedules`
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)
Related: NOT-DOING (missed periods fire once on return — forward skip is correct)

## Problem and reproduction

Skip is `if last == Some(boundary)`. Missed-forward is correct (probe: `12m` then `20m` every 2m → one extra job, not five). Clock going **back** from 12m to 10m+1: `boundary=10m`, `last=12m`, not equal → fires again.

The same comparison fails if `every_ms` / `offset_ms` changes on adopt: the meta value is a raw timestamp that may not equal any new boundary, so the schedule fires immediately.

## Implementation locations

- [snapback4/crates/snapback4-core/src/engine/job.rs](../../snapback4/crates/snapback4-core/src/engine/job.rs) (`fire_schedules`)

## Suggestion

Treat `last >= boundary` as “already fired for this period”. On a schedule-shape change, reset meta to first-seen rather than compare incomparable timestamps.

## Resolution — 2026-09-13

The stored boundary is a high-water mark: backward time and revisiting an already-fired boundary do nothing. Schedule period/offset/target shape changes initialize at the next boundary. The regression checks rewind, re-forward and a changed 2m→5m shape.

Integrated implementation: `4b70bdb6f` and `3d2007794`, plus the HTTP/device follow-ups where applicable. Focused core, simulator and host regressions passed. Full integrated suite and scoped blind review are recorded in the append-only Snapback4 journal before publication.
