# Flaky obsolete-socket assertion in the Cloudflare security-hardening gate

**Status:** Open
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
