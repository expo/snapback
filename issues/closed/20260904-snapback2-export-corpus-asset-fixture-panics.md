# snapback2: `export_corpus` panics in a LLP 1006 asset fixture (finalized bytes not reserved)

**Status:** Closed
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

**Disposition:** Closed — implemented and exported in the landed repair. **Triage priority:** P3.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

The cited fixture now calls reserve_asset_finalized_bytes before mark_asset_ready at both current asset fixture sites. Git blame identifies landed commit `0dbf09277871fb9d6ee6bb4b687b0112255fab8d` (2026-09-04), whose implementation record explicitly names this panic repair and the completed corpus regeneration. The original missing-precondition defect is resolved.

Evidence: that commit's retained regeneration and `snapback2/crates/snapback2-core/src/bin/export_corpus/assets.rs`, reservation sites beside readiness publication. This is reconciliation against executed landing evidence, not a new exporter run. The exporter hardcodes the tracked corpus path and deletes existing JSON fixtures before rewriting them, so it was deliberately not rerun during this ticket-only audit. Closure does not claim that every unrelated future exporter input is qualified.
