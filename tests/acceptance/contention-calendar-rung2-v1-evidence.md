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
| sourceIdentity | PASS | {"generatedPlan":{"functionId":"contention-calendar:reserve","implementationHash":"sha256:f1b9530e4bf51e34e95c941fc68431d8d0fae6ef8b020d70e979ee51dca8f11f","operationHash":"sha256:29f08ccccc61afb445a3d46615d0f95692ab30b75c5df25be83ba6be19065af1","activation":{"appId":"contention-calendar","bundleHash":"sha256:8590a5c2fd5cc6e5","inputsHash":"8b114f8658a79e89c9a204f63f466284a13752f247adcac9179b23614ba2aa07","schemaHash":"sha256:452f084e7eaeb8ee","schemaVersion":"snapback.v0"},"steps":["Insert"],"declaredReads":[],"effectClass":"snapback.browser-ir.insert-get-guard-patch.v1","capabilityClass":"local-executable","mintSites":["plan/steps/0/insert/row-id"]},"candidateVerbOccurrences":{"AllocateSequence":0,"Delete":0,"Let":0},"applicationAuthoredDuplicateTransforms":0,"forgedBrandedIds":0,"frozenChecks":["cc.provisional-render","cc.exactly-one-winner","cc.loser-correction","cc.ambiguous-retry-idempotence","cc.nonoverlap-success","cc.observer-convergence","cc.cleanup"]} |
| provisionalLifecycle | PASS | {"sameProjection":["filter","ordering","count","resource-relationship","React-list"],"alice":[{"identity":{"kind":"provisional","intentId":"mut_01kz9pecfne50939gv93yv2ad2"},"fields":{"idempotencyKey":"intent:alice:room-00:slot-final","resourceKey":"room-00","slotKey":"slot-final","resourceSlotKey":"room-00\|slot-final","ownerId":"alice","title":"Alice final","createdAt":1787000000001},"resourceTitle":"Room 00"},{"identity":{"kind":"canonical","id":"reservations_01kz9pecetex88k030dgjx5x5y"},"fields":{"idempotencyKey":"baseline-canonical","resourceKey":"room-19","slotKey":"slot-final","resourceSlotKey":"room-19\|slot-final","ownerId":"observer","title":"Existing canonical reservation","createdAt":1787000000000},"resourceTitle":"Room 19"}],"bob":[{"identity":{"kind":"provisional","intentId":"mut_01kz9pecg1ejkt0fdm77t4dq1n"},"fields":{"idempotencyKey":"intent:bob:room-00:slot-final","resourceKey":"room-00","slotKey":"slot-final","resourceSlotKey":"room-00\|slot-final","ownerId":"bob","title":"Bob final","createdAt":1787000000002},"resourceTitle":"Room 00"},{"identity":{"kind":"canonical","id":"reservations_01kz9pecetex88k030dgjx5x5y"},"fields":{"idempotencyKey":"baseline-canonical","resourceKey":"room-19","slotKey":"slot-final","resourceSlotKey":"room-19\|slot-final","ownerId":"observer","title":"Existing canonical reservation","createdAt":1787000000000},"resourceTitle":"Room 19"}],"inputToPaintMs":[11.99,10.645],"canonicalIdsForged":0,"parallelPendingCollections":0} |
| exactlyOneWinner | PASS | {"contenders":2,"committed":1,"rejected":1,"loserCode":"SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION","canonicalRowId":"reservations_01kz9pech1ec8vjg2vsps0bb1r","winnerClientMutationId":"mut_01kz9pecfne50939gv93yv2ad2","idMap":[{"speculative":"id_01kz9pecfneepabqd99027xrg0","authoritative":"reservations_01kz9pech1ec8vjg2vsps0bb1r","site":"plan/steps/0/insert/row-id","occurrence":0,"disposition":"mapped"}],"authoritativeSlotRows":1} |
| loserCorrection | PASS | {"loserClientMutationId":"mut_01kz9pecg1ejkt0fdm77t4dq1n","retiredOnlyLosingLayer":true,"alternative":"room-01\|slot-final","aliceVisibleSlotRows":1,"bobVisibleSlotRows":1,"provisionalResidue":0} |
| retryIdempotence | PASS | {"clientMutationId":"mut_01kz9pecmve4rvnga922ewgp1k","wireAttempts":2,"replayed":1,"canonicalApplications":1,"originalResult":"reservations_01kz9pecn6emg9s01grbg1xcqk","replayedResult":"reservations_01kz9pecn6emg9s01grbg1xcqk","originalIdMap":[{"speculative":"id_01kz9pecmvfg5v0haag477bh59","authoritative":"reservations_01kz9pecn6emg9s01grbg1xcqk","site":"plan/steps/0/insert/row-id","occurrence":0,"disposition":"mapped"}],"replayedIdMap":[{"speculative":"id_01kz9pecmvfg5v0haag477bh59","authoritative":"reservations_01kz9pecn6emg9s01grbg1xcqk","site":"plan/steps/0/insert/row-id","occurrence":0,"disposition":"mapped"}],"exactProtocolIdentityReused":true} |
| nonoverlapSuccess | PASS | {"committed":2,"canonicalIds":["reservations_01kz9pecm5fjrth9xe010xjjf7","reservations_01kz9pecm2f3gvbmc8s32dm7cp"],"resourceSlotKeys":["room-03\|slot-n","room-04\|slot-n"]} |
| observerConvergence | PASS | {"transport":"push","updates":4,"authoritativeRows":5,"signaturesEqual":true,"orderedResourceSlotKeys":["room-00\|slot-final","room-19\|slot-final","room-03\|slot-n","room-04\|slot-n","room-02\|slot-r"],"capacity":{"room-00\|slot-final":1}} |
| cleanup | PASS | {"owned":["four RQS clients","one live observer","one Snapback server","one SQLite database"],"serverAliveBeforeTeardown":true,"temporaryRoot":"snapback-contention-calendar-rung2-2EEK8K"} |
