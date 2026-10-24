# Snapback 4 RCPU follow-ups: CPU sampler completeness and payload-guard aggregation

**Status:** Open
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
