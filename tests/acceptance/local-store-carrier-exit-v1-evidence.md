# LLP 0166 local-store carrier-exit v1 evidence

**Run date:** 2026-08-04

**Source revision:** `fd0c8a34f0d7cdd0d50cb50b4aa52252c633a18b` (dirty evidence worktree)

**Machine:** darwin/arm64, Node v25.9.0

This is the standards-real Move-2 carrier exit consumed by LLP 0157 and LLP
0166. Exhaustive S1-S8 semantics stay with the lane suites. A GAP below is an
explicit capability boundary, not a skipped success and not a capability
publication.

## Carrier legs

| Leg | Carrier | Status | Measured result or stable GAP reason |
| --- | --- | --- | --- |
| browser-terminate-relaunch | browser-indexeddb-v3 | PASS | relaunch-to-readable 2263.519 ms |
| two-tabs-one-profile | browser-indexeddb-web-locks-broadcastchannel | PASS | suppression true → false; undefined |
| file-process-terminate-relaunch | node-file-v3-outbox | PASS | 2 SIGKILL write-boundary cuts; allocator next 3 |
| retained-render-server-unreachable | live-backend-plus-node-file-v3 | PASS | {"serverBinary":"target/debug/snapback","serverBinarySha256":"e011714c1d821d41da2b0cda649158950bdb84519469c6f61fee8bc749d0b63a","launchRung":"configured","backendStoppedBeforeRelaunch":true,"activationPreparation":{"format":"snapback.composition-activation-preparation.v1","activationHash":"sha256:fc0ef75a2f730dd01f108301875d602b667cae198d7396ea33346f2bfe428017","sourceClass":"temporary-backend-source","next":"rerun Snapback codegen for this backend"},"generatedArtifactGraph":{"trustedActivationPresent":true,"directReferenceIdentity":true},"live":{"answerClass":"authoritative","freshness":"current","rows":[{"title":"proof-backed","authorName":"Ada"}],"retention":{"retainable":true,"code":null,"reason":null,"store":{"source":"injected","implementation":"file","durable":true,"reason":null}}},"relaunch":{"answerClass":"authoritative","freshness":"retained","rows":[{"authorName":"Ada","title":"proof-backed"}],"firstUpdate":null},"materialization":{"records":1,"qmk1":"qmk1.eC16lxHpQBJtDd3Z16A5dWSnoXb7hXkTbe1kEUx2m3s","freshness":"retained","fragments":1,"leaseCustody":1},"endToEndRenderedByPublicClient":true} |
| authority-logout | node-public-client-to-file-v3 | PASS | {"publicMethod":"SnapbackClient.authLogout","transitionParticipant":"AuthCoordinator.commitDurable","nodeLevelBridge":true,"pageLevelBridge":false,"wipeCallsDuringLogout":1,"retainedAndOutboxClearedBeforeAnonymousResume":true,"clientStoreIdPreserved":true,"allocatorHighWaterPreserved":true,"generationHighWatersPreserved":true,"fenceTombstoneBarrierHighWatersPreserved":true,"storeMetaPolicyProjectionCleared":true,"handleKeyRotated":true,"nextAllocatedQueryInstanceId":3,"siblingIdentityBlobs":{"before":2,"after":1},"destroyedSiblingReopenedWithFreshIdentity":true} |
| authority-user-switch | node-file-v3-multi-identity | PASS | {"blobsBefore":2,"blobsAfter":1,"wipingIdentityPreserved":true,"handleKeyRotated":true,"destroyedSiblingReopenedWithFreshIdentity":true} |
| authority-revocation | node-file-v3-materialization | PASS | {"effectiveDisposition":"quarantine","queryGeneration":2} |
| authority-lease-expiry | browser-indexeddb-v3-materialization | PASS | {"suppliedLeaseStatus":"expired","deleteAppliedAtRetainedBoot":true,"fragments":0,"renderedBytes":0} |
| authority-artifact-change | browser-indexeddb-v3-materialization | PASS | {"mismatchedTrustedActivation":true,"deleteAppliedAtRetainedBoot":true,"fragments":0,"renderedBytes":0} |
| authority-corrupt-store-recovery | node-file-v3 | PASS | {"refusal":"SNAPBACK_RQS_STORE_CORRUPT","ordinaryWipeRefused":true,"originalBytesSeenByBarrierHook":true,"storeIdentityRotated":true,"replacementFormat":"snapback-rqs-store-file.v3"} |
| authority-corrupt-store-recovery | browser-indexeddb-v3 | PASS | {"refusal":"SNAPBACK_RQS_STORE_CORRUPT","hookSawMalformed":true,"reset":{"reset":true,"previousClientStoreId":"browser-corrupt-predecessor","clientStoreId":"cs1_02020202020202020202020202020202"},"formatVersion":3} |
| authority-revocation | browser-indexeddb-v3-materialization | PASS | {"disposition":"delete","fragments":0,"renderedBytes":0} |
| bounded-custody-query-churn | node-file-v3 | PASS | 38804851 → 32506933 logical bytes in 219573.377 ms |
| bounded-custody-query-churn | browser-indexeddb-v3 | PASS | {"injectedLimits":{"byteCeiling":1048576,"recordCeiling":32,"fragmentCeiling":2},"committedRecords":6,"retainedPayloadRecords":2,"retainedFragments":2,"compactedStubs":4,"durableRegistrations":6,"compactionCount":4,"allocatorHighWater":6,"commits":[{"queryInstanceId":1,"registration":{"committed":true}},{"queryInstanceId":2,"registration":{"committed":true}},{"queryInstanceId":3,"registration":{"committed":true}},{"queryInstanceId":4,"registration":{"committed":true}},{"queryInstanceId":5,"registration":{"committed":true}},{"queryInstanceId":6,"registration":{"committed":true}}]} |
| footprint-hydration-triage | triage-graph-budget-freeze-v1 | PASS | {"applicationExists":true,"application":"demos/triage-graph","qualificationStatus":"PASS","measurements":{"materializations":21,"storedResultRows":120,"logicalBytes":48016,"hydrationAttempts":1,"hydrationRows":100,"hydrationPayloadBytes":14981,"hydrationElapsedMs":232.918,"hydrationCeilingMs":1000},"receipts":{"budgetFreeze":"tests/acceptance/fixtures/triage-graph/budget-freeze.2026-08-04.v1.json","budgetFreezeSha256":"1dbf954ae06038cc69c520a493de988be27ea5c2c31c3d3fd73bb9704422375d","move1Exit":"tests/acceptance/fixtures/triage-graph/move1-exit.2026-08-04.v1.json","move1ExitSha256":"5a66141c2dfd5a2e4fb8794fdb0f5fc64b24dfed35c128abc684cbdf5ac71dcf"}} |
| footprint-hydration-fleet | move-1-successor-app | GAP | SNAPBACK_CARRIER_EXIT_FLEET_SUCCESSOR_BLOCKED: the Move-1 Fleet application does not exist and remains blocked on LLP 0135 OQ5 relational-node admission |
| bundle-attribution | full-client-store-closure | PASS | {"artifact":"tests/acceptance/fixtures/local-persistent-store/bundle-attribution.2026-08-04.v1.json","minifiedBytes":587863,"measuredModuleOwnBytes":109880,"modules":9,"browserClosureQualification":{"status":"PASS","materializationStoreResolved":true,"resolved":true,"outputBytes":67449,"externalImports":[]}} |

