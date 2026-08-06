# Fleet Observatory Move-1

Fresh LLP 0157 Move-1 successor backend. The required `fleetObservatory`
route is one generated `snapshot-batch.v2` tuple:

1. `latestEventsWithVehicles` is a bounded owner-visible relational window
   joining the latest 100 active events to unique protected vehicle/owner
   facts; and
2. `vehicleRollupPage` is a bounded child page of 100 per-vehicle rollups.

The tuple is consumed directly. No JavaScript query handler joins result
collections, and the profile's owner-fixed retention posture is `none`.
`src/App.tsx` also consumes exactly that one generated reference through the
React client: the event cards use the relational node's already-joined vehicle
and owner fields, while the rollup list reads the bounded-child node.

`fixture.mjs` deterministically generates 25,000 vehicle facts, 250,000
events, a 1,000-update burst with exactly 100 active-query matches, and 20
query-change sentinels. The predecessor LLP 0138 bakeoff manifests and receipts
remain immutable; `workload-manifest.2026-08-06.v1.json` records the fresh
successor decision.

Generate and test the backend:

```sh
node packages/snapback-codegen/index.mjs demos/fleet-observatory-move1/snapback
npm test --prefix demos/fleet-observatory-move1
npm run typecheck --prefix demos/fleet-observatory-move1
npm run build --prefix demos/fleet-observatory-move1
```

The trusted composition activation and dated workload receipt are produced by
`tests/acceptance/fleet-observatory-move1-v1.mjs`. Re-verify the latest retained
receipt with its `--check` mode. The evidence is input to a separate carrier-GAP
closure commit; this demo does not flip that row or any capability claim.
