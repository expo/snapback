# Two fork-lane lib tests red on main — unclassified FORK_APP_BINDING diagnostics + admin coverage 500

**Status:** Open
**Opened:** 2026-08-06

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
