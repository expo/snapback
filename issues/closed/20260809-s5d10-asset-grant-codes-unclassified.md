# main red: s5_d10 — 8 D5(b) asset-grant codes unclassified (recurring pattern)

**Status:** Closed (2026-08-10)
**Severity:** P2
**Systems:** Diagnostics, Assets, Testing
**Date:** 2026-08-09

## Problem

`server::tests::s5_d10_production_diagnostic_inventory_cannot_drift`
fails at `979f3aab5`: the D5(b) grants landing added
`SNAPBACK_ASSET_GRANTS_UNDECLARED`, `SNAPBACK_ASSET_GRANT_CONFLICT`,
`SNAPBACK_ASSET_GRANT_FORBIDDEN`, `SNAPBACK_ASSET_GRANT_INPUT_INVALID`,
`SNAPBACK_ASSET_GRANT_QUOTA_EXCEEDED`, `SNAPBACK_ASSET_GRANT_STATE_INVALID`,
`SNAPBACK_ASSET_GRANT_UNKNOWN`, and `SNAPBACK_CTX_LEDGER_ID_KIND_MISMATCH`
without extending the reviewed HTTP tables.

This is the third instance today (rehearsal codes, then the 0211
landing's codes — both classified same-day). Pattern worth naming: the
reviewed-table step is not in most landings' checklists; consider adding
the s5_d10 suite to the fast/affected selection for any diff that
touches diagnostics-emitting code.

## Done when

The eight codes are classified and s5_d10 passes on main; optionally the
pattern fix (gate selection) is adopted or explicitly declined.

## Resolution (2026-08-10, LLP 0220 D2)

Classified before this closure: the D5(b) landing itself (`f706d11c8`)
carried the seven `SNAPBACK_ASSET_GRANT*` / `SNAPBACK_ASSET_GRANTS_UNDECLARED`
codes in the HTTP mapper (`src/server/api_error.rs` — INPUT_INVALID → 400,
FORBIDDEN → 403, UNKNOWN → 404, etc.), and the S5 Landing B commit
(`4a2123340`) extended the reviewed tables in `src/server/tests.rs`
(grant codes in their status classes; `SNAPBACK_CTX_LEDGER_ID_KIND_MISMATCH`
in `INTERNAL_SERVER_ERROR_DIAGNOSTICS`). Verified green at `79ac057b5`:
`cargo test s5_d10` — all four s5_d10 suites pass, including
`s5_d10_production_diagnostic_inventory_cannot_drift`.

The optional pattern fix (adding s5_d10 to the fast/affected selection for
diagnostics-emitting diffs) is **explicitly declined here**: all three
same-day instances were caught and fixed within the LLP 0189 cadence
(scheduled complete battery + fix-forward tickets), which is the governing
posture. If the pattern recurs after this note, reopen with a concrete gate
proposal to the drift-gate owners.
