# Fork app-binding diagnostics were absent from the production inventory

**Status:** Resolved
**Opened:** 2026-08-06
**Resolved:** 2026-08-06
**Systems:** Server diagnostics, instance forks, local proof
**Related:** LLP 0158

The keep-going Rust suite reported two failures. On isolated rerun, the admin
coverage-activation test passed; the remaining reproducible failure was
`server::tests::s5_d10_production_diagnostic_inventory_cannot_drift`, which
found three production-emitted fork invariants absent from the reviewed
inventory:

- `SNAPBACK_FORK_APP_BINDING_MISMATCH`
- `SNAPBACK_FORK_APP_BINDING_REQUIRED`
- `SNAPBACK_FORK_WRITER_COVERAGE_GAP`

## Resolution

All three codes are now classified in the server's production diagnostic
inventory alongside the other LLP 0158 custody/publication/recovery
invariants. They remain fail-safe server/control-plane diagnostics rather than
being mislabeled as caller 4xx conditions.

Verification:
`server::tests::s5_d10_production_diagnostic_inventory_cannot_drift` passed,
and the previously reported admin coverage-activation test also passed during
the full Rust run.
