# LLP 0166 local-store carrier-exit v1 evidence

**Run date:** 2026-08-06
**Source revision:** `c6a8be9699e6a8ca5b8f89eed14316588a963945` (dirty evidence worktree)
**Machine:** darwin/arm64, Node v24.18.0

This is the standards-real Move-2 carrier exit consumed by LLP 0157 and LLP
0166. Exhaustive S1-S8 semantics stay with the lane suites. A GAP below is an
explicit capability boundary, not a skipped success and not a capability
publication.

## Carrier legs

| Leg | Carrier | Status | Measured result or stable GAP reason |
| --- | --- | --- | --- |
| browser-terminate-relaunch | browser-indexeddb-v3 | PASS | relaunch-to-readable 1930.059 ms |
| two-tabs-one-profile | browser-indexeddb-web-locks-broadcastchannel | PASS | suppression true → false; undefined |
| file-process-terminate-relaunch | node-file-v3-outbox | PASS | 2 SIGKILL write-boundary cuts; allocator next 3 |
| retained-render-server-unreachable | live-backend-plus-node-file-v3 | PASS | {"serverBinary":"target/debug/snapback","serverBinarySha256":"9ffdeb303cfab181284ef242d8089ed172763f0429f3b3b9f8f312e2641e3727","launchRung":"configured","backendStoppedBeforeRelaunch":true,"activationPreparation":{"format":"snapback.composition-activation-preparation.v1","activationHash":"sha256:db55b22a44e29f0f1f55d719716443a003a84b0a33e528ebbff68dd2bcf4ac5a","sourceClass":"temporary-backend-source","next":"rerun Snapback codegen for this backend"},"generatedArtifactGraph":{"trustedActivationPresent":true,"directReferenceIdentity":true},"live":{"answerClass":"authoritative","freshness":"current","rows":[{"title":"proof-backed","authorName":"Ada"}],"retention":{"retainable":true,"code":null,"reason":null,"store":{"source":"injected","implementation":"file","durable":true,"reason":null}}},"relaunch":{"answerClass":"authoritative","freshness":"retained","rows":[{"authorName":"Ada","title":"proof-backed"}],"firstUpdate":null},"materialization":{"records":1,"qmk1":"qmk1.l-OlYrf8txj6dVnjWYTYzzi2JFKyaiJ2SBl0N2gMvKE","freshness":"retained","fragments":1,"leaseCustody":1},"endToEndRenderedByPublicClient":true} |
| authority-logout | node-public-client-to-file-v3 | PASS | {"publicMethod":"SnapbackClient.authLogout","transitionParticipant":"AuthCoordinator.commitDurable","nodeLevelBridge":true,"pageLevelBridge":false,"wipeCallsDuringLogout":1,"retainedAndOutboxClearedBeforeAnonymousResume":true,"clientStoreIdPreserved":true,"allocatorHighWaterPreserved":true,"generationHighWatersPreserved":true,"fenceTombstoneBarrierHighWatersPreserved":true,"storeMetaPolicyProjectionCleared":true,"handleKeyRotated":true,"nextAllocatedQueryInstanceId":3,"siblingIdentityBlobs":{"before":2,"after":1},"destroyedSiblingReopenedWithFreshIdentity":true} |
| authority-user-switch | node-file-v3-multi-identity | PASS | {"blobsBefore":2,"blobsAfter":1,"wipingIdentityPreserved":true,"handleKeyRotated":true,"destroyedSiblingReopenedWithFreshIdentity":true} |
| authority-revocation | node-file-v3-materialization | PASS | {"effectiveDisposition":"quarantine","queryGeneration":2} |
| authority-lease-expiry | browser-indexeddb-v3-materialization | PASS | {"suppliedLeaseStatus":"expired","deleteAppliedAtRetainedBoot":true,"fragments":0,"renderedBytes":0} |
| authority-artifact-change | browser-indexeddb-v3-materialization | PASS | {"mismatchedTrustedActivation":true,"deleteAppliedAtRetainedBoot":true,"fragments":0,"renderedBytes":0} |
| authority-corrupt-store-recovery | node-file-v3 | PASS | {"refusal":"SNAPBACK_RQS_STORE_CORRUPT","ordinaryWipeRefused":true,"originalBytesSeenByBarrierHook":true,"storeIdentityRotated":true,"replacementFormat":"snapback-rqs-store-file.v3"} |
| authority-corrupt-store-recovery | browser-indexeddb-v3 | PASS | {"refusal":"SNAPBACK_RQS_STORE_CORRUPT","hookSawMalformed":true,"reset":{"reset":true,"previousClientStoreId":"browser-corrupt-predecessor","clientStoreId":"cs1_02020202020202020202020202020202"},"formatVersion":3} |
| authority-revocation | browser-indexeddb-v3-materialization | PASS | {"disposition":"delete","fragments":0,"renderedBytes":0} |
| bounded-custody-query-churn | node-file-v3 | PASS | 38804851 → 32506933 logical bytes in 164422.869 ms |
| bounded-custody-query-churn | browser-indexeddb-v3 | PASS | {"injectedLimits":{"byteCeiling":1048576,"recordCeiling":32,"fragmentCeiling":2},"committedRecords":6,"retainedPayloadRecords":2,"retainedFragments":2,"compactedStubs":4,"durableRegistrations":6,"compactionCount":4,"allocatorHighWater":6,"commits":[{"queryInstanceId":1,"registration":{"committed":true}},{"queryInstanceId":2,"registration":{"committed":true}},{"queryInstanceId":3,"registration":{"committed":true}},{"queryInstanceId":4,"registration":{"committed":true}},{"queryInstanceId":5,"registration":{"committed":true}},{"queryInstanceId":6,"registration":{"committed":true}}]} |
| footprint-hydration-triage | triage-graph-budget-freeze-v1 | PASS | {"applicationExists":true,"application":"demos/triage-graph","qualificationStatus":"PASS","measurements":{"materializations":21,"storedResultRows":100,"logicalBytes":16205,"hydrationAttempts":1,"hydrationRows":100,"hydrationPayloadBytes":14981,"hydrationElapsedMs":204.494,"hydrationCeilingMs":1000},"receipts":{"budgetFreeze":"tests/acceptance/fixtures/triage-graph/budget-freeze.2026-08-06.v1.json","budgetFreezeSha256":"cdfaadf75d3b785cd8bf6852720e99cc38d965b1f54b51056916d0e95f0df998","move1Exit":"tests/acceptance/fixtures/triage-graph/move1-exit.2026-08-06.v1.json","move1ExitSha256":"1aa9ac369c26bad68c311add62cf78df7e82ff5696c86c64873175adfef0c8ba"}} |
| footprint-hydration-fleet | fleet-observatory-budget-freeze-v1 | PASS | {"applicationExists":true,"application":"demos/fleet-observatory-move1","qualificationStatus":"PASS","measurements":{"activeMaterializations":21,"activeProjectedRows":200,"activeLogicalBytes":51027,"releasedProjectedRows":0,"hydrationAttempts":1,"hydrationRows":200,"hydrationPayloadBytes":49652,"hydrationElapsedMs":176.866,"hydrationCeilingMs":1000},"receipts":{"budgetFreeze":"tests/acceptance/fixtures/fleet-observatory/budget-freeze.2026-08-06.v1.json","budgetFreezeSha256":"d35bd4140d0ae4e4d877f20f79992e7930e392c81ba87004b1530b7e87a01323","move1Exit":"tests/acceptance/fixtures/fleet-observatory/move1-exit.2026-08-06.v1.json","move1ExitSha256":"b5fee70b8ee9e23b5bc0e4ebc8ae4b105d52380e50702194f5322d661a74e009"}} |
| bundle-attribution | full-client-store-closure | PASS | {"artifact":"tests/acceptance/fixtures/local-persistent-store/bundle-attribution.2026-08-06.v1.json","minifiedBytes":778309,"measuredModuleOwnBytes":113125,"modules":9,"browserClosureQualification":{"status":"PASS","materializationStoreResolved":true,"resolved":true,"outputBytes":75477,"externalImports":[]}} |

