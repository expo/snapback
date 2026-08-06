# Fleet Observatory Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `8743cf3cce87e7c56c7751a4223c60446213c472` (dirty lane worktree)
**Controlled run:** BLOCKED

This is the fresh Fleet successor receipt. It does not rewrite LLP 0138's
frozen evidence, flip the local-store carrier GAP, or change a capability row.
A BLOCKED row means the local sandbox denied a loopback socket; it is never
interpreted as a pass.

| # | Status | LLP 0157 Fleet gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"route":"fleetObservatory","screen":"demos/fleet-observatory-move1/src/App.tsx","generatedReadCount":1,"profile":"snapshot-batch.v2","nodeClasses":["relational_query_v1","bounded_children_v1"],"nodeTakes":[100,100],"parentAuthorizationGroups":1,"retention":"none","requiredCapabilities":["snapshot_batch_v2","relational_query_v1","bounded_children_v1"],"predecessorEvidenceRewritten":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | BLOCKED | the client retains only desired bounded query results | {"controlledServerRun":false} |
| 3 | BLOCKED | pagination neither duplicates nor skips an untouched root | {"controlledServerRun":false} |
| 4 | BLOCKED | 20 query changes leak no predecessor rows | {"controlledServerRun":false} |
| 5 | BLOCKED | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"controlledServerRun":false} |
| 6 | BLOCKED | an implicit incomplete prefix is impossible to consume as complete | {"controlledServerRun":false} |
| 7 | BLOCKED | Mallory receives no protected source or result rows | {"controlledServerRun":false} |
| 8 | BLOCKED | inspection explains every retained row and completeness transition | {"controlledServerRun":false} |

## Footprint and hydration

No footprint was measured because the controlled server run was blocked by the sandbox.

Machine receipt:
`tests/acceptance/fixtures/fleet-observatory/move1-exit.2026-08-06.v1.json`

Budget freeze:
`tests/acceptance/fixtures/fleet-observatory/budget-freeze.2026-08-06.v1.json`
