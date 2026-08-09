# 0199 god-file splits: fix-forward the carrier/receipt digest records

**Opened:** 2026-08-08 · **Severity:** P2 (frozen-record drift introduced by a landed refactor; fix-forward per LLP 0189) · **Area:** LLP 0199 execution / publication carriers

## What landed

The three LLP 0199 (Accepted, OQ4) cosmetic god-file splits landed on `main`:

- `src/storage.rs` 36,444 → 19,330 (−47%) → `src/storage/{connections,migration_scan,projection_rebuild,schema_transition,tests}.rs`
- `src/server.rs` 50,644 → 23,776 (−53%) → `src/server/{api_error,asset_routes,instance_home,response_types,tests}.rs`
- `src/local.rs` 59,629 → 30,513 (−49%) → `src/local/{receipt_log,inspection,live_protocol,config_types,tests}.rs`

All behavior-preserving (per-split `cargo build` + affected test suites green in-worktree), Rust module paths + public API unchanged via re-exports, ownership manifest/baseline co-migrated (gate PASS, 181 modules), `guide-lib` symbols kept in `server.rs`, LLP prose refs updated.

## Why bypass was used

The storage/local splits restale source-digest-bound frozen records, and each push runs a ~20-minute gate suite (full Rust compile+test + per-carrier ibex-bootstrapped attribution). On a continuously-advancing `main` this starves (main outran the gate window; the auth-invalidation receipt refused mid-run). Per the author's "bite the bullet, accept mess" direction, the correctness-verified code was landed via `SNAPBACK_DRIFT_GATES_BYPASS=1`, deferring the digest-record regeneration to this fix-forward.

## Fix-forward (regenerate on current `main`, one focused pass)

Introduced-stale by the splits (the records hash the moved `src/` files):

- `src/local-persistent-store-publication.v1.json` (+ `.anchor.v1.json`)
- `src/local-relation-activity-publication.v1.json`
- `src/local-sequence-allocation-publication.v1.json`
- the per-file digest maps embedded in `src/manifest.rs` (`local_*_publication_verified_for`) — must list `src/storage/*.rs` and `src/local/*.rs` and carry current `src/{storage,local}.rs` digests
- `tests/acceptance/auth-invalidation-v1-composed-receipt.json` (regen: `node tests/acceptance/auth-invalidation-v1-report.mjs --print > …`)

Regeneration needs the publication qualification mechanism (see the known-flaky `20260808-finalize-local-store-publication-blocked-by-retained-receipt-drift.md`); do it with a built binary + full fixtures. The `main` drift backstop also auto-files per-gate tickets (`20260808-main-drift-*-publication.md`).

Verified NOT stale (no action): `control-catalog` (114 entries, passes). Separately, the `guide` manifest drift is HEAD-commit-stamped (rebase-fragile) — tracked under the guide-freshness program; the LLP 0199 super-refine disposition recommends binding `reviewedCommit` to content, not HEAD.

## Not a correctness regression

The splits compile and their behavior is test-verified; this ticket is about restoring the frozen-record gates to green, not a functional defect.
