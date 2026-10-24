# Snapback 4 RCPU follow-ups: CPU sampler completeness and payload-guard aggregation

**Status:** Closed
**Opened:** 2026-10-24
**Area:** `snapback4/experiments/scale-controls/src/load.rs`; `engine/postgres/read_closure.rs`
**Related:** `snapback4/reports/20261024-rcpu/REPORT.md`; LLP 3000.009.001.000.002 reads

Both from the blind RCPU review (`c7a0a597ee..3bce649288`); no product
correctness defect was found.

1. **Sampler completeness (Sol, P2).** `load.rs` (~410) `filter_map`s away
   failed `/proc` directory/stat reads and still emits a numeric family total
   (~424). A PG backend that exits between the master's sample and its own
   stat read is missing from both the master's reaped-child counter and the
   live sum, so CPU/read and derived ceilings can be understated with no
   invalid-sample flag. Propagate inspection failures (mark the sample
   invalid) or retry; add a witness for a failed member read. Must be fixed
   before the final S1 report quotes CPU per read.
2. **Payload guard aggregation (Grok, Low).** `read_closure.rs` (~502) now
   always `array_agg`s nodes/keys/images/row keys; the outer
   `CASE WHEN ready` (~505-507) only nulls them on output. A legal composed
   scan over 128 KiB (under the 4 MiB planner cap) materializes every image
   before falling back, and repeats per request from the cached statement.
   Restore evaluation inside the `CASE` branch (or an equivalent early cut)
   with a witness that the over-budget path does not aggregate.


## Resolution — FF2, 2026-10-24

The Linux sampler propagates `/proc` enumeration, directory-entry and numeric
PID stat/decode failures. An unreadable PID cannot be proven unrelated, so it
conservatively invalidates the whole family snapshot (`tree: null`, no numeric
family total); the enclosing sample explicitly emits `valid: false`. Valid
samples retain both live and reaped-child CPU accounting.

The composed-read guard computes readiness alone. Each array aggregate now
lives in a subquery inside the ready CASE branch, preventing speculative array
materialization on rejected payloads. This does not remove the bounded source
facts needed to evaluate readiness or change fallback policy.

Failing-before: `family_member_stat_failure_invalidates_the_sample` fails 0/1
on a vanished member silently producing a partial total. The same fixture also
covers malformed stats and enumeration failure. The exact production SQL's
`payload_guard_never_executes_over_budget_array_aggregates` fails 0/1:
EXPLAIN ANALYZE reports aggregate Actual Loops=1 where 0 is required. The fixed
witness checks all array aggregates for admitted, over-budget and unavailable
facts, along with null/non-null output parity. No throughput measurements ran.
