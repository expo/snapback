# guide-gap: teach snapshot-batch.v2 mixed composition after the Fleet witness

**Status:** Open
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
