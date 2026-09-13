# Snapback 4: OPTIONS 204 advertises a JSON body it does not send

Status: Closed
Priority: P1
Date: 2026-09-13
Systems: HTTP CORS preflight
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)

## Problem and reproduction

Preflight goes through `respond(..., 204, Json::Null)`, which sets `Content-Type: application/json` and `Content-Length: 4`. tiny_http then omits the body for 204.

A client that reads `Content-Length` hung waiting for `null`. A client that ignored the body (RFC 9110) got the next keep-alive response. Browsers should ignore CL on 204; Node/Python clients that do not will stall CORS or connection reuse.

## Implementation locations

- [snapback4/crates/snapback4/src/serve.rs](../../snapback4/crates/snapback4/src/serve.rs) (`handle` OPTIONS → `respond`)
- [snapback4/vendor/tiny_http/src/response.rs](../../snapback4/vendor/tiny_http/src/response.rs)

## Suggestion

Answer OPTIONS with empty `from_data([])` / `new_empty(204)` and CORS headers only. Do not serialize `null`.

## Resolution — 2026-09-13

OPTIONS now uses a dedicated empty-response path with CORS headers and no
JSON representation metadata. The vendored response writer omits
`Content-Length` for 1xx/204 responses instead of attaching the length of a
suppressed body.

The persistent-connection framing regression places OPTIONS between ordinary
JSON responses, asserts that the 204 carries neither `Content-Type` nor
`Content-Length`, and successfully reads the following response. The unread
request-body regression also confirms the empty 204 is returned before a
preflight body is sent. The focused binary suite passes 5/5 tests.
