# Snapback 4: retain ordinary list assets in the offline media cache

**Opened:** 2026-09-26, while fixing image-list server placement
**Severity:** Medium: ordinary list assets serve online but are not retained offline
**Area:** `snapback4-device/src/device/media.rs`, local media retention

The server placement fix supports bounded image/video lists, but the existing
device home index is scalar-only: `media_type` does not traverse `List`,
`remember`/`forget` read one field `id`, and `asset_home` checks one scalar cell.
Consequently `local-assets.ts::viewed` gets no home for a list element and does
not retain it. Ordinary online fetch still works; server `Accept-Ranges: none`
continues to keep `once` images out of durable storage.

This is separate from the server's `E_ASSET_UNKNOWN` defect. The media card now
states the offline boundary. Follow-up: recursively index and validate list
homes on confirmed sync images, revoke removed elements and leaves, preserve
reorder, and keep `once` uncached. Test ordinary offline reopen, list removal,
row expiry/deletion, generation changes and partition leave on memory and
SQLite devices, then measure the web artifact before changing its ratchet.

Evidence is code inspection, not an executed offline-list witness. No device
or client runtime was changed by the server-placement fix.
