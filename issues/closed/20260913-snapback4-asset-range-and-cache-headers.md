# Snapback 4: unsatisfiable Range serves the whole asset; cache does not vary on the viewer

Status: Closed
Resolved: 2026-09-13
Priority: P2
Date: 2026-09-13
Systems: HTTP `GET /assets`
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)

## Problem and reproduction

An otherwise valid byte range whose start was beyond the file returned `200`
with the entire asset. Viewer-authorized assets also used a year-long private,
immutable cache directive even though the URL did not vary by principal, so a
shared browser cache could reuse bytes without another authorization check.

## Implementation location

- [snapback4/crates/snapback4/src/assets.rs](../../snapback4/crates/snapback4/src/assets.rs)

## Resolution — 2026-09-13

Range parsing distinguishes malformed syntax from a valid but unsatisfiable
interval. The latter returns `416 Range Not Satisfiable` with
`Content-Range: bytes */<length>` and no asset body; malformed Range remains
ignored as the HTTP range specification permits. Every authorized asset
response now uses `Cache-Control: private, no-store`, so the browser must return
to the server and re-evaluate the current principal and home-row read rule.
View-once assets continue to refuse partial ranges before consuming a view.

Focused host tests cover suffix/open/closed ranges, past-EOF 416 behavior, and
the cache headers. The exact delivered commit's suite and independent-review
evidence is retained in the `sb4-security-20260913` ship-run ledger.
