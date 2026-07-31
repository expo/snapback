# Kit configured/prebuilt rungs skip handler-VM qualification

**Status:** Resolved (2026-07-31)
**Date:** 2026-07-30
**Systems:** demo harness, runtime readiness
**Governing:** LLP 0010, LLP 0030

## Problem

The bootstrap smoke now certifies armed handler-VM readiness
(`snapback runtime-qualify`, `SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED` — see
issues/closed/20260730-bootstrap-smoke-does-not-create-armed-handler-vm.md),
but `demos/_kit/server-process.mjs` still admits its `configured` and
`prebuilt` ladder rungs on presence plus `/health` identity alone, and the
`reused` rung necessarily trusts a running process. A stale
framework/binary pairing selected through those rungs still surfaces only as
`SNAPBACK_RUNTIME_CREATE_FAILED` at the first JS invocation of an
acceptance suite.

## Direction

Run `qualifyRuntimeBinary` (`packages/snapback-cli/runtime-recovery.mjs`)
against the resolved binary before certifying the `configured` and
`prebuilt` rungs: a prebuilt qualification failure falls back to the `cargo`
rung with the reason recorded; a configured failure is a hard coded error
carrying the qualification verdict in its runtime-recovery record. The kit's
fixture launchers (`deps.launchSpec` and the lifecycle tests' stand-in
binaries) need a seam or fixture support for `runtime-qualify` before this
can land without breaking `demos/_kit/tests/server-process-lifecycle.mjs`.
The `reused` rung stays `/health`-based by design — a running server cannot
be re-qualified from outside — and should say so in its recovery record.

## Resolution (2026-07-31, LLP 0115 CV-3 landing)

Executed as directed, with the receipt as the shared artifact rather than a
per-rung qualification run. `demos/_kit/server-process.mjs` now certifies
the `configured` and `prebuilt` rungs against the persisted
`snapback.runtime-readiness.v1` receipt
(`packages/snapback-cli/runtime-readiness.mjs`): an absent/stale/incoherent
receipt self-heals by running `qualifyRuntimeBinary` against the exact
resolved binary and reissuing; a binary that cannot qualify fails with
`SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED` — the prebuilt failure falls back
to the `cargo` rung with the reason recorded, the configured failure is a
hard coded error carrying the qualification verdict in its runtime-recovery
record. The `cargo` rung's exact-link probe issues the receipt for the
binary it builds. The `reused` rung goes beyond the sketch: reuse now
requires binding the live `/health` identity to a locally receipted,
digest-coherent runtime (a running process cannot be re-qualified in place,
and the reused handle's recovery record says so); otherwise reuse is
refused and a fresh receipt-gated server starts. The fixture seam landed as
predicted: the lifecycle suite's stand-in binary answers `runtime-qualify`
with the real verdict document, and `deps.verifyReadiness` /
`deps.issueReadiness` / `deps.qualifyRuntime` are the injectable seam
(fixture launchers without explicit injection keep a disabled seam,
mirroring the probe rule). Coverage:
`demos/_kit/tests/server-process-lifecycle.mjs` (fallback, self-heal,
configured hard error, unpersistable-receipt refusal, reuse
refusal/bind/identity-mismatch).
