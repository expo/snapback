# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `d201b359f6b303c1b659a602883fa7a75e2385ce` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.uy32LYRMRxrkWXAmApGagOsV9F84KsK8Fn05WHcEe_w"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.8CMHH95_0BYbe-pUVwQyu6P5_9rfIlKUa52N0raY2Zk","qmk1.AMWrBTACDPyo0-t2lYKeVkDtldJ9E3ZmORX0ZWsmb78","qmk1.COVLFIIF3Ks44Hi-PAA3ojzYc240_VW5R4wzNYyE0B0","qmk1.DQb1azel6bPh_zDYu1xTVAuTIVCfBgLNrCSzmPel6Ss","qmk1.GR6zi9p7OSs6zr2D9rUzEOG79k2juToHZH-3LZ1mKv8","qmk1.V-cCHu99QY59UZllAJwZqo1nua6f1bDwezfyrB-dljc","qmk1.XzzdgCuMHmzLB31OHN-eW6mAOzeOBrCQCD20aLuZKgI","qmk1.YbP_i-NBviJE1JNhJMbdt3XpO_RWEyrSEWVs-mdtBa0","qmk1.Zx0pfQSz0o6NZJIrBrU3bukFkBVbZD0XTmmCqAV7h3Q","qmk1.hBbz0ZLrTCXDVoyuAFHHdr9zv1vywlnd-wJY_eP5jcQ","qmk1.iH4Oqkv-dL8AIp9Z7zwuaP12vgOmpeqI7ubEzcPHAg4","qmk1.k2LEPq7x8woFU4Ok0VKcHRbpcMZk5KqzdEm8oOtPr3c","qmk1.nzrnZ7TwE_QayPspAcHMJfH9n5W9Vzj-OEJLhZk5UcA","qmk1.o5-x5luWfRrDd3mbQnNgYwIcY2EKXKVaL74u8XZYxIE","qmk1.oR1QjueLI66mrNuo8kTd0HGS_YKsDGWsBmRLRpxPKSU","qmk1.pkUxA9C0WhG4GAQ2chifh8slZ8a9akViKXl4uD3RA1g","qmk1.q2le6yqfX9hdXjOCj6tJwaM8rVb-95xM0Erk2IIs5Zw","qmk1.qsYPZs_wxXZiDKoFafdk9xIFdi_HVe-pZpDLnJkyvSo","qmk1.s93P5Af0cQ6JjBNPnxdjBsOy5PK3ra85WWROrbDxVb4","qmk1.wNjS5jubh3wWmasYXIMBXfFFXQz2aReN1ZQkm7yT9iI"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.uy32LYRMRxrkWXAmApGagOsV9F84KsK8Fn05WHcEe_w","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.uy32LYRMRxrkWXAmApGagOsV9F84KsK8Fn05WHcEe_w"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.8CMHH95_0BYbe-pUVwQyu6P5_9rfIlKUa52N0raY2Zk","qmk1.AMWrBTACDPyo0-t2lYKeVkDtldJ9E3ZmORX0ZWsmb78","qmk1.COVLFIIF3Ks44Hi-PAA3ojzYc240_VW5R4wzNYyE0B0","qmk1.DQb1azel6bPh_zDYu1xTVAuTIVCfBgLNrCSzmPel6Ss","qmk1.GR6zi9p7OSs6zr2D9rUzEOG79k2juToHZH-3LZ1mKv8","qmk1.V-cCHu99QY59UZllAJwZqo1nua6f1bDwezfyrB-dljc","qmk1.XzzdgCuMHmzLB31OHN-eW6mAOzeOBrCQCD20aLuZKgI","qmk1.YbP_i-NBviJE1JNhJMbdt3XpO_RWEyrSEWVs-mdtBa0","qmk1.Zx0pfQSz0o6NZJIrBrU3bukFkBVbZD0XTmmCqAV7h3Q","qmk1.hBbz0ZLrTCXDVoyuAFHHdr9zv1vywlnd-wJY_eP5jcQ","qmk1.iH4Oqkv-dL8AIp9Z7zwuaP12vgOmpeqI7ubEzcPHAg4","qmk1.k2LEPq7x8woFU4Ok0VKcHRbpcMZk5KqzdEm8oOtPr3c","qmk1.nzrnZ7TwE_QayPspAcHMJfH9n5W9Vzj-OEJLhZk5UcA","qmk1.o5-x5luWfRrDd3mbQnNgYwIcY2EKXKVaL74u8XZYxIE","qmk1.oR1QjueLI66mrNuo8kTd0HGS_YKsDGWsBmRLRpxPKSU","qmk1.pkUxA9C0WhG4GAQ2chifh8slZ8a9akViKXl4uD3RA1g","qmk1.q2le6yqfX9hdXjOCj6tJwaM8rVb-95xM0Erk2IIs5Zw","qmk1.qsYPZs_wxXZiDKoFafdk9xIFdi_HVe-pZpDLnJkyvSo","qmk1.s93P5Af0cQ6JjBNPnxdjBsOy5PK3ra85WWROrbDxVb4","qmk1.wNjS5jubh3wWmasYXIMBXfFFXQz2aReN1ZQkm7yT9iI"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.uy32LYRMRxrkWXAmApGagOsV9F84KsK8Fn05WHcEe_w","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

## Frozen budgets

Custody freezes at 21 materializations,
1 fragments, 100 stored result rows
(100 authoritative-retained), and
16205 logical bytes. Hydration freezes at
1 attempt, 100 rows,
14981 payload bytes, and 1000 ms.

The budget fixture is
`tests/acceptance/fixtures/triage-graph/budget-freeze.2026-08-06.v1.json` and is
the reason-based input to LLP 0166 OQ4's measured revision. This evidence alone
never publishes a capability.