## Bundle attribution

The attribution build uses the existing LLP 0145 esbuild/metafile method.
These are module-own minified bytes, not marginal deletion savings. The exact
browser closure resolves the shipped materialization store with no
`node:crypto` external.

| Store module | Minified module-own bytes | Source bytes |
| --- | ---: | ---: |
| `materialization-store` | 46,222 | 86,832 |
| `materialization-bridge` | 10,740 | 18,451 |
| `registration-ledger` | 19,286 | 38,537 |
| `demand-broker` | 15,730 | 30,790 |
| `store-policy` | 13,334 | 23,705 |
| `answer-classes` | 2,528 | 4,865 |
| `evaluation-floor` | 682 | 1,710 |
| `lease-convergence` | 1,407 | 3,346 |
| `rqs-store-meta` | 3,196 | 6,105 |

Full measured closure: 778,309
minified bytes, 214,900 gzip bytes,
172,316 Brotli bytes. The nine
store modules account for 113,125
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
- Triage and Fleet consume their qualified successor applications' frozen
  custody and hydration measurements. The retained Fleet receipt closes the
  final LLP 0157 Move-1 workload-exit row without changing capability maturity
  or adding a hosted/remote claim.

Machine receipt: `tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-06.v1.json`
Bundle receipt: `tests/acceptance/fixtures/local-persistent-store/bundle-attribution.2026-08-06.v1.json`
