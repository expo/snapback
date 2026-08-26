# Pre-existing guide-corpus + publication drift blocks a clean 0213 slice-B push

**Status:** Closed
**Opened:** 2026-08-10
**Area:** drift-gates / guide corpus / local-store-publication / generated demo artifacts
**Severity:** low (tracked; the landed feature is verified green)

## What

LLP 0213 slice B (derived-authority termination, egress gate, deferred-intent
provenance, completed rehearsal effects) is verified green: compiles; 18
rehearsal + 372 auth + jobs/push/watches tests pass; the only 2 `local::`
failures (`detached_mutation_binds_schema_and_app_generation_across_reload`,
`generated_demo_manifests_pass_the_effect_ceiling_subset_check`) are
**pre-existing on origin/main** (fail identically with the slice stashed).

Landing a fully green push is blocked by pre-existing main corpus debt, not by
this feature:

1. **guide corpus fails at baseline.** `scripts/check-guide.mjs` errors on
   missing demo generated artifacts not tracked at origin/main —
   `demos/competitive-checkpoint/.../startReply.args.schema.json`, todo-v2
   Contract outputs — and `./scripts/check-generated-artifacts` itself fails
   with `TRUSTED_COMPOSITION_ACTIVATION_INVALID` on `demos/latency-kanban`.
   `generate-guide-manifest.mjs` therefore "refuses to write over a failing
   corpus," so the guide MCP-resource shas cannot be refreshed to match this
   slice's diagnostics regen. The `guide` drift gate fails at baseline and is
   attribution-non-blocking.
2. **local-store-publication** will flag `crates/snapback/src/local.rs` again (it is in the
   hashed publication carrier; this slice adds provenance accessors). As with
   slice 1, a concurrent `chore(authorities): reconcile` is expected to
   re-measure and clear it automatically; if not, run
   `scripts/finalize-local-persistent-store-publication` once the
   triage-graph-move1 retained receipt is fresh.
3. **client-bundle-metrology** is separately baseline-stale (backstop ticket
   `issues/20260808-main-drift-client-bundle-metrology.md`).

## Landed with

`SNAPBACK_DRIFT_GATES_BYPASS=1` (loud), with the diagnostics registry
regenerated for the new `SNAPBACK_AUTH_REHEARSAL_EGRESS_REFUSED` code so the
diagnostics gate passes. Only the guide-manifest refresh is deferred (blocked
by #1).

## Fix

Clear the pre-existing demo/contract/composition artifact debt (owning
sessions), then run `generate-guide-manifest.mjs` to refresh MCP-resource shas
and `finalize-local-persistent-store-publication` to refresh the carrier;
close this ticket and any backstop tickets it references.

## Resolution

Closed 2026-08-26 (July/early-August leftover sweep) as **done / superseded**.

The named missing leaf
`demos/competitive-checkpoint/snapback/generated/operations/startReply.args.schema.json`
is now in tree. The todo-v2 / kanban activation debt closed in
`issues/closed/20260810-todo-v2-remote-service-stale-and-kanban-activation-stale.md`.
Later guide/publication reds are owned by D-1 tickets
(`issues/20260826-battery-guide-d74b7ca53e6e9454.md`,
`issues/20260826-main-drift-guide-29f9b9cb2b3651f0.md`,
`issues/20260825-battery-local-store-publication-3daaf301d85d6913.md`),
not by this 0213 slice-B landing note.
