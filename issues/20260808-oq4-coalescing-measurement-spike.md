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
