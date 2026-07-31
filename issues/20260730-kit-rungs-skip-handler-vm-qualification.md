# Kit configured/prebuilt rungs skip handler-VM qualification

**Status:** Open
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
