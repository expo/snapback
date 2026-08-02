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

---

**RESOLVED 2026-08-01.** Root cause: `e2c79ba8`'s facts stamp
(`LiveSubscribeOutput.facts` and the server response equivalents) calls
`invocation_facts_from_manifests`, which under a Sessions-scoped
authority *derived* `DeploymentIdentity::from_manifests` — a derivation
that requires non-empty schema/bundle/inputs hashes. The 24 failing
fixtures install sessions-scoped invalidation authorities over
dev-shaped manifests (an activation-unreachable mixed posture:
production sessions activation enforces the full identity pair), so the
facts stamp errored the whole subscribe.

Fix (shape b, mirroring the "degrade honestly" rule): the facts stamp
is best-effort — an underivable pair identity stamps `None` instead of
failing the invocation (absence is the explicit compatibility path per
the LLP 0012 call-time-generation-binding amendment's own text), while
an *asserted* `expectedGeneration` against an underivable identity
refuses fail-closed (`SNAPBACK_ARTIFACT_IDENTITY_MISMATCH`, subcause
`identity-underivable` — no new code, inventory-safe). Activation-path
strictness (auth/mode.rs, storage/auth_mode.rs) is untouched.
Regression test
`sessions_facts_degrade_when_identity_is_underivable_and_assertions_refuse`
pins both halves. Full lib suite 1609/0; pinned suites green (the
artifact-schemas red seen mid-fix was this worktree's documented stale
gitignored todo-v2 cache, cleared by regenerating both profiles — no
committed artifact changed).
