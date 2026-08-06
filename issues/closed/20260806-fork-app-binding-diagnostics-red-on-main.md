# Two fork-lane lib tests red on main — unclassified FORK_APP_BINDING diagnostics + admin coverage 500

**Status:** Closed
**Opened:** 2026-08-06
**Resolved:** 2026-08-06

At origin/main 7ae7bd3d5 (verified with a clean tree), two lib tests fail:

- `server::tests::s5_d10_production_diagnostic_inventory_cannot_drift`
  (src/server.rs:42470): `SNAPBACK_FORK_APP_BINDING_MISMATCH` and
  `SNAPBACK_FORK_APP_BINDING_REQUIRED` are emitted in production but
  unclassified in the reviewed HTTP diagnostic table.
- `admin::tests::operation_coverage_activation_is_authenticated_exact_and_idempotent_in_prod`
  (src/admin.rs:6074): 500 where 200 expected.

Both trace to the fork-promotion / app-binding lane's recent landings (the
sbsb2/Fleet series predates them with a fully green 2,778-test run and
touches neither admin nor fork). The owner should classify the two
diagnostics in the reviewed table and fix or requalify the coverage
activation path.

Filed by the Move-1 closure session, which hit them as pre-existing red
while landing an unrelated series.

## 2026-08-06 wave-drift recheck

At combined proof revision `6dd113755596be98d2f91b22503db9fb251a5861`,
the admin coverage test is green, while
`server::tests::s5_d10_production_diagnostic_inventory_cannot_drift` remains
red with `SNAPBACK_FORK_APP_BINDING_MISMATCH`,
`SNAPBACK_FORK_APP_BINDING_REQUIRED`, and the newly observed
`SNAPBACK_FORK_WRITER_COVERAGE_GAP` unclassified. The wave-drift pass made no
fork correctness change; classification and requalification remain with the
actively owned fork/app-binding lane.

At exact, clean, runtime-qualified revision
`9ed3591ab69f71b0e33806eef3f75c63b77dc147`, both complete-proof F0a
acceptance gates also refuse during setup with
`SNAPBACK_FORK_APP_BINDING_MISMATCH`: `forked-parent` runs 0/4 checks and
`fork-parallel-dispositions` runs 0/7 checks. Each reports that the invoking
app root is already bound to a different canonical root or logical app id.
This is a deterministic owner-code failure rather than load sensitivity; the
wave-drift pass made no behavior change and leaves requalification with the
fork/app-binding lane.

## Resolution — 2026-08-06

The diagnostic inventory was real classification drift. Commit `1048d97d6`
classifies `SNAPBACK_FORK_APP_BINDING_MISMATCH`,
`SNAPBACK_FORK_APP_BINDING_REQUIRED`, and
`SNAPBACK_FORK_WRITER_COVERAGE_GAP` with the existing LLP 0158 server-invariant
500 class; the exact inventory test passes 1/1.

The two acceptance failures were not a reason to weaken the canonical-root
guard. Carrier regeneration commit `1eb88cc4c` had accidentally tracked
`demos/todo/.snapback/instance-fork-app-identity.v1.json` with an absolute path
to `/private/tmp/snapback-llp0184-phase3-20260806/demos/todo`. Every other
worktree therefore correctly refused that foreign binding. Commit `1e5260dd1`
removes the generated receipt from version control and ignores that precise
nested receipt family. At exact, clean, runtime-qualified revision
`1e5260dd1e6d820a542a49c1cbd72db18dc99cef`, `forked-parent` passes 4/4 and
`fork-parallel-dispositions` passes 7/7. The app-root binding remains
fail-closed as LLP 0158 and LLP 0185 require.
