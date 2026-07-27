# Flaky obsolete-socket assertion in the Cloudflare security-hardening gate

**Status:** Resolved (2026-07-27; duplicate diagnosis verified)
**Impact:** 3
**Urgency:** 4
**Ease:** 4
**Confidence:** 4
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “Flaky obsolete-socket assertion in the Cloudflare security-hardening gate” shows the issue materially affects reliability, verification, or developer experience; delay compounds an active rollout, reliability, or verification risk, while the implementation is localized and has concrete acceptance witnesses, with specific cited code, progress, or acceptance criteria.
**Severity:** P2
**Systems:** Cloudflare target, Miniflare, Acceptance tests, Live queries
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** cloudflare/test/acceptance.security-hardening.mjs (line ~291), issues/closed/20260716-cloudflare-security-hardening-flake.md (a DIFFERENT, closed transport flake), LLP 0040 §Acceptance
**Marker:** test-reliability, flake

`cloudflare/test/acceptance.security-hardening.mjs` fails intermittently at
the replacement-first WebSocket ownership assertion: after a `current`
socket re-accepts the connection (which should displace the earlier
`replacement` socket's ownership), closes, and a mutation commits, the
suite asserts the obsolete `replacement` socket receives **no** frame
within 250 ms — and sometimes it does receive one (`obsoleteReceived`
true).

Measured on 2026-07-24 (macOS, Node 24.18.0, repo-pinned Miniflare), the
failure is load-sensitive and **pre-existing on origin/main** — witnessed
by an A/B run against the LLP 0058 capability-maturity change that was in
flight when it surfaced:

- pristine origin/main (3e56d4af): 4 failures, 2 passes across 6
  standalone runs, all at the same assertion;
- with the (unrelated) capability-maturity working tree applied: 3
  failures, 1 pass across 4 runs, same assertion.

Identical failure signature both arms, so the race is not introduced by
that change. This is distinct from the closed 2026-07-16 flake, which was
an Undici pooled-socket transport race with varying failure locations;
this one is deterministic in location and is about coordinator socket
ownership displacement racing the 50 ms settle sleeps / 250 ms
frame-timeout window in the test.

**Done when:**

- The displacement race is understood: either the coordinator really can
  fan out one frame to an already-displaced socket (a product ordering
  bug) or the test's fixed 50 ms/250 ms windows are too tight for a loaded
  machine (a witness defect); the fix targets whichever is true — no blind
  assertion retries.
- Repeated standalone and full-inventory (`node
  cloudflare/test/local-suite.mjs`) runs are stable under load.

## Resolution

This ticket described the same failure later isolated and fixed in
[`20260724-security-hardening-obsolete-socket-flake.md`](./20260724-security-hardening-obsolete-socket-flake.md).
Instrumentation proved that the coordinator already had zero subscriptions and
zero accepted sockets before the final mutation. The observed frame was
legitimate pre-displacement warm-poll traffic left in the client's queue, not a
post-displacement delivery.

Commit `04b8828e` made the witness deterministic: after the current socket
displaces and closes the replacement, the test drains every already-queued
frame to a 200 ms quiet boundary, verifies the durable subscription registry is
empty, commits the final mutation, and then asserts that no new frame arrives.
That targets the witness defect without retrying the assertion or weakening the
coordinator's session-ownership checks.

The resolution was re-verified from current `origin/main` on 2026-07-27 with
Node 24.18.0: 20 consecutive standalone
`cloudflare/test/acceptance.security-hardening.mjs` runs passed. The complete
Cloudflare inventory is also part of the integration verification for this
landing.
