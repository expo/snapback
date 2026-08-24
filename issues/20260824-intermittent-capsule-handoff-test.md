# Intermittent failure in the capsule handoff reservation-release test

Status: open
Date: 2026-08-24
Systems: snapback-server
Related: issues/20260824-liveness-factory-triage-and-count-correction.md

`server::tests::bounded_commit_capsule_queue_and_handoff_unwinds_release_reservation_and_gate`
failed once during unrelated grant-revocation work, then passed on rerun.

Evidence it is intermittent rather than caused by that change:
- it passes in isolation on both the change branch and unmodified `origin/main`;
- I ran the **full** `snapback-server` lib suite on a baseline of `origin/main` plus a docs-only
  commit: **589 passed, 0 failed**;
- the change's own rerun of the full suite also passed 589/589;
- the change's diff touches only the two grant-revocation planners, a test file, and two route call
  sites — nothing in the capsule queue or handoff path.

Filed rather than shrugged off because of what it tests. This test covers **unwinding that releases
a reservation and a gate** — and reservation lifetime is precisely the subject of the current
authorized-effect program. An intermittent failure there may be masking a real race in reservation
release rather than being mere test flake. It should be investigated on its own terms, not closed
because a rerun was green.
