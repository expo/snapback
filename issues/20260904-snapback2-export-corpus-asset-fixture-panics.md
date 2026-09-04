# snapback2: `export_corpus` panics in a LLP 1006 asset fixture (finalized bytes not reserved)

**Status:** Open
**Systems:** `snapback2/crates/snapback2-core/src/bin/export_corpus/assets.rs`
**Date:** 2026-09-04
**Related:** LLP 1006 §9a (finalized growth durably reserved before publication); LLP 1012 lanes O1a/O1c reports

## What happened

Two independent LLP 1012 lanes found that `cargo run -p snapback2-core --bin export_corpus`
panics at `export_corpus/assets.rs:944` because the fixture calls `mark_asset_ready` without
first reserving finalized bytes on the receiving ledger row, which LLP 1006 revision (m)
made mandatory. Both lanes worked around it locally (one temporarily supplied the
precondition, one regenerated only its own fixtures through a test hook) and neither
touched the asset code.

## What would fix it

The fixture reserves finalized bytes before marking ready, matching the engine's
invariant; a corpus export on a clean tree then completes.
