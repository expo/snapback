# Snapback 4: a list of images compiles, but its assets are never placed (`E_ASSET_UNKNOWN` for authorized readers)

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
