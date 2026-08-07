# guide-gap: teach snapshot-batch.v2 mixed composition after the Fleet witness

**Status:** Closed — absorbed into the guide 2026-08-07
**Opened:** 2026-08-06
**Related:** LLP 0157 §D4/§D8; `guide/backend/snapshot-batches.md`;
`guide/sync/offline-and-retention.md`;
`demos/fleet-observatory-move1`

The guide does not yet teach the landed `defineSnapshotBatchQuery` v2 authoring
surface. `guide/backend/snapshot-batches.md` is v1-only, and the offline page
still says the v2 implementation and frozen vectors are absent. LLP 0157 and
the landed local code now admit mixed bounded-children/relational tuples and
publish `snapshot_batch_v2` experimentally; Fleet's fresh workload witness is
the remaining application-evidence gate.

After the Fleet receipt lands, update the snapshot-batch page with the exact
mixed tuple surface, `sbsb2` continuation, joined-side work accounting, sealed
parent behavior, and `retention:"none"` limit. Reconcile the offline page's
checkpoint wording and regenerate the flat guide. Keep the local-only,
experimental, no-retained-composite, no-hosted/public-package boundaries, and
do not convert the guide edit into the separate carrier-GAP closure.

## Resolution (2026-08-07)

The gate was met: the Fleet Observatory workload witness is retained
(`tests/acceptance/fixtures/fleet-observatory/move1-exit.2026-08-06.v1.json`)
and the refreshed carrier exit is 17 PASS / 0 GAP / 0 skipped (LLP 0157
v0.11 status). Absorbed, based on origin/main f4d4d8c18:

- `guide/backend/snapshot-batches.md` now teaches the v2 surface: profile
  selection from node classes, a mixed-tuple section with CI-verified
  snippets from `packages/snapback-codegen/snapshot-batch-v2-authoring.test.mjs`
  and `demos/fleet-observatory-move1/snapback/functions.mjs`, the `sbsb2`
  continuation and cross-family refusal, sealed-parent vs visible-empty-join
  behavior, joined-side work accounting (one unique-index lookup per consumed
  root), the closed relational order-field budget rule, `retention:"none"`,
  capability acknowledgments, and an anti-patterns section. The experimental
  banner keeps the local-only / remote-service-GAP / no-public-package
  boundaries; no carrier GAP was closed.
- `guide/sync/offline-and-retention.md` checkpoint wording reconciled to the
  landed 17/0/0 carrier exit; the retention bullet now names both profiles.
- `guide/capabilities.md` `backend.snapshot-batch-v1` row extended to cover
  `snapshot_batch_v2` (aliases: mixed snapshot batch, sbsb2, join plus child
  lists, defineSnapshotBatchQuery; witness adds the manifest's
  `snapshot_batch_v2` entry) within the size budget.
- Flat guide and manifest regenerated.
