# Coalescing measurement spike against the persistent hot-diagnosis baseline (LLP 0191 OQ4, ruled)

**Opened:** 2026-08-08 · **Priority:** immediate (days-scale; unblocks D2/D4 Spec drafting) · **Ruling:** LLP 0191 "Author rulings" #4, Charlie Cheever 2026-08-08

Measurement spike only — no landing, per LLP 0189. Instrument:
`demos/zerobugs/control/scripts/diag-hot-stream.mts` against the persistent
baseline in `demos/zerobugs/fixtures-local/hot-diag-baseline/`.

## Predeclared axes (LLP 0191 §1 + OQ4; both review families signed)

- **Arrival discipline:** the existing open-loop fixed-offset bursts
  (16 × 25 ms), plus a settle-gated arm and a sustained-write arm as new
  arms.
- **Frame-kind accounting per instrument** — resolves the declared-open
  521-vs-12 discrepancy between `zb5-hot.v10` custody deliveries and the
  diag traces at the source.
- **Matcher counters:** match / skip / conservative-fallback decisions per
  mutation × subscription; compare against predeclared expected relevance
  (the receipt's 8-trigger/8-non-trigger inventory partition).
- **Evaluation counters:** queue / start / finish / cancel, frame bytes.
- **Settlement decomposition:** commit-ack vs mutation settlement vs
  observer convergence timed separately (the settlement-isolation
  question: non-trigger mutations also settled slowly in v10).
- **Observer matrix:** zero / one / six observers; same and different
  authority partitions.

Hypothesis under test (not an estimate): coalescing turns the 72.8 s
median settle into single-digit seconds. A successful spike sizes rung 1
for the D4 Spec; it does not become the de facto design.

Parent evidence ticket: `20260808-live-query-reevaluation-cost-at-scale.md`.

**Dated note (2026-08-08, ticket-sweep landing):** the sweep concurrently
landed a production rung-1 coalescing lane (LLP 0008 §"Dated decision —
post-commit fan-out coalescing (2026-08-08)"; `src/live_coalesce.rs`,
dispatch in `src/local.rs`, backstop in `src/server.rs`). The spike
therefore has a real implementation to measure instead of a prototype:
run the coalescing arm on the landed lane and the control arm with
`SNAPBACK_LIVE_COALESCE_DISABLED=1`. The spike's no-landing rule is
unaffected — its job is now to size the landed lane at 5.5M rows on the
predeclared axes (and the lane's `LiveCoalesceStats` counters partially
cover the evaluation-counter axis: deferred/coalesced/backstop
flush counts are exposed via `LocalSnapback::live_coalesce_stats`, not
yet on the inspect surface).
