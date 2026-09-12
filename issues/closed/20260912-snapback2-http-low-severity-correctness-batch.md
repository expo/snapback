# snapback2 HTTP low-severity correctness batch (plus/bearer/poison/truncate/chunked)

**Status:** Resolved
**Priority:** P3 (batch of lows; split out if any grows)
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/crates/snapback2/src/serve.rs:832`, `:762`, `:207`; `snapback2/crates/snapback2/src/asset_http.rs:651`, `:1136`; `snapback2/crates/snapback2/src/writer_sse.rs:54`

## What was reported

- `serve.rs:832` — `percent_decode` maps `+`→space for **paths** too;
  `+` in asset/channel names misroutes via `for_url`/`channel_name`.
  Fix: query-only plus handling.
- `serve.rs:762` — `bearer()` strips only the exact `Bearer ` prefix;
  lowercase `bearer` (RFC 7235: scheme is case-insensitive) yields spurious
  Anonymous failures. Fix: case-insensitive scheme match.
- `serve.rs:207`, `writer_sse.rs:54` (+ blob paths) — `lock().expect()` in
  `Drop`/`acquire`: one poisoned mutex panics all later holders. Fix: map
  poisoning to 500/refusal instead of panicking.
- `asset_http.rs:651` — `write_once_body` uses `Some(blob.length as usize)`,
  truncating `u64` on 32-bit; sibling `:560` already uses
  `usize::try_from` + 500. Fix: reuse the `try_from` gate.
- `asset_http.rs:1136` — `required_content_length` rejects missing
  `Content-Length` (422), refusing chunked uploads. Interop gap. Fix: allow
  chunked up to `kind_max` + reserve.

Each item needs independent reproduction before fixing; split into its own
ticket if the fix turns out non-trivial.

## Acceptance

- Each sub-item has a regression test; `+` routes correctly, lowercase
  `bearer` authenticates, poisoned mutex degrades gracefully, no
  truncation, chunked uploads within budget accepted.

## Resolution (2026-09-12)

Path decoding preserves + while query decoding maps it to space; Bearer scheme matching is ASCII case-insensitive. Worker, SSE, and blob custody paths fail closed on poisoned locks and Drop no longer cascades panics. Once-body lengths use checked usize conversion (the overflow regression is cfg(32-bit), not executed on this 64-bit host). Chunked uploads stream within reserved kind limits; valid and over-budget chunks pass the raw asset round-trip regression. Independent decoder/bearer/poison tests pass, as do storage focused checks and the integrated asset wire test (23.93 s).
