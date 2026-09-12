# snapback2 percent_decode slices &str on byte index — panics on non-ASCII input

**Status:** Resolved
**Priority:** P0 (remotely reachable panic shape; abort under shipped profile)
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/crates/snapback2/src/serve.rs:824` (`percent_decode`)

## What was reported

`percent_decode` walks the input by bytes but slices the `&str` with
`&value[i+1..i+3]`. A live function probe panicked on `/%aé` with
`end byte index 4 is not char boundary` — a multi-byte char after `%`
splits the slice mid-codepoint.

Attacker-controlled callers:

- `WorkerClass::for_url:166-168`
- `split_url:804-814`
- `decorate_asset_response_headers:929-931`
- `query_has_name:940-944`

The shipped profile sets `panic=abort`, so a reachable panic aborts the
owner process; on the default profile it kills the serving thread.

Mitigating note from the review: `tiny_http` 0.12 `read_next_line` rejects
bytes >127 (`AsciiString::from_ascii`) — a live TCP probe showed raw UTF-8
path/query bytes dropped before reaching this code, so it is reportedly not
remotely reachable *today*. Any server-front change or direct caller (e.g.
`TestRequest::with_path`, which has no ASCII check) re-exposes it.

## Suggested fix

- Slice bytes, not `&str`: operate on `value.as_bytes()`, or use
  `value.get(i+1..i+3)` and push a literal `%` (or reject) on failure.
- Add a regression test with `%` followed by multi-byte UTF-8 (`/%aé`).
- Reproduce before fixing; confirm whether any current caller can pass
  non-ASCII through.

## Acceptance

- `percent_decode` never panics on arbitrary byte/str input (fuzz or
  targeted multi-byte cases pass).
- Non-ASCII input is handled deterministically (literal `%` or 400).

## Resolution (2026-09-12)

Reproduced the original `/%aé` panic (exit 101), then replaced string slicing with bytewise hex decoding. Malformed escapes remain literal and every Unicode scalar following `%a` is exercised. Raw non-ASCII request lines remain rejected by the HTTP parser; this fixes direct callers and prevents a future parser change from exposing the panic. The integrated decoder regression and owner input-boundary test pass.
