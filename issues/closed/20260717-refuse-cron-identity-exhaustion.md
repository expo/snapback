# Refuse cron scheduler identity exhaustion

**Status:** Closed
**Severity:** P2
**Systems:** Cron scheduler, Durable scheduler state, Action ownership
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0028 §Local scheduler semantics
**Marker:** overflow, aba, cron, generation, run-id, durability

The local scheduler calls `wrapping_add` for definition generations and uses
unchecked `+= 1` for its durable run sequence. LLP 0028 depends on the former
being monotonic so a predecessor action cannot publish into an A → B → A
definition lineage, while the latter is part of each run's ownership identity.
Debug builds can panic at exhaustion and release builds can reuse either
identity. The failure counter also uses unchecked increment even though it is
diagnostic rather than identity-bearing.

**Done when:**

- Definition generation and run-id sequence allocation are checked before
  mutating scheduler ownership or consuming a nominal slot.
- Exhaustion returns stable typed diagnostics and leaves predecessor state
  unchanged; no duplicate run id, claim, or generation is emitted.
- Failure-count telemetry saturates or reports exhaustion without panicking.
- Persisted/admin-visible counter values remain in the repository's declared
  portable numeric domain.
- Deterministic maximum-value tests cover reconcile, scheduled/manual/skipped
  claims, and completion accounting.
- LLP 0028 and focused cron tests pass.

## Resolution

The local scheduler now bounds definition generations, run sequences, and
consecutive-failure telemetry to `Number.MAX_SAFE_INTEGER`. Definition
reconciliation allocates the terminal generation exactly once and retains an
inert predecessor on exhaustion; scheduled batches stage all nominal,
ownership, and skipped-ledger changes before publication; manual claims
preflight every needed identity before creating state. Exhaustion emits
`SNAPBACK_CRON_DEFINITION_GENERATION_EXHAUSTED` or
`SNAPBACK_CRON_RUN_SEQUENCE_EXHAUSTED` without reuse.

Durable load and serialization reject non-portable identity/telemetry counters
with `SNAPBACK_CRON_STATE_INVALID`, and the admin schema declares the same
maximum for `consecutiveFailures`. LLP 0028 records the terminal identity
contract.

Verification on 2026-07-17:

- `cargo check --lib` — passed (two existing dead-code warnings).
- `cargo test --lib cron::tests:: -- --nocapture` — 38 passed.
- `cargo test --lib s5_d10_all_emitted_diagnostics_have_reviewed_http_status -- --nocapture` — passed.
- `cargo test --lib s5_d10_production_diagnostic_inventory_cannot_drift -- --nocapture` — passed.
- `cargo run --bin snapback-schemagen` — regenerated schemas; cron
  `consecutiveFailures` carries maximum `9007199254740991`.
- `./ref-check --verbose` — 0 errors, 0 unchecked.