## Bundle attribution

The attribution build uses the existing LLP 0145 esbuild/metafile method.
These are module-own minified bytes, not marginal deletion savings. The exact
browser closure resolves the shipped materialization store with no
`node:crypto` external.

| Store module | Minified module-own bytes | Source bytes |
| --- | ---: | ---: |
| `materialization-store` | 48,773 | 85,477 |
| `materialization-bridge` | 10,286 | 17,341 |
| `registration-ledger` | 15,039 | 29,141 |
| `demand-broker` | 15,139 | 28,871 |
| `store-policy` | 12,920 | 22,688 |
| `answer-classes` | 2,503 | 4,849 |
| `evaluation-floor` | 663 | 1,710 |
| `lease-convergence` | 1,407 | 3,346 |
| `rqs-store-meta` | 3,150 | 5,673 |

Full measured closure: 587,863
minified bytes, 162,178 gzip bytes,
132,259 Brotli bytes. The nine
store modules account for 109,880
module-own minified bytes.

## Receipt interpretation

- When the browser leg runs, process exit is attested by the shared
  Chrome lifecycle owner. The caller-owned profile is deleted only after both
  the SIGKILL-first and final browser process trees have exited. A partial run
  records browser rows as SKIPPED; it never converts them into GAPs.
- File crash cuts pause inside the real adapter at before-rename and
  after-rename/before-directory-sync boundaries, then kill the detached child
  process group with SIGKILL.
- The authority-logout row is a Node-level public bridge: it calls
  `SnapbackClient.authLogout`, observes the LLP 0059 participant's file-v3
  transition before anonymous resume, and checks the §D1 projection including
  pending-outbox destruction and sibling-identity sweeping. It is not a
  page-level browser leg.
- The retained-unreachable row is one end-to-end public-client sequence: the
  generated qmk1 reference establishes against this worktree's live backend,
  stores the P1 proof and complete lease custody, the owned backend process
  exits, and a newly constructed client projects authoritative-retained bytes
  from the same file-v3 identity while the endpoint is unreachable.
- Triage consumes the qualified successor application's frozen custody and
  hydration measurements. Fleet remains GAP exactly as LLP 0157's commission
  crosswalk says and still waits on LLP 0135 OQ5's relational-node successor.

Machine receipt: `tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-04.v1.json`

Bundle receipt: `tests/acceptance/fixtures/local-persistent-store/bundle-attribution.2026-08-04.v1.json`
