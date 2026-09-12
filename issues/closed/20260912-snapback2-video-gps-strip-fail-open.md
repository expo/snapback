# snapback2 video walk leaves GPS data behind — privacy strip is fail-open

**Status:** Resolved
**Priority:** P1 (privacy: strip claims vs. actual behavior)
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/crates/snapback2/src/video_walk.rs:421-484`, `:545-554`, `:403-407`

## What was reported

- `visit_track`/`visit_mdia` forward non-tkhd/mdia/hdlr children to the
  generic `visit()`; `minf`/`edts`/`dinf`/`mvex`/`moof` boxes are treated as
  opaque. Live probe: a GPS `(c)xyz` box under
  `moov/trak/mdia/minf/udta` **survives** `walk_and_strip` (`Ok 640x480`,
  `gps_survives=true`). The strip is fail-open for GPS-capable containers.
- `:545-554` `visit_meta` is last-wins and silently ignores unknown meta
  children (`_ => {}`), while uuid handling at `:403-407` is fail-closed —
  inconsistent policy; unknown meta children pass through.

## Suggested fix

- Descend into `minf`/`dinf`/`edts`/`mvex`/`moof` (or refuse files with
  opaque GPS-capable boxes when stripping is requested), and make unknown
  `meta` children fail closed like uuid.
- Add the probe case as a regression test (GPS under `minf/udta` must not
  survive stripping).
- Reproduce before fixing; audit which other location-ish boxes share the
  opaque path.

## Acceptance

- The reported GPS fixture is stripped (or refused); unknown-meta policy is
  uniform and tested.

## Resolution — 2026-09-12

Nested GPS and unknown-meta regressions failed before the fix. The walker now descends through mdia/minf/dinf/edts/mvex/moof/traf/stbl and strips xyz/loci regardless of parent. Unknown meta children and duplicate keys/ilst tables refuse before mutation; known uuid uses the same fail-closed classifier. The regression covers all seven previously opaque container shapes; 35 video tests pass, including unchanged offsets and idempotent stripping.
