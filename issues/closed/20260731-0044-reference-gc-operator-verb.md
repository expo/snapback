# No operator verb drives the asset GC sweep deterministically

**Status:** CLOSED — 2026-08-01

Reference GC's product moment — “the deleted post's photo goes away a minute
later” — could not be demonstrated deterministically because hermetic suites
disable the background runner and no operator operation drove
`asset_gc_sweep(now)` on demand.

## Resolution

The admin-gated `asset.gcSweep` host operation and
`snapback assets gc-sweep --now-ms <unix-ms>` CLI command now drive the one
canonical sweep with an explicit portable millisecond clock. The response
echoes `nowMs` and returns the complete camel-cased GC report. Host operations
do not retain a response replay ledger; the underlying sweep is fenced and
idempotent, and every semantic reclamation writes the existing canonical
asset lifecycle receipt exactly once.

Party Wall's headless acceptance now deletes the photo-bearing post, drives
the sweep beyond its declared 61-second grace, asserts one reference
reclamation, and proves the bytes stop serving.

Evidence: `asset_gc_sweep_host_op_uses_injected_clock_and_receipts_reclamation`,
`asset_gc_sweep_host_operation_is_admin_gated_and_clock_explicit`,
`asset_gc_sweep_cli_requires_and_preserves_the_injected_clock`, the route
registry exhaustiveness test, `node scripts/check-guide.mjs`, and
`./ref-check --verbose`.
