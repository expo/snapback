# Snapback 4: OPTIONS 204 advertises a JSON body it does not send

Status: Open
Priority: P1
Date: 2026-09-13
Systems: HTTP CORS preflight
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)

## Problem and reproduction

Preflight goes through `respond(..., 204, Json::Null)`, which sets `Content-Type: application/json` and `Content-Length: 4`. tiny_http then omits the body for 204.

A client that reads `Content-Length` hung waiting for `null`. A client that ignored the body (RFC 9110) got the next keep-alive response. Browsers should ignore CL on 204; Node/Python clients that do not will stall CORS or connection reuse.

## Implementation locations

- [snapback4/crates/snapback4/src/serve.rs](../snapback4/crates/snapback4/src/serve.rs) (`handle` OPTIONS → `respond`)
- [snapback4/vendor/tiny_http/src/response.rs](../snapback4/vendor/tiny_http/src/response.rs)

## Suggestion

Answer OPTIONS with empty `from_data([])` / `new_empty(204)` and CORS headers only. Do not serialize `null`.
