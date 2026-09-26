# Snapback 4: a list of images compiles, but its assets are never placed (`E_ASSET_UNKNOWN` for authorized readers)

**Target release:** 0.4.4 — the author asked (2026-09-26) that the 0.4.4 publish hold for this fix; LLP 3000.019 §6 records the hold. **Owner:** lane `sb4/image-list-assets` on the black M5 Max (Snapback 5 lead session).
**Opened:** 2026-09-26 (calibration #22 on `snapback4@0.4.3`, M2; the builder attributed it `snapback4-defect`)
**Severity:** High for media authoring: the compiler accepts a shape that the asset path cannot serve
**Area:** asset placement for list-typed columns (`[image <=N] <=K`); `check`

## What happens

- A post table with `photos: [image <=10000000] <=4` compiles, and
  mutations store the uploaded ids in the list.
- An authorized recipient's asset `GET` then returns
  `404 {"denied":{"code":"E_ASSET_UNKNOWN",…,"message":"no asset is served under that id to this viewer"}}`.
- Scalar `image` and `video` columns on the same rows serve normally
  (`200 video/mp4`).
- Placement, the asset's home row and its read authority, evidently records
  scalar asset columns only.

Evidence: `~/clique-sb4-20260926-astra-cal22/lanes/astra-snapback4/evidence/media-probe.txt`
and `why-assets.txt`; run log line 25; `final-report.md:89`; `diary.md:13`.
The builder's workaround was four scalar image columns, with the list rebuilt
in a shape. The scorer charged `media_assets` 78, against 99 in calibration
#21, whose builder happened to use scalar columns.

## Fix direction

Either place every element of a list-of-asset column (and release elements
removed by an update), or refuse list-of-asset columns at `check` with a
fix that names scalar slots. A shape the compiler accepts must be servable.
Regression test: a list of two images, uploaded and stored, fetched by an
authorized recipient; then an update that removes one element, after which
that element is no longer served.


## Resolution — 2026-09-26

Implemented direction 1: bounded asset lists retain the accepted language form.
Each element receives the row/column home and current row read authority;
identity-based reconciliation retains homes on reorder, releases removed
members and releases all members on deletion. Upload admission, authoritative
fact stamping and `once` traversal now recognize list elements. Optional and
nested lists, and video lists, use the same path. Existing refusal codes apply.

Ledger reservations charge the scalar allowance times the declared cap before
target lookup, independent of actual list length. No product ceiling increased.
HTTP regressions cover the reported scalar-admitted case and a list-only schema,
authorization, removal, delete, reorder and per-element once; core regressions
cover facts, ownership, kind, size, home conflicts, rollback and fixed metering.
The compiled media card, LLP 3000 §7 and append-only journal record the contract.

Qualification: `== 0 failure(s) in 3832 s` (exit 0). `./ref-check --verbose` passed. Wasm measured
1,972,811 bytes raw / 569,966 bytes gzip, one byte smaller than base; web code
is byte-identical. The ratchet is measured + 1,000 = 570,966 bytes. Full evidence
is in `snapback4/target/image-list-assets/`; the final report is
`/Users/ccheever/projects/snapback-sb5-program/image-list-assets.final.md`.

Previously unplaced stored IDs are not automatically backfilled. The separate
device offline-list-retention gap is tracked in
`issues/20260926-snapback4-list-asset-offline-cache.md`.
