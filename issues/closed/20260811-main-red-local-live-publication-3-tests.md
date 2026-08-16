# main red: 3 local:: live-publication assertion failures (not catalog-v3)

**Status:** Open
**Date:** 2026-08-11
**Systems:** local, realtime/live queries, testing

On current origin/main, `cargo test --lib 'local::'` (no DYLD) fails 3
assertion-only tests (NOT SQLite/catalog-v3 constraints):

- `local::tests::data_only_same_mode_seed_refreshes_auth_scoped_live_before_reopening`
- `local::tests::quarantined_resubscribe_stays_fail_closed_until_accepted_authority_proof`
- `local::tests::same_mode_sessions_activation_projects_live_successor_before_reopening`

They fail live-publication assertions. History: introduced/changed by realtime
work after LLP 0214 — `308414f8d` (fix(local,server): sessions live updates
send one frame per subscription per commit version) last touched
`src/local/tests.rs`, and `same_mode_sessions_activation_...` came in with the
0199 `1a219c5c3` local.rs split. NOT caused by the LLP 0213/0214/0215 auth
landings or the catalog-v3 fixture fix (they reproduce with those stashed).

Owner: the realtime/live-updates + 0199 local-split authors. Filing for
main-red tracking (LLP 0225) since no ticket existed.

## Resolution — 2026-08-15 (backlog sweep)

These were stale live-publication assertions after retained authorization
became the sole frame source (LLP 0094). The three named `local::tests::*`
cases now project successor snapshots at the delivery boundary and no longer
expect unfenced live deltas. `issues/20260812-round2-lib-red-environment-classification.md`
records them as real inventory that was fixed; the original main-red tracker
is obsolete.
