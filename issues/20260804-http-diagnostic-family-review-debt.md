# 125 diagnostics await HTTP-family review (recorded at fail-safe 500)

**Date:** 2026-08-04
**Status:** Open
**Area:** `src/server.rs` reviewed HTTP diagnostic table

## Problem

The s5_d10 drift oracle was red on main: recent landings registered 137
production diagnostics without HTTP-family review. Reconciled
2026-08-04: the 12 `SNAPBACK_RESULT_TRANSFORM_*` codes were classified
properly (400, authoring refusals, dormant feature — LLP 0166 §D7);
the remaining **125** are recorded in
`FAIL_SAFE_PENDING_FAMILY_REVIEW_DIAGNOSTICS` at their actual fail-safe
500. That list is an honest record of "defaulted, not reviewed" — it is
NOT a judgment that 500 fits each code.

## Owed, by owning lane

- `SNAPBACK_BRANCH_*`, `SNAPBACK_CHECKPOINT_*`, `SNAPBACK_FORK_*`,
  `SNAPBACK_HISTORY_*` — the instance-forking track (LLP 0158 family):
  many are plainly not server faults (`*_NOT_FOUND` → 404,
  `*_AUTHORITY_DENIED`/`*_AUTHORIZATION_DENIED` → 403, `*_INVALID`
  request shapes → 400, `*_BASE_NOT_CURRENT`/`*_HEAD_CHANGED` → 409).
- `SNAPBACK_OPERATION_*`, `SNAPBACK_PROMOTION_*`, `SNAPBACK_PROOF_*`,
  `SNAPBACK_HOST_INCARNATION_*`, `SNAPBACK_HOST_OPERATION_*` — the
  write-lane/settlement landings.

Each owning lane should move its codes from the fail-safe list into the
proper family (mapper arm + reviewed list together), with tests. Do not
add new codes to the fail-safe list — classify at landing.
