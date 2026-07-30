# Bootstrap smoke can pass while armed handler VM creation fails

**Status:** Open
**Date:** 2026-07-30
**Systems:** native runtime bootstrap, Ibex/Hermes artifact selection,
runtime readiness, demo harness

## Observed

During the seven-app Snapback/Convex current-main rerun, the checkout and
`target/debug/snapback` both identified revision
`01e941730306973aadaf21cd50b4c1613d171075`. Both paved diagnostics succeeded:

```text
scripts/ibex-doctor
scripts/bootstrap-ibex-runtime
SNAPBACK_IBEX_RUNTIME_LINK_OK
exact link + launch smoke passed with dynamic-loader overrides scrubbed
```

Real app servers then loaded schema/function manifests successfully, but every
Ibex query or mutation failed with:

```text
SNAPBACK_RUNTIME_CREATE_FAILED: Ibex runtime could not be created
```

Running the server with inherited output exposed the native refusal:

```text
Armed startup refused: Hermes promise rejection checkpoint tracking is unavailable
```

Declarative query, live-query, and ephemeral paths continued to work, so this
was specifically an armed JavaScript-handler readiness failure rather than a
server-start or app-provisioning failure.

The ignored Hermes framework was newer than the linked Snapback binary during
one reproduction. Refreshing through the vendored bootstrap/download path and
then performing a subsequent exact relink restored all affected apps. The
important product defect is that the existing doctor/bootstrap success gates
did not distinguish the broken intermediate state from a handler-ready
runtime.

## Why it matters

The bootstrap is the required first step before Snapback builds in a clean
checkout. A successful coded result currently establishes dynamic loading and
process launch, but authors reasonably interpret it as native runtime
readiness. The first useful diagnostic arrives only after an app has generated,
booted, provisioned, and invoked a JS function.

This also makes artifact refresh ordering fragile: a framework can change
after the binary link while both the doctor and launch smoke remain green.

## Resolution criteria

- Extend the paved runtime qualification to create and destroy the same
  no-eval/armed handler VM used by Snapback, including the promise-rejection
  checkpoint prerequisite.
- Fail with a stable `SNAPBACK_*` bootstrap code when the selected Hermes
  artifact and linked Ibex runtime cannot create that VM.
- Include the selected framework digest and binary link/build identity in the
  recovery record so ordering or artifact-coherence failures are diagnosable.
- Ensure a framework refresh invalidates or relinks the final Snapback binary
  before the qualification runs.
- Add an acceptance test reproducing “server launches, handler VM creation
  fails” so `SNAPBACK_IBEX_RUNTIME_LINK_OK` cannot be emitted for that state.
