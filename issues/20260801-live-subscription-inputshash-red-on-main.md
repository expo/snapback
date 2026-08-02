# 24 live-subscription lib tests red on origin/main: "schema inputsHash must be non-empty"

**Status:** OPEN — pre-existing on origin/main, attribution-verified 2026-08-01

`cargo test --lib` fails 24 tests in `local::tests` / `local::authorization_acceptance`
/ `server::tests` (live subscribe/resume/supersession/unsubscribe, auth-scoped
removal, projection handoff, outbox lease) with:

    SNAPBACK_CAPABILITY_UNSUPPORTED (auth): schema inputsHash must be non-empty

**Verified upstream, not caused by the 0062 envelope work:** checking out
`origin/main -- src/` over the branch reproduces the failure identically
(`live_resume_requires_the_exact_connection_grant`: 0 passed, 1 failed), and
the 0062-01 diff (a new unreferenced module, a schema-generator list entry,
and a test-only diagnostic-inventory array) cannot reach these paths.

Full-suite runs earlier today were green (1598 passed / 0 failed at the
ceremony landing), so the regression entered origin between that landing and
now. The signature points at the same-day generation-binding landing
(`e2c79ba8`, "bind sessions calls to generated artifact generations"): these
fixtures construct manifests without an `inputsHash`, which subscription
paths now assert. Likely fix shape: the test fixtures supply an identity, or
the assertion admits the legacy dev-tuple manifest that carries none.

Owner: whoever lands next in the generation-binding lane — this blocks the
full lib suite as a landing gate for every concurrent program.
