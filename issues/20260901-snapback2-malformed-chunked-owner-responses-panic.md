# snapback2: malformed chunked owner responses panic CLI verbs

**Status:** Open
**Systems:** snapback2, CLI client, HTTP parsing
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/client.rs:133-170

Failure scenario: a stale/reused owner port or fake loopback service returns Transfer-Encoding: chunked with bytes "1\r\na" and closes. The decoder consumes a, advances cursor by size+2 past input, then panics on input[cursor..] in the next loop. A huge parsed size can also overflow cursor+size.

Why it happens: the decoder checks payload length but never verifies the trailing CRLF, next cursor bound, trailer, or checked arithmetic. parse_response does not catch panics, so ordinary CLI probing terminates abruptly instead of returning E_OWNER_PROTOCOL.

Suggested fix: implement a bounded incremental chunk decoder with checked additions and explicit data CRLF/final trailer validation, returning typed protocol refusals for every malformed input. Add truncated and overflow-size cases.
