# runtime_link_smoke_v0 timing windows flake under load

**Opened:** 2026-08-05
**Resolved:** 2026-08-05
**Systems:** Developer experience, Acceptance testing

Three `tests/runtime_link_smoke_v0.mjs` tests ("fake Cargo did not
start" / "SIGTERM interrupts the Cargo process group" / "repository
doctor surfaces the exact-link failure") used 5–20 s spawn windows and
failed intermittently inside `scripts/verify-local-proof` when the
machine was under concurrent build load, while passing 12/12 in
isolation (verified three times on 2026-08-04/05 during the Move-2
landing). The suite spawns real cargo processes inside fixed timing
windows; a loaded scheduler could starve the spawn.

## Resolution

The SIGTERM fixture now waits on fake Cargo's actual ready marker and still
asserts process-group interruption plus temporary-target cleanup. Synchronous
doctor fixtures use a two-minute deadlock watchdog rather than treating 20
seconds as a performance contract; the exact-link helper's own 15-minute
behavioral deadline remains authoritative. The corpus also serializes its
process-global temporary-directory cleanup assertions so the longer waits do
not mistake a sibling fixture's live directory for a leak.

The fake-Cargo fixture deliberately waits 5.25 seconds before publishing its
marker, so the regression deterministically fails the former five-second
polling window even on an idle machine.

`node --test tests/runtime_link_smoke_v0.mjs` passes 12/12; under concurrent
build load the doctor recovery-record fixture took 21.7 seconds, reproducing
why the former ceiling was unsound while preserving every behavioral
assertion.
