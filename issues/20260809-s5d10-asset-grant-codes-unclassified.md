# main red: s5_d10 — 8 D5(b) asset-grant codes unclassified (recurring pattern)

**Status:** Open
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
