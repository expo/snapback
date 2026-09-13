# Snapback 4: unsatisfiable Range serves the whole asset; cache does not vary on the viewer

Status: Open
Priority: P2
Date: 2026-09-13
Systems: HTTP `GET /assets`
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)

## Problem and reproduction

`byte_range` returns `None` when `start >= total` (or `start > end`). The handler then sends `200` with the entire file. Probe: 70-byte PNG, `Range: bytes=999999-9999999` → `200`, 70 bytes, no `Content-Range`. RFC 7233 wants `416` with `bytes */total`. Video players that probe past EOF get a full MP4.

Non-`once` responses are `Cache-Control: private, max-age=31536000, immutable` with no `Vary`. The URL is only `/assets/<id>`. A second principal in the same browser HTTP cache can be served Alice’s bytes without a round-trip that re-checks the home row’s read rule. `once` correctly uses `no-store`.

## Implementation locations

- [snapback4/crates/snapback4/src/assets.rs](../snapback4/crates/snapback4/src/assets.rs) (`byte_range`, `serve` headers)

## Suggestion

If a `Range` header is present and the interval misses the file, answer 416. Keep “ignore malformed Range” only for unparseable specs. `Cache-Control: private, no-store` for all asset GET, or `Vary: Authorization, X-Snapback-Persona`.
