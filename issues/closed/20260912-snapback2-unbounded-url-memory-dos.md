# snapback2 unbounded GET/subscribe URLs and request line

**Status:** Resolved
**Priority:** P2 (asymmetric memory DoS)
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/crates/snapback2/src/serve.rs:538` (GET `subscribe/channel`), `:786` (POST 1MiB cap); `tiny_http read_next_line`

## What was reported

GET `subscribe/channel` URLs are unbounded while POST bodies are capped at
1MiB (`:786`); `tiny_http`'s `read_next_line` grows a `Vec` to CRLF
unboundedly. A client can force large allocations with a long URL/line —
asymmetric memory DoS against the serving workers.

## Suggested fix

- Cap URL length (and the request line) with a 414/431; keep it consistent
  with the POST cap rationale.
- Add a test asserting oversize URLs/lines are refused cheaply.

## Acceptance

- Oversize request targets/lines rejected boundedly; legitimate long
  channel URLs (document the limit) still work.

## Resolution (2026-09-12)

The HTTP parser rejects request lines above 16 KiB with 414 before unbounded allocation; individual header lines are limited to 16 KiB and aggregate headers to 64 KiB (431). These limits cover GET/query/subscribe URLs as well as POST routes. Raw over-limit and subsequent healthy-request owner tests pass. Accepted sockets also have 5-second read/write idle timeouts and bounded parser concurrency.
