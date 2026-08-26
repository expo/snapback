# snapback-engine lib-test target red: missing seam test helpers (inherited)

**Status:** Open
**Opened:** 2026-08-25
**Systems:** Engine, Auth, Services

## Problem

`cargo test -p snapback-engine --lib --no-run` fails with 14 errors on
current main: `store_for_test`/`replace_store_for_test` missing on
`snapback_services::assets::AssetWidthPrepareTicketV1` and
`FinalizePrepareTicketV1` (13 sites), and `AdmissionLease::unmanaged`
missing (1 site). These reference test helpers narrowed/removed by the
2026-08-25 security wave (asset finalize-ticket owner binding, registration
lease graph binding, auth/service seam narrowing) without migrating every
engine-side test caller. Verified independent of unrelated worktree changes
(the errors' files are untouched by the verifying branch).

## Impact

The engine lib-test target cannot compile, so any new engine test rides a
red target until this clears — including the removed-member epoch-gate
delivery test added by the live-cutoff work, which compiles clean but
cannot execute.

## Wanted

Migrate the engine test callers to the narrowed seam APIs (or provide the
sanctioned test-support constructors), restoring the lib-test target;
then run the epoch-gate delivery test and record its first real result on
`issues/closed/20260825-familiar-removed-member-live-cutoff-leak.md`.
