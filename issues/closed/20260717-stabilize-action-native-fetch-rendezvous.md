# Stabilize action native-fetch rendezvous under cold startup

**Status:** Closed
**Severity:** P2
**Systems:** Action watchdog, Acceptance tests, Native Ibex runtime
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0028; LLP 0032
**Marker:** action, watchdog, native-fetch, fixture, flake

The action-watchdog integration proof used a two-second fetch-start timeout as
the setup rendezvous for a cold detached Ibex action. The test explicitly does
not measure startup latency, yet a healthy action reached the held native fetch
after 2.2–4.2 seconds under host load. The blind timeout therefore reported a
write-mutex regression before the causal concurrency witness had begun.

**Done when:**

- Non-timeout action proofs use a coarse setup bound distinct from their
  semantic mid-action deadlines and from the actual watchdog budget.
- Waiting for fetch start races the action task, so a genuine early diagnostic
  fails immediately with its response instead of looking like a timeout.
- The fetch-start signal remains the causal proof that concurrent mutation and
  query assertions run while the action is active.
- Exact tests pass repeatedly and the complete action-watchdog suite passes.

## Resolution

Non-timeout action fixtures now give cold native startup a named coarse bound
below a separately widened watchdog budget. Direct action rendezvous races the
fetch-start signal against action completion, preserving quick, diagnostic-rich
failure for real route/runtime refusals. The two-second mutation/query bounds
remain unchanged, so the mutex-concurrency claim is not weakened.

The one test that intentionally restores the 800 ms watchdog now warms the
process-global native fetch path under the wide non-timeout budget first. Its
short deadline therefore measures abandonment while waiting for the held app
mutex, not unrelated first-use runtime/network initialization.

A canonical-proof follow-up found one remaining legacy two-second rendezvous in
the secret-redaction/config-rotation case. That proof now uses the same shared
causal helper: it waits under the coarse cold-start bound for the held fetch,
while racing the cron request task so a real early action failure reports its
response immediately. Rotation still occurs only after the fetch-start signal,
preserving the staging-time redactor invariant rather than weakening it with a
sleep or a larger semantic timeout. Post-release settlement uses that same
coarse bound rather than retaining another unrelated three-second scheduling
threshold.

Focused proof on 2026-07-17:

- `action_run_does_not_hold_the_write_mutex` — passed 10/10 repeated isolated
  runs.
- `detached_action_secret_redaction_survives_config_rotation` — passed 10/10
  repeated isolated runs after the follow-up; observed runtimes were
  1.72–2.23 seconds, confirming the old two-second setup threshold was
  marginal under ordinary host variance.
- `cargo test --test action_watchdog_v0 -- --nocapture` — 11 passed.
