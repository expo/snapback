# Snapback 4 R1: readiness and coalescing witnesses do not lock production behaviour

**Status:** Open
**Opened:** 2026-10-25
**Area:** `crates/snapback4/src/serve_start.rs`, `crates/snapback4-core/src/engine/command_batch.rs`, their tests
**Related:** R1 (`Fix Postgres cold reader readiness and compose bounded write flights`); `snapback4/experiments/scale-controls/results-20261025-s1-diagnosis/README.md`

From the blind R1 review (Sol P2 ×2; Grok APPROVE WITH NITS). No correctness
defect was found; both are witness gaps.

1. **Readiness.** `tests/round_trips/mod.rs` (~558) uses a fixture that
   prepares readers itself (`tests/serve_refusals/mod.rs` ~149). Removing
   production preparation at `serve_start.rs` (~196) leaves the witness
   green. Drive the production readiness transition and make that negative
   control fail.
2. **Coalescing.** The tests at `command_batch.rs` (~360) exercise `Arrivals`
   directly; restoring immediate termination on an empty mailbox (~269)
   leaves them unchanged. Add a controlled queue witness where a member
   arriving after the mailbox empties joins the current batch; removing
   coalescing must fail it.
