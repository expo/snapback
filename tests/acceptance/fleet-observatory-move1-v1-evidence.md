# Fleet Observatory Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `8860d3fb269a35d424bd745b064d73bd793d6b29` (dirty lane worktree)
**Controlled run:** PASS
**Qualified server binary SHA-256:** `b0f1bbc37ba9426205472a084da2cf271ace6f594f1f534723316cd74073d258`
**Retained runtime-readiness receipt:** `tests/acceptance/fixtures/fleet-observatory/runtime-readiness.2026-08-06.v1.json` (SHA-256 `89acce26547fd299fa299db683d94d223df3faf93edcd9ab67727276eb75e5dc`)


This is the fresh Fleet successor receipt. It does not rewrite LLP 0138's
frozen evidence, flip the local-store carrier GAP, or change a capability row.
A BLOCKED row means the local sandbox denied a loopback socket; it is never
interpreted as a pass.

| # | Status | LLP 0157 Fleet gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"route":"fleetObservatory","screen":"demos/fleet-observatory-move1/src/App.tsx","generatedReadCount":1,"profile":"snapshot-batch.v2","nodeClasses":["relational_query_v1","bounded_children_v1"],"nodeTakes":[100,100],"parentAuthorizationGroups":1,"retention":"none","requiredCapabilities":["snapshot_batch_v2","relational_query_v1","bounded_children_v1"],"predecessorEvidenceRewritten":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"ownerClassification":{"profile":"snapshot-batch.v2","retention":"none"},"active":{"materializationRecords":21,"payloadBearingRecords":1,"compactedPredecessorStubs":20,"fragments":1,"topLevelEnvelopeRows":1,"projectedResultRows":200,"eventRows":100,"rollupRows":100,"logicalBytes":51027,"resultBytes":49652,"proofBytes":1375,"physicalCarrierBytes":129463},"released":{"materializationRecords":21,"payloadBearingRecords":0,"compactedInstanceBookkeepingStubs":21,"fragments":0,"retainedTopLevelRows":0,"retainedProjectedRows":0,"physicalCarrierBytes":48761},"activePolicy":{"addressKey":"qmk1.zx_0C-nQ56rDCQLrdMvS2AKytIMCPBtoaTcmPisEX6A","demandState":"demanded-active","effectiveRetentionRequest":"none","retainingReason":{"kind":"registrations","entries":[{"registrationId":"qreg1_64dd5cdd4d88891d81131fd50abb0edf","source":"active","ownerContextKind":"subscription"}]},"effectiveTtlClass":"default","compacted":false},"releasedPolicyReasons":{"instanceBookkeeping":21,"registrations":0,"releaseGrace":0,"safetyBlockers":0},"offlineRenderabilityAfterRelease":"unknown-render-nothing"} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":51,"eventRows":5000,"uniqueEventKeys":5000,"queryRanks":[0,4999],"continuationCount":50,"continuationFamily":"sbsb2","rollupRows":100} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["switch-00","switch-01","switch-02","switch-03","switch-04","switch-05","switch-06","switch-07","switch-08","switch-09","switch-10","switch-11","switch-12","switch-13","switch-14","switch-15","switch-16","switch-17","switch-18","switch-19"],"uniqueRows":20,"predecessorPayloadRecordsAfterMaintenance":0,"compactedInstanceBookkeepingStubs":20} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"sourceEventRows":250000,"updates":1000,"activeEventMatches":100,"activeRollupMatches":100,"serverSettlementMs":3892.461,"clientSettlementMs":3953.908,"liveFramesObserved":1} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedCompositeRows":0,"protectedSourceRows":0,"clientMaterializationRecords":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"transitions":[{"state":"unhydrated","addressPresent":false,"completeness":"unknown"},{"state":"active","answerClass":"authoritative","freshness":"current","projectedRows":200,"retainingReason":"registrations"},{"state":"released","completeness":"unknown","retainedProjectedRows":0,"retainingReason":"instance-bookkeeping","compacted":true}],"addressesExplained":21,"payloadBearingAddressesAfterRelease":0} |

## Footprint and hydration

The active volatile composite held 200
projected rows (100 event rows and
100 rollups) in
49652 result bytes plus
1375 proof bytes. Hydration installed
200 rows in 246.697 ms.
After final release and maintenance, retained projected rows were
0; all
21 addresses were
compacted bookkeeping stubs under retention:none.

Machine receipt:
`tests/acceptance/fixtures/fleet-observatory/move1-exit.2026-08-06.v1.json`

Budget freeze:
`tests/acceptance/fixtures/fleet-observatory/budget-freeze.2026-08-06.v1.json`
