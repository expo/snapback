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

## Triage — 2026-09-11 (UTC)

**Disposition:** Open — repair present, fresh export verification pending. **Triage priority:** P2.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

The cited fixture now calls reserve_asset_finalized_bytes before mark_asset_ready at both current asset fixture sites. The original missing-precondition source is repaired; this ticket is narrowed to confirming that the complete current corpus exporter actually completes.

Source inspected at snapback2/crates/snapback2-core/src/bin/export_corpus/assets.rs (reservation sites beside readiness publication). A bounded current export is requested as part of this audit; source presence alone is not recorded as an executed export.
