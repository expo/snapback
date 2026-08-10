# Triage Graph

Fresh LLP 0155/0157 Move-1 successor application. The online screen consumes
the generated `triageGraph` snapshot batch directly. The relaunch screen uses
the separate generated `retainedInbox` relational query because LLP 0166
classifies snapshot-batch custody as volatile and the owner-scoped relational
profile as lease-authorized-retainable.

The deterministic controlled workload is pinned in
`workload-manifest.2026-08-03.v1.json`: 249,000 baseline events plus a 1,000
update burst, exactly 100 active matches, 50-row pagination, 20 query changes,
and no Fleet workload. Generate with
`node ../../demos/_kit/codegen.mjs snapback`; only `generated/artifacts.json`
is committed under the repository's manifest-only generated-artifact policy.

The UI accepts an email code and a seeded board id. `Open and retain` opens the
volatile graph and the authoritative retained companion, then installs P3's
durable programmatic registration through the isolated OQ8 seam. On a later
unreachable relaunch, only the custody inbox may render as
`authoritative / retained`; the online graph remains unavailable/unknown.

Run the demo checks with `npm test --prefix demos/triage-graph`; run the full
workload and retained receipt with
`node tests/acceptance/triage-graph-move1-v1.mjs` and verify it later with
`node tests/acceptance/triage-graph-move1-v1.mjs --check`.

Not claiming: Fleet exit, snapshot-batch retained execution, public durable-
registration authoring, or any capability/LLP status change.
