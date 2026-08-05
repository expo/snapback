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
| sourceIdentity | PASS | {"generatedPlan":{"functionId":"contention-calendar:reserve","implementationHash":"sha256:f1b9530e4bf51e34e95c941fc68431d8d0fae6ef8b020d70e979ee51dca8f11f","operationHash":"sha256:75e9ddc6c6d601ae26ca8262c3d869c70db08b4372f6599a88b8c0f88c45790a","activation":{"appId":"contention-calendar","bundleHash":"sha256:c090746da9251574","inputsHash":"3989e4954d30583eea1d60a05251dab5ca3b755b9c5878695feda426897ebb5c","schemaHash":"sha256:553168120ed3092b","schemaVersion":"snapback.v0"},"steps":["Insert"],"declaredReads":[],"effectClass":"snapback.browser-ir.insert-get-guard-patch.v1","capabilityClass":"local-executable","mintSites":["plan/steps/0/insert/row-id"]},"candidateVerbOccurrences":{"AllocateSequence":0,"Delete":0,"Let":0},"applicationAuthoredDuplicateTransforms":0,"forgedBrandedIds":0,"frozenChecks":["cc.provisional-render","cc.exactly-one-winner","cc.loser-correction","cc.ambiguous-retry-idempotence","cc.nonoverlap-success","cc.observer-convergence","cc.cleanup"]} |
| provisionalLifecycle | PASS | {"sameProjection":["filter","ordering","count","resource-relationship","React-list"],"alice":[{"identity":{"kind":"provisional","intentId":"mut_01kz84qzpqe7zt12q2ds1batmf"},"fields":{"idempotencyKey":"intent:alice:room-00:slot-final","resourceKey":"room-00","slotKey":"slot-final","resourceSlotKey":"room-00\|slot-final","ownerId":"alice","title":"Alice final","createdAt":1787000000001},"resourceTitle":"Room 00"},{"identity":{"kind":"canonical","id":"reservations_01kz84qznhexgbdvhh2dd3k06z"},"fields":{"idempotencyKey":"baseline-canonical","resourceKey":"room-19","slotKey":"slot-final","resourceSlotKey":"room-19\|slot-final","ownerId":"observer","title":"Existing canonical reservation","createdAt":1787000000000},"resourceTitle":"Room 19"}],"bob":[{"identity":{"kind":"provisional","intentId":"mut_01kz84qzq7eaftragm6vzamk5w"},"fields":{"idempotencyKey":"intent:bob:room-00:slot-final","resourceKey":"room-00","slotKey":"slot-final","resourceSlotKey":"room-00\|slot-final","ownerId":"bob","title":"Bob final","createdAt":1787000000002},"resourceTitle":"Room 00"},{"identity":{"kind":"canonical","id":"reservations_01kz84qznhexgbdvhh2dd3k06z"},"fields":{"idempotencyKey":"baseline-canonical","resourceKey":"room-19","slotKey":"slot-final","resourceSlotKey":"room-19\|slot-final","ownerId":"observer","title":"Existing canonical reservation","createdAt":1787000000000},"resourceTitle":"Room 19"}],"inputToPaintMs":[15.139,12.908],"canonicalIdsForged":0,"parallelPendingCollections":0} |
| exactlyOneWinner | PASS | {"contenders":2,"committed":1,"rejected":1,"loserCode":"SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION","canonicalRowId":"reservations_01kz84qzrdesgrechdk1d31ht9","winnerClientMutationId":"mut_01kz84qzpqe7zt12q2ds1batmf","idMap":[{"speculative":"id_01kz84qzprf1sayp07m6watn4r","authoritative":"reservations_01kz84qzrdesgrechdk1d31ht9","site":"plan/steps/0/insert/row-id","occurrence":0,"disposition":"mapped"}],"authoritativeSlotRows":1} |
| loserCorrection | PASS | {"loserClientMutationId":"mut_01kz84qzq7eaftragm6vzamk5w","retiredOnlyLosingLayer":true,"alternative":"room-01\|slot-final","aliceVisibleSlotRows":1,"bobVisibleSlotRows":1,"provisionalResidue":0} |
| retryIdempotence | PASS | {"clientMutationId":"mut_01kz84qzvyf98rj2xwa1rapkry","wireAttempts":2,"replayed":1,"canonicalApplications":1,"originalResult":"reservations_01kz84qzwdf49v11f2njhx2dzb","replayedResult":"reservations_01kz84qzwdf49v11f2njhx2dzb","originalIdMap":[{"speculative":"id_01kz84qzvye9krckg8nb2yzgw0","authoritative":"reservations_01kz84qzwdf49v11f2njhx2dzb","site":"plan/steps/0/insert/row-id","occurrence":0,"disposition":"mapped"}],"replayedIdMap":[{"speculative":"id_01kz84qzvye9krckg8nb2yzgw0","authoritative":"reservations_01kz84qzwdf49v11f2njhx2dzb","site":"plan/steps/0/insert/row-id","occurrence":0,"disposition":"mapped"}],"exactProtocolIdentityReused":true} |
| nonoverlapSuccess | PASS | {"committed":2,"canonicalIds":["reservations_01kz84qztxeysbseyxj9cxfbrf","reservations_01kz84qzv2eds8gf8304kaw2k5"],"resourceSlotKeys":["room-03\|slot-n","room-04\|slot-n"]} |
| observerConvergence | PASS | {"transport":"push","updates":4,"authoritativeRows":5,"signaturesEqual":true,"orderedResourceSlotKeys":["room-00\|slot-final","room-19\|slot-final","room-03\|slot-n","room-04\|slot-n","room-02\|slot-r"],"capacity":{"room-00\|slot-final":1}} |
| cleanup | PASS | {"owned":["four RQS clients","one live observer","one Snapback server","one SQLite database"],"serverAliveBeforeTeardown":true,"temporaryRoot":"snapback-contention-calendar-rung2-8cRwjI"} |
