# snapback2 live-control blocks an HTTP worker up to 10s per request

**Status:** Resolved
**Priority:** P2 (slow-loris worker exhaustion)
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/crates/.../serve_live.rs:97` (`answer.recv_timeout(10s)`), pool sizes 64/44/8/4, `E_OWNER_BUSY :104`

## What was reported

The live-control path blocks an HTTP worker in `recv_timeout(10s)`. A hung
control thread holds a worker per request; with the 64/44/8/4 pools a
slow-loris client can exhaust workers (the `:104` control reservation only
partly mitigates).

## Suggested fix

- Async rendezvous (or a much shorter timeout + shed load with 503) so a
  hung control thread cannot pin a worker for 10s.
- Add a test with a hung control peer asserting bounded worker hold time.

## Acceptance

- Hung-control test shows workers freed within the new bound; slow-loris
  shape no longer exhausts the pool.

## Resolution (2026-09-12)

The live-control rendezvous now holds a worker for at most 250 ms before E_OWNER_BUSY/503. The hung-control regression verifies release within one second, and reserved control/JSON capacity remains bounded separately from SSE. The integrated native test passes.
