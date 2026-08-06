# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-04
**Source revision:** `7e42ea3e4bbf0a8da2e8c39d94b3f2e29aef1d45` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.VAc-YpUQ7gmURhgca8Rw1q3T-dNjqExmYedVDYO4b1M"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.1SUU6okxtU5EmojE7TY1gO_nxHXssetY1D8sDtOMeZ0","qmk1.8c_qiuUCtb25K-15b0aAHywi5WsrraXoz1ukwuoPqcw","qmk1.D3gfsI12mo9Wr6jBkQlmHpEj_wF8-bQoQ7IJ00ilfcg","qmk1.ESjsyT72mkF8pJuPoxwxylp7dLI5EfJfHkx7JPlSuyE","qmk1.FPhcoSwvRZblViY9fFuEBmpAfCEjyCTYgGWMY18ohAo","qmk1.HtXH25VLMuJc4gsFcoFdLzIRp5fbqrop0W5-VFRAdj0","qmk1.R8aMzH_OduQZhq1bZmuzhnWcNunosVC3NB1f1NYDxxQ","qmk1.VPc42BaJISQ8-2U46mRU8YlcI5rqtHNZ5j3l5ADROpg","qmk1.ZxzbJwx7f-EMJXFLHu7G617Y9jb3slSlC_I4EFqKvkk","qmk1.eJUxnaP7ae6yv2xSNgVc7eALAlLuHISNkRSMGgjRtd4","qmk1.fY7K3KM4WN9CIo45Rxhlhrr-YUuwj8fl2jj5784fqLk","qmk1.kMZG6ySTXrs4jSFnUU_hsL35BQRkl3Sd5OtWEA35174","qmk1.nkntzj7qRQtlGIL7uOKOcmZJkFOWiPG2LXpeNpMrwz4","qmk1.onUXromloKrZmU17LPawlodyijyA_3eTRJKm6Ol_q6U","qmk1.p6thG2mkHp01S7sFUuDeG_m-p-xBgxyQG1rV7AeErGE","qmk1.qMeBDvofISVtn_lx1hSJfUpg0gzD0qChIcvqCtEaBoI","qmk1.rXQLMcEiV9nosTEAmsfma12axWsTtXWf09VCMs0W2pQ","qmk1.sEeFO2GUQEshOkR_b95wKwDdoQ2Z4txhyyD1-PfVRXU","qmk1.y2e28R_3-_6FE6RQQR7o-W0PwcTAMzrrfGqr55IS2QM","qmk1.z894ppWCmNUKDPmUf-CSkc8VDdsxCNfDmsI_lGGAFXg"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.VAc-YpUQ7gmURhgca8Rw1q3T-dNjqExmYedVDYO4b1M","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.VAc-YpUQ7gmURhgca8Rw1q3T-dNjqExmYedVDYO4b1M"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.1SUU6okxtU5EmojE7TY1gO_nxHXssetY1D8sDtOMeZ0","qmk1.8c_qiuUCtb25K-15b0aAHywi5WsrraXoz1ukwuoPqcw","qmk1.D3gfsI12mo9Wr6jBkQlmHpEj_wF8-bQoQ7IJ00ilfcg","qmk1.ESjsyT72mkF8pJuPoxwxylp7dLI5EfJfHkx7JPlSuyE","qmk1.FPhcoSwvRZblViY9fFuEBmpAfCEjyCTYgGWMY18ohAo","qmk1.HtXH25VLMuJc4gsFcoFdLzIRp5fbqrop0W5-VFRAdj0","qmk1.R8aMzH_OduQZhq1bZmuzhnWcNunosVC3NB1f1NYDxxQ","qmk1.VPc42BaJISQ8-2U46mRU8YlcI5rqtHNZ5j3l5ADROpg","qmk1.ZxzbJwx7f-EMJXFLHu7G617Y9jb3slSlC_I4EFqKvkk","qmk1.eJUxnaP7ae6yv2xSNgVc7eALAlLuHISNkRSMGgjRtd4","qmk1.fY7K3KM4WN9CIo45Rxhlhrr-YUuwj8fl2jj5784fqLk","qmk1.kMZG6ySTXrs4jSFnUU_hsL35BQRkl3Sd5OtWEA35174","qmk1.nkntzj7qRQtlGIL7uOKOcmZJkFOWiPG2LXpeNpMrwz4","qmk1.onUXromloKrZmU17LPawlodyijyA_3eTRJKm6Ol_q6U","qmk1.p6thG2mkHp01S7sFUuDeG_m-p-xBgxyQG1rV7AeErGE","qmk1.qMeBDvofISVtn_lx1hSJfUpg0gzD0qChIcvqCtEaBoI","qmk1.rXQLMcEiV9nosTEAmsfma12axWsTtXWf09VCMs0W2pQ","qmk1.sEeFO2GUQEshOkR_b95wKwDdoQ2Z4txhyyD1-PfVRXU","qmk1.y2e28R_3-_6FE6RQQR7o-W0PwcTAMzrrfGqr55IS2QM","qmk1.z894ppWCmNUKDPmUf-CSkc8VDdsxCNfDmsI_lGGAFXg"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.VAc-YpUQ7gmURhgca8Rw1q3T-dNjqExmYedVDYO4b1M","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

## Frozen budgets

Custody freezes at 21 materializations,
1 fragments, 100 stored result rows
(100 authoritative-retained), and
16205 logical bytes. Hydration freezes at
1 attempt, 100 rows,
14981 payload bytes, and 1000 ms.

The budget fixture is
`tests/acceptance/fixtures/triage-graph/budget-freeze.2026-08-04.v1.json` and is
the reason-based input to LLP 0166 OQ4's measured revision. This evidence alone
never publishes a capability.
