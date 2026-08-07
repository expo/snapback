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
| provisionalLifecycle | PASS | {"sameProjection":["filter","ordering","count","resource-relationship","React-list"],"alice":[{"identity":{"kind":"provisional","intentId":"mut_01kzbqtpd3en7s03515x48cyhw"},"fields":{"idempotencyKey":"intent:alice:room-00:slot-final","resourceKey":"room-00","slotKey":"slot-final","resourceSlotKey":"room-00\|slot-final","ownerId":"alice","title":"Alice final","createdAt":1787000000001},"resourceTitle":"Room 00"},{"identity":{"kind":"canonical","id":"reservations_01kzbqtpccf39rhxdnzws3nfme"},"fields":{"idempotencyKey":"baseline-canonical","resourceKey":"room-19","slotKey":"slot-final","resourceSlotKey":"room-19\|slot-final","ownerId":"observer","title":"Existing canonical reservation","createdAt":1787000000000},"resourceTitle":"Room 19"}],"bob":[{"identity":{"kind":"provisional","intentId":"mut_01kzbqtpddfpdb1cdydxwhqb25"},"fields":{"idempotencyKey":"intent:bob:room-00:slot-final","resourceKey":"room-00","slotKey":"slot-final","resourceSlotKey":"room-00\|slot-final","ownerId":"bob","title":"Bob final","createdAt":1787000000002},"resourceTitle":"Room 00"},{"identity":{"kind":"canonical","id":"reservations_01kzbqtpccf39rhxdnzws3nfme"},"fields":{"idempotencyKey":"baseline-canonical","resourceKey":"room-19","slotKey":"slot-final","resourceSlotKey":"room-19\|slot-final","ownerId":"observer","title":"Existing canonical reservation","createdAt":1787000000000},"resourceTitle":"Room 19"}],"inputToPaintMs":[10.427,9.591],"canonicalIdsForged":0,"parallelPendingCollections":0} |
| exactlyOneWinner | PASS | {"contenders":2,"committed":1,"rejected":1,"loserCode":"SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION","canonicalRowId":"reservations_01kzbqtpe9ejrasq44pt654n5v","winnerClientMutationId":"mut_01kzbqtpd3en7s03515x48cyhw","idMap":[{"speculative":"id_01kzbqtpd3fb7axd94gy3gyr4k","authoritative":"reservations_01kzbqtpe9ejrasq44pt654n5v","site":"plan/steps/0/insert/row-id","occurrence":0,"disposition":"mapped"}],"authoritativeSlotRows":1} |
| loserCorrection | PASS | {"loserClientMutationId":"mut_01kzbqtpddfpdb1cdydxwhqb25","retiredOnlyLosingLayer":true,"alternative":"room-01\|slot-final","aliceVisibleSlotRows":1,"bobVisibleSlotRows":1,"provisionalResidue":0} |
| retryIdempotence | PASS | {"clientMutationId":"mut_01kzbqtphdeerth307bzg3tvj8","wireAttempts":2,"replayed":1,"canonicalApplications":1,"originalResult":"reservations_01kzbqtphsft1tr274mb33y159","replayedResult":"reservations_01kzbqtphsft1tr274mb33y159","originalIdMap":[{"speculative":"id_01kzbqtphde6x9465z5g5kesdx","authoritative":"reservations_01kzbqtphsft1tr274mb33y159","site":"plan/steps/0/insert/row-id","occurrence":0,"disposition":"mapped"}],"replayedIdMap":[{"speculative":"id_01kzbqtphde6x9465z5g5kesdx","authoritative":"reservations_01kzbqtphsft1tr274mb33y159","site":"plan/steps/0/insert/row-id","occurrence":0,"disposition":"mapped"}],"exactProtocolIdentityReused":true} |
| nonoverlapSuccess | PASS | {"committed":2,"canonicalIds":["reservations_01kzbqtpgqfcsvrjgm4wzrhsgv","reservations_01kzbqtpgnfar85whsc2eqx3dq"],"resourceSlotKeys":["room-03\|slot-n","room-04\|slot-n"]} |
| observerConvergence | PASS | {"transport":"push","updates":4,"authoritativeRows":5,"signaturesEqual":true,"orderedResourceSlotKeys":["room-00\|slot-final","room-19\|slot-final","room-03\|slot-n","room-04\|slot-n","room-02\|slot-r"],"capacity":{"room-00\|slot-final":1}} |
| cleanup | PASS | {"owned":["four RQS clients","one live observer","one Snapback server","one SQLite database"],"serverAliveBeforeTeardown":true,"temporaryRoot":"snapback-contention-calendar-rung2-LFgc4E"} |
