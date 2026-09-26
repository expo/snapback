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

## Resolution — 2026-09-27, lane A5

Implemented the reviewed device half from lane A on top of the landed server's
`engine/asset_columns.rs`, without replacing its placement or metering policy.
Confirmed sync indexes acquired media-bearing rows; a successful download's
ledger home and store identity authorize retention. Recursive optional/list
membership is checked through the authorized device row. Ordinary list elements
survive offline reopen and reorder; removal, clear, deletion, expiry, generation
change and partition leave retire them. `once` stays uncached. A delayed response
from a replaced store cannot restore old bytes. Old cache entries without the
confirmed store binding are purged.

Evidence: four new list device tests on memory/SQLite; 22 real HTTP/native/wasm
list tests, including the reviewed legacy-reference and delayed-store-replacement
cases; the receipt-aware Blob, clock, reset, scalar, retained-history and deferred
boundary regressions; all 86 guide tests. The assets card and LLP 3000.019 §3.5
now state this behavior.

Same-host production wasm decreased from 1,980,253 raw / 571,842 gzip to
1,980,173 raw / 571,839 gzip (−80 raw / −3 gzip). The unchanged 570,966-byte
budget was already exceeded by the baseline; its remaining 873-byte overrun
is a separate integration verification problem, not an unfinished media port.
The required complete suite ended `== 3 failure(s) in 2372 s`: the inherited
wasm overrun, an unchanged Rust test-adapter signature mismatch, and two client
imports missing the trace fixture that the blocked Rust run normally generates.
The trace producer then passed 2/2 and those client files passed 48/48 separately.
All 78 client model tests passed. Every failure and reproduction are recorded in
[`the A5 report`](../../snapback4/reports/20260927-lane-a5-list-offline.md).
