# Snapback 4: View-once skips the uploader; pixel dimensions are uncapped

Status: Closed
Resolved: 2026-09-13
Priority: P2
Observed: 2026-09-13
Review finding: S12
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Related: [security review](../../llp/reviews/3000-security-review-20260913.md)

## Problem and reproduction

Two asset-serving gaps:

1. **Uploader bypass of `image … once`.** `asset_access` returns immediately when `asset.owner == principal`, with `once: false`, without consulting `_asset_views`. The sender can refetch a view-once photo forever. Recipients are recorded. A Range request from a recipient still counts as the one view (even `bytes=0-0`).

2. **Declared dimensions are not capped.** JPEG SOF, PNG IHDR and WebP boxes can name widths/heights up to 2^32−1 (JPEG 65535). The server stores those facts and never decodes pixels, but clients will. A few-megabyte file that claims a multi-gigapixel frame is a decompression bomb on the device. Column `<=N` bounds bytes only.

Magic-byte sniffing plus `X-Content-Type-Options: nosniff` is otherwise sound (no SVG/HTML). Polyglot JPEG/HTML is not executed under nosniff.

## Acceptance

- Define view-once for the uploader (count, or explicit sender exemption documented on the asset card) and apply it in `asset_access`.
- A partial Range read of a `once` image is either refused or consumes the view only after a complete 200.
- Cap stored width/height (and video duration) to documented maxima; refuse the upload if the header exceeds them.

## Implementation locations

- [crates/snapback4-core/src/engine/mod.rs](../../snapback4/crates/snapback4-core/src/engine/mod.rs) (`asset_access`)
- [crates/snapback4-core/src/assets.rs](../../snapback4/crates/snapback4-core/src/assets.rs) (`sniff`, dimensions)
- [crates/snapback4/src/assets.rs](../../snapback4/crates/snapback4/src/assets.rs) (Range)

## Resolution — 2026-09-13

Once placed, an asset applies its home row's read rule and once-view ledger to the uploader too; only an unplaced owner preview is exempt. Ranges on once assets are refused with E_ASSET_RANGE before consuming the view. A whole-file request consumes the view at admission. Image dimensions must be nonzero, at most 16384 per side, and at most 40 million pixels; known video duration must be positive and at most one hour. Invalid headers are refused before a file is created. Owner/recipient/range and dimension/duration regressions pass; this remains header inspection rather than a full media decoder.

Delivery validation and independent review for the current-main port are in
the [remediation record](../../llp/reviews/3000-security-remediation-20260913.md).
