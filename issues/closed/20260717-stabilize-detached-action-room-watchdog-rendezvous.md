# Stabilize detached-action room-watchdog rendezvous

**Status:** Closed
**Severity:** P2
**Systems:** Action watchdog, Auth, Ephemeral state, Acceptance testing, CI
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0028 §Execution: the action class; LLP 0059 §Authorization-write handoff
**Marker:** action, watchdog, authorization, room-reservation, linux, flake

The detached-action room-reservation proof started a 300ms public action
watchdog before a cold Hermes worker had evaluated the outer action and entered
its nested mutation. On a loaded Linux proof runner, the watchdog could
legitimately abandon the action before the nested host call installed its exact
room dependency. The test then waited two seconds for a dependency that could
no longer appear and reported that the cancellation protocol was broken, even
though it had never reached that protocol.

**Done when:**

- The proof causally observes the exact protected-room dependency before
  triggering abandonment.
- It executes the same commit-gated abandonment transition as the production
  watchdog, rather than a test-only approximation.
- Cancellation removes only that dependency while the predecessor room permit
  remains held, returns the stable timeout diagnostic, waits for worker
  teardown, and publishes no durable write or receipt.
- The focused test passes repeatedly without depending on native-VM startup
  latency.

## Resolution

The commit-gated production abandonment cut is now a small shared helper. The
focused room proof runs the detached mutation host on the real bounded worker,
waits for the room registry itself to report `AuthorityPending`, and only then
invokes that production cut. It races the causal rendezvous against early
worker completion for a precise failure and retains a coarse timeout solely as
a deadlock bound. This removes cold Hermes startup from a test that is about
exact ticket cancellation; the integration watchdog suite continues to own
timer enforcement and native-VM teardown coverage.

The original test passed 10/10 locally before the change but failed in GitHub
Actions run 29631948936 on the loaded Linux runner, consistent with a
platform/load-sensitive setup race. Focused verification after the repair:

- exact room-watchdog proof: passed 25/25 repeated runs;
- all six `server::tests::detached_action_*` unit tests: passed;
- complete `action_watchdog_v0` integration suite: 11 passed;
- `cargo clippy --lib --tests -- -D warnings`,
  `cargo fmt --all -- --check`, `git diff --check`, and
  `./ref-check --verbose`: passed.
