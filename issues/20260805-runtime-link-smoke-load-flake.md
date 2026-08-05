# runtime_link_smoke_v0 timing windows flake under load

**Opened:** 2026-08-05
**Systems:** Developer experience, Acceptance testing

Three `tests/runtime_link_smoke_v0.mjs` tests ("fake Cargo did not
start" / "SIGTERM interrupts the Cargo process group" / "repository
doctor surfaces the exact-link failure") use 5–20 s spawn windows and
fail intermittently inside `scripts/verify-local-proof` when the
machine is under concurrent build load, while passing 12/12 in
isolation (verified three times on 2026-08-04/05 during the Move-2
landing). The suite spawns real cargo processes inside fixed timing
windows; a loaded scheduler starves the spawn.

Done means: widen the windows or gate them on a readiness signal
instead of wall-clock, so the full proof is load-tolerant.
