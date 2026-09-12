# snapback2 accept-loop fragility: pre-spawn decode + spawn failure kills owner

**Status:** Resolved
**Priority:** P1
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/crates/snapback2/src/serve.rs:103`, `snapback2/crates/snapback2/src/serve.rs:128`

## What was reported

Two findings with the same shape — one bad connection can take down the
owner instead of just itself:

1. `:103` — `for_url` runs `percent_decode` on the accept-loop thread,
   pre-spawn. Any future reachable panic there (cf. the `percent_decode`
   char-boundary panic ticket) kills the owner, not one connection.
2. `:128` — `Thread::Builder::spawn` failure sets `stop=true` and returns
   `Err`, shutting the whole owner down. One fd/thread exhaustion event
   stops serving everything.

## Suggested fix

- Move all attacker-influenced parsing off the accept thread / behind the
  per-connection spawn (or make it panic-free first).
- On spawn failure, shed the single connection (drop + metric) and keep
  serving instead of setting `stop=true`.
- Reproduce before fixing (fd-limit / spawn-failure injection test).

## Acceptance

- A malformed URL or a single spawn failure degrades one connection, not
  the owner; covered by a regression test.

## Resolution (2026-09-12)

Byte-safe classification removes the pre-spawn decode panic. Both application worker spawning and the HTTP dependency pool now use fallible Builder spawning and shed the affected connection. The bounded parser pool reserves capacity before spawning; accepted-stream clone failures are local and listener errors retry. Dropping an unconsumed body closes its read half before cleanup, without allocating or draining a declared Content-Length. Injected spawn failure, next-connection progress, huge unread body, and socket-flood regressions pass. The narrow tiny_http fork records these changes in its README.
