# snapback2: malformed Unicode percent encoding panics HTTP handlers

**Status:** Closed
**Resolution:** Refuted on verification: tiny_http read_next_line returns AsciiString::from_ascii and errors with 'Header is not in ASCII' before the handler runs (tiny_http-0.12.0 client.rs:80-101), so every request target reaching percent_decode is ASCII and its byte offsets are valid char boundaries. Both call sites (serve.rs:487,490) take request-line data only.
**Systems:** snapback2, HTTP, input handling
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/serve.rs:493-513

Failure scenario: send a raw request target containing /%aé. percent_decode derives byte positions from as_bytes but slices the UTF-8 str across the first byte of é, causing a Rust string-boundary panic; the handler thread dies without a refusal.

Why it happens: the percent branch uses &value[index+1..index+3] even though index is a byte offset and the two bytes need not be ASCII character boundaries. There is no upstream target validator or panic boundary that repairs it.

Suggested fix: parse hexadecimal nybbles directly from the byte slice with checked bounds and decode the resulting bytes lossily/strictly as specified. Add raw-TCP targets combining incomplete percent escapes and multibyte UTF-8.
