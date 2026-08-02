# D-05: Fingerprint seams, error_groups, issue state machine (LLP 0156 checklist 1–2)

**Status:** Open — gated on LLP 0156 Status: Accepted AND obs-01/obs-02
landed (the CE1 substrate seam)
**Program:** 20260802-obs-00-program.md
**Systems:** Error tracking, Observability, Runtime

Implement LLP 0156 §Deliverables checklist (Phase E1) items 1–2 exactly:

- Fingerprint computation at the refusal-rendering and
  `render_async_failure` seams; stack capture in `render_async_failure`
  (decode what's already returned, cap at the 16 KiB safe-text bound,
  thread into the terminal row's `details`); message-template normalizer
  with fixtures (digit/hex/quote stripping, idempotence, cap behavior).
- `error_groups` + visible view in `telemetry.rs`'s store; flusher upsert +
  state machine + exemplar ring in the flush transaction; group-cap fold
  (CE4) and last-seen-horizon sweep in flush-path maintenance; the `iss_`
  Issue row in the LLP 0148 registry — with OQ-A2's conformance answer
  obtained first.

Design authority: 0156 §E1.1–E1.3. Grouping keys on stable codes
(SNAPBACK_* + LLP 0144 declared refusal unions) before any message
normalization; stack-based fingerprints are rejected until symbolication —
do not add them.

**Exit:** groups form/fold/sweep under the flush-transaction atomicity the
fixture gates in obs-06 will prove; registry row landed.
