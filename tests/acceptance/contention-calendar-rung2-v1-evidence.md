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
| sourceIdentity | PASS | {"generatedPlan":{"functionId":"contention-calendar:reserve","implementationHash":"sha256:f1b9530e4bf51e34e95c941fc68431d8d0fae6ef8b020d70e979ee51dca8f11f","operationHash":"sha256:b960da6ff95f120d6286008f24a36755184fe59b0dbc6b4f7aa394cf67d5407e","activation":{"appId":"contention-calendar","bundleHash":"sha256:1d59085d1b804d93","inputsHash":"368a047b3137d17005f2c6b8d408335b7857a788094548ce1ef552af2becdb9f","schemaHash":"sha256:d82b10f847f22b90","schemaVersion":"snapback.v0"},"steps":["Insert"],"declaredReads":[],"effectClass":"snapback.browser-ir.insert-get-guard-patch.v1","capabilityClass":"local-executable","mintSites":["plan/steps/0/insert/row-id"]},"candidateVerbOccurrences":{"AllocateSequence":0,"Delete":0,"Let":0},"applicationAuthoredDuplicateTransforms":0,"forgedBrandedIds":0,"frozenChecks":["cc.provisional-render","cc.exactly-one-winner","cc.loser-correction","cc.ambiguous-retry-idempotence","cc.nonoverlap-success","cc.observer-convergence","cc.cleanup"]} |
| provisionalLifecycle | PASS | {"sameProjection":["filter","ordering","count","resource-relationship","React-list"],"alice":[{"identity":{"kind":"provisional","intentId":"mut_01kzq86gczfmqs5z2s5nn37p90"},"fields":{"idempotencyKey":"intent:alice:room-00:slot-final","resourceKey":"room-00","slotKey":"slot-final","resourceSlotKey":"room-00\|slot-final","ownerId":"alice","title":"Alice final","createdAt":1787000000001},"resourceTitle":"Room 00"},{"identity":{"kind":"canonical","id":"reservations_01kzq86gc2fys984dpnn8sf8mr"},"fields":{"idempotencyKey":"baseline-canonical","resourceKey":"room-19","slotKey":"slot-final","resourceSlotKey":"room-19\|slot-final","ownerId":"observer","title":"Existing canonical reservation","createdAt":1787000000000},"resourceTitle":"Room 19"}],"bob":[{"identity":{"kind":"provisional","intentId":"mut_01kzq86gdcfk7s0tcsdp8k6sjf"},"fields":{"idempotencyKey":"intent:bob:room-00:slot-final","resourceKey":"room-00","slotKey":"slot-final","resourceSlotKey":"room-00\|slot-final","ownerId":"bob","title":"Bob final","createdAt":1787000000002},"resourceTitle":"Room 00"},{"identity":{"kind":"canonical","id":"reservations_01kzq86gc2fys984dpnn8sf8mr"},"fields":{"idempotencyKey":"baseline-canonical","resourceKey":"room-19","slotKey":"slot-final","resourceSlotKey":"room-19\|slot-final","ownerId":"observer","title":"Existing canonical reservation","createdAt":1787000000000},"resourceTitle":"Room 19"}],"inputToPaintMs":[12.771,10.096],"canonicalIdsForged":0,"parallelPendingCollections":0} |
| exactlyOneWinner | PASS | {"contenders":2,"committed":1,"rejected":1,"loserCode":"SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION","canonicalRowId":"reservations_01kzq86gebe398gr4qnkhmgem6","winnerClientMutationId":"mut_01kzq86gczfmqs5z2s5nn37p90","idMap":[{"speculative":"id_01kzq86gczfbws4z8w38kc9ct6","authoritative":"reservations_01kzq86gebe398gr4qnkhmgem6","site":"plan/steps/0/insert/row-id","occurrence":0,"disposition":"mapped"}],"authoritativeSlotRows":1} |
| loserCorrection | PASS | {"loserClientMutationId":"mut_01kzq86gdcfk7s0tcsdp8k6sjf","retiredOnlyLosingLayer":true,"alternative":"room-01\|slot-final","aliceVisibleSlotRows":1,"bobVisibleSlotRows":1,"provisionalResidue":0} |
| retryIdempotence | PASS | {"clientMutationId":"mut_01kzq86ggve4w99gkz6pf88v6s","wireAttempts":2,"replayed":1,"canonicalApplications":1,"originalResult":"reservations_01kzq86gh9eh0trz7npyemtkst","replayedResult":"reservations_01kzq86gh9eh0trz7npyemtkst","originalIdMap":[{"speculative":"id_01kzq86ggwe2g9x5k5j6ne7ghv","authoritative":"reservations_01kzq86gh9eh0trz7npyemtkst","site":"plan/steps/0/insert/row-id","occurrence":0,"disposition":"mapped"}],"replayedIdMap":[{"speculative":"id_01kzq86ggwe2g9x5k5j6ne7ghv","authoritative":"reservations_01kzq86gh9eh0trz7npyemtkst","site":"plan/steps/0/insert/row-id","occurrence":0,"disposition":"mapped"}],"exactProtocolIdentityReused":true} |
| nonoverlapSuccess | PASS | {"committed":2,"canonicalIds":["reservations_01kzq86gfters91cvb183xfmtt","reservations_01kzq86gfyf91a2fee91ax21n1"],"resourceSlotKeys":["room-03\|slot-n","room-04\|slot-n"]} |
| observerConvergence | PASS | {"transport":"push","updates":4,"authoritativeRows":5,"signaturesEqual":true,"orderedResourceSlotKeys":["room-00\|slot-final","room-19\|slot-final","room-03\|slot-n","room-04\|slot-n","room-02\|slot-r"],"capacity":{"room-00\|slot-final":1}} |
| cleanup | PASS | {"owned":["four RQS clients","one live observer","one Snapback server","one SQLite database"],"serverAliveBeforeTeardown":true,"temporaryRoot":"snapback-contention-calendar-rung2-iuolJJ"} |
