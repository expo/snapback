# main red: s5_d10 diagnostic inventory — 22 SNAPBACK_AUTH_REHEARSAL_* codes unclassified

**Status:** Open
**Severity:** P2 (one lib test red on main; drift scanner honest, table stale)
**Systems:** Diagnostics, Auth, Testing
**Date:** 2026-08-09

## Problem

`server::tests::s5_d10_production_diagnostic_inventory_cannot_drift`
fails on pristine main (`415507a4b`, verified in a clean worktree): the
LLP 0212 rehearsal-grants landing added 22 `SNAPBACK_AUTH_REHEARSAL_*`
production diagnostics that are absent from the reviewed HTTP
classification tables in `src/server/tests.rs` (api_error.rs carries
their status mapping; the reviewed inventory tables were not extended in
the same landing). The scanner is doing its job; the reviewed table is
stale.

Found during the LLP 0211 structured-stored-values landing verification
(whose own seven new codes are classified in both places by that
landing).

## Ask

The 0212/rehearsal owner classifies the 22 codes in the reviewed tables
(same landing conventions as api_error.rs already encodes), restoring
s5_d10 green. Mechanical; no behavior change.

## Done when

`cargo test --lib -- server::tests::s5_d10_production_diagnostic_inventory_cannot_drift`
passes on main.

## Resolution (2026-08-09)

The rehearsal codes were classified on main the same day (fleet
fix-forward); s5_d10 no longer reports them. The successor instance
(D5(b) asset-grant codes) is issues/20260809-s5d10-asset-grant-codes-unclassified.md.
