# Snapback 4: view-once is recorded before the bytes are delivered

Status: Closed
Priority: P1
Date: 2026-09-13
Systems: `snapback4-core` asset grants, `snapback4` HTTP `/assets`
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)
Related: Clique M5 (view-once), [LLP 3000](../../llp/3000-snapback4.explainer.md) §7

## Problem and reproduction

`Engine::asset_access` commits `_asset_views` for `image … once` and then returns. `assets::serve` opens the file and streams **after** that commit.

A client that reads headers and closes without the body spends the one view. A cancelled `<img>`, a dropped fetch, a missing file after the grant, or a `Range` probe does the same: the next GET is `410 E_ASSET_VIEWED`.

Reproduction: grant a `once` image to bob, `GET /assets/<id>` as bob, read status/headers (`200`, `Content-Length`, `Cache-Control: private, no-store`), close the socket without the body. The next GET is `410`.

Clique M5 is “expiry with no client open” plus view-once photos. An interrupted first view is a product miss.

## Implementation locations

- [snapback4/crates/snapback4-core/src/engine/mod.rs](../../snapback4/crates/snapback4-core/src/engine/mod.rs) (`asset_access`, `record_asset_view` then `commit`)
- [snapback4/crates/snapback4/src/assets.rs](../../snapback4/crates/snapback4/src/assets.rs) (`serve`)

## Suggestion

Open (or `dup`) the file inside the grant transaction. Record the view only after a successful send of a full 200, or refuse `Range` on `once` and always send the whole body. Serialize overlapping GETs per `(asset, principal)` so two in-flight views cannot both succeed.

Historical scope: [S12 asset-once and pixel bounds](../20260913-snapback4-asset-once-and-pixel-bounds.md) covers uploader exemption and pixel caps; this ticket owns the commit-before-bytes remainder.

## Resolution — 2026-09-13

Authorization and finalization are now separate engine operations. The HTTP
host serializes transfers per `(asset, principal)`, authorizes and opens the
file, refuses `Range` on a one-view image, and records the view only after
`tiny_http` reports that the complete response body and flush succeeded. A
checked-response adapter preserves disconnect errors that upstream
`tiny_http::Request::respond` deliberately suppresses.

The real-host regression uploads and places an 8 MiB one-view PNG. A range
probe returns 416 without spending it; a TCP client then reads the 200 headers
and disconnects before the body. A subsequent complete GET still returns all
8 MiB, and only the following GET returns 410 `E_ASSET_VIEWED`. This test
passes with the other 17 focused HTTP/CLI host assertions.
