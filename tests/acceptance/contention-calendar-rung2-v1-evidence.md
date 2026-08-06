# Contention Calendar write-rung-2 exit evidence

**Run date:** 2026-08-04

**Controlled run:** PASS

The frozen seven-check workload is transcribed without weakening. A sandbox
socket denial is BLOCKED and is never promoted to PASS.

| Frozen check | Receipt section | Status |
| --- | --- | --- |
| cc.provisional-render | provisionalLifecycle | PASS |
| cc.exactly-one-winner | exactlyOneWinner | PASS |
| cc.loser-correction | loserCorrection | PASS |
| cc.ambiguous-retry-idempotence | retryIdempotence | PASS |
| cc.nonoverlap-success | nonoverlapSuccess | PASS |
| cc.observer-convergence | observerConvergence | PASS |
| cc.cleanup | cleanup | PASS |

| Section | Status | Evidence |
| --- | --- | --- |
| sourceIdentity | PASS | {"generatedPlan":{"functionId":"contention-calendar:reserve","implementationHash":"sha256:f1b9530e4bf51e34e95c941fc68431d8d0fae6ef8b020d70e979ee51dca8f11f","operationHash":"sha256:dba3db1081810d35637cf6698bdeb245f7f03306c808216a956bc068ef94b2c0","activation":{"appId":"contention-calendar","bundleHash":"sha256:723adaa7771bac4c","inputsHash":"43800d9e818ee1b98b859dcaa79112a7a77339665f19ec8fd2f0ae389ab755c3","schemaHash":"sha256:5672641b4c4097ac","schemaVersion":"snapback.v0"},"steps":["Insert"],"declaredReads":[],"effectClass":"snapback.browser-ir.insert-get-guard-patch.v1","capabilityClass":"local-executable","mintSites":["plan/steps/0/insert/row-id"]},"candidateVerbOccurrences":{"AllocateSequence":0,"Delete":0,"Let":0},"applicationAuthoredDuplicateTransforms":0,"forgedBrandedIds":0,"frozenChecks":["cc.provisional-render","cc.exactly-one-winner","cc.loser-correction","cc.ambiguous-retry-idempotence","cc.nonoverlap-success","cc.observer-convergence","cc.cleanup"]} |
| provisionalLifecycle | PASS | {"sameProjection":["filter","ordering","count","resource-relationship","React-list"],"alice":[{"identity":{"kind":"provisional","intentId":"mut_01kzbn3jwmeb1rz0xf3xnxdw1v"},"fields":{"idempotencyKey":"intent:alice:room-00:slot-final","resourceKey":"room-00","slotKey":"slot-final","resourceSlotKey":"room-00\|slot-final","ownerId":"alice","title":"Alice final","createdAt":1787000000001},"resourceTitle":"Room 00"},{"identity":{"kind":"canonical","id":"reservations_01kzbn3jvwearbqetq9806yr89"},"fields":{"idempotencyKey":"baseline-canonical","resourceKey":"room-19","slotKey":"slot-final","resourceSlotKey":"room-19\|slot-final","ownerId":"observer","title":"Existing canonical reservation","createdAt":1787000000000},"resourceTitle":"Room 19"}],"bob":[{"identity":{"kind":"provisional","intentId":"mut_01kzbn3jwzek68bn0qbcsyv66p"},"fields":{"idempotencyKey":"intent:bob:room-00:slot-final","resourceKey":"room-00","slotKey":"slot-final","resourceSlotKey":"room-00\|slot-final","ownerId":"bob","title":"Bob final","createdAt":1787000000002},"resourceTitle":"Room 00"},{"identity":{"kind":"canonical","id":"reservations_01kzbn3jvwearbqetq9806yr89"},"fields":{"idempotencyKey":"baseline-canonical","resourceKey":"room-19","slotKey":"slot-final","resourceSlotKey":"room-19\|slot-final","ownerId":"observer","title":"Existing canonical reservation","createdAt":1787000000000},"resourceTitle":"Room 19"}],"inputToPaintMs":[10.598,9.406],"canonicalIdsForged":0,"parallelPendingCollections":0} |
| exactlyOneWinner | PASS | {"contenders":2,"committed":1,"rejected":1,"loserCode":"SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION","canonicalRowId":"reservations_01kzbn3jxwf11an434c9f5j7x7","winnerClientMutationId":"mut_01kzbn3jwmeb1rz0xf3xnxdw1v","idMap":[{"speculative":"id_01kzbn3jwmener4vkkzg8j7ery","authoritative":"reservations_01kzbn3jxwf11an434c9f5j7x7","site":"plan/steps/0/insert/row-id","occurrence":0,"disposition":"mapped"}],"authoritativeSlotRows":1} |
| loserCorrection | PASS | {"loserClientMutationId":"mut_01kzbn3jwzek68bn0qbcsyv66p","retiredOnlyLosingLayer":true,"alternative":"room-01\|slot-final","aliceVisibleSlotRows":1,"bobVisibleSlotRows":1,"provisionalResidue":0} |
| retryIdempotence | PASS | {"clientMutationId":"mut_01kzbn3k1bfvx9drxwwj8vbcng","wireAttempts":2,"replayed":1,"canonicalApplications":1,"originalResult":"reservations_01kzbn3k1qe9h90tf017y6cp3m","replayedResult":"reservations_01kzbn3k1qe9h90tf017y6cp3m","originalIdMap":[{"speculative":"id_01kzbn3k1bfgfty5zqg33mx37k","authoritative":"reservations_01kzbn3k1qe9h90tf017y6cp3m","site":"plan/steps/0/insert/row-id","occurrence":0,"disposition":"mapped"}],"replayedIdMap":[{"speculative":"id_01kzbn3k1bfgfty5zqg33mx37k","authoritative":"reservations_01kzbn3k1qe9h90tf017y6cp3m","site":"plan/steps/0/insert/row-id","occurrence":0,"disposition":"mapped"}],"exactProtocolIdentityReused":true} |
| nonoverlapSuccess | PASS | {"committed":2,"canonicalIds":["reservations_01kzbn3k0je1gt8049qkqfeje0","reservations_01kzbn3k0sfg8rggmwd7pv5bn6"],"resourceSlotKeys":["room-03\|slot-n","room-04\|slot-n"]} |
| observerConvergence | PASS | {"transport":"push","updates":4,"authoritativeRows":5,"signaturesEqual":true,"orderedResourceSlotKeys":["room-00\|slot-final","room-19\|slot-final","room-03\|slot-n","room-04\|slot-n","room-02\|slot-r"],"capacity":{"room-00\|slot-final":1}} |
| cleanup | PASS | {"owned":["four RQS clients","one live observer","one Snapback server","one SQLite database"],"serverAliveBeforeTeardown":true,"temporaryRoot":"snapback-contention-calendar-rung2-gun0SZ"} |
