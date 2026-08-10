# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `1952d6f8ca72b239a199f99f4e5237f521842881` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.1wLjNnFcPSwbsBp2BCTmC74Ycv5-CVR6wuIqQfHKZpY"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.-pn4K9UeFp4D7x3Po3PQyEHAfNgC1FmeaJWwA1yQla8","qmk1.2_geTedi9WPKCn0ub8J_z9LsJqaK1ZCB9yqLzQ8SywM","qmk1.3cxJ1jmauj5Ct7ByVbbiMtwCElG7as2aKVArrWZ2ZHg","qmk1.4hRxstjYugA-4ilKVaMQqgqaBusEVxrDjnuw07GC5cI","qmk1.9LMrm37MtnqE0oHNo-4H1-ggNCo9XVhq16G3FLF2IqE","qmk1.TlMh1QE4mnsveTmDWjl1-MN7NtBWDC0-d-NP0idPrcg","qmk1.VojZRjK60IkvTRAtzRhQ8UgA1pkJEY03jP6PzbDC2OE","qmk1.W4D_Jpg2LglJXT5oK_iE6U6BgmH9ZlcDFII-TABA1dY","qmk1.aBdQEosT_yPyU0aaG0FJJAHzc1IKylJKCLyrqDs4vT0","qmk1.aWTJPw1Y8pHwMgfD26VU-Ml3dq3A4yAlLTkGaWG_-H4","qmk1.bDzV0l2fjC77wY5Zd_6RpR1Mzr1H3XWcQrtNyrXlUiQ","qmk1.da1hby5mNNa_JFIq9GRKGWxHTkaGFjkPVbPssghfAvA","qmk1.diRb1offjITq-u7ie7QZfLv7yN5xf6qKOmby_OWlzRU","qmk1.gAt_ieZkZWBIk33wVBZ1BMw3z5aGbpAzXA_I2fYtSm4","qmk1.j4fD5eXcyW99ogr0QpDMo6qqnGEgGPabtQ-CxfrnbhI","qmk1.mQ3P_vqVdKLMZDeabSburnN90aW-1QWEQErwQztR6iw","qmk1.qmkDtBFX547r5CZlWIGYMgZW-SlgNXOJZHMyh2S3GBo","qmk1.rrjIZSktnQO6CFIiUpnUTNNGOFi0u70yNlnNaGzvYXI","qmk1.tscQNsrk9ZiqLP8SmiHxv1aTqou7yEYw6XEhKPT0RCw","qmk1.wiWawNUNY60JbLeCrob5Wjn19c3pJVZ0ncYZWpfF-WE"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.1wLjNnFcPSwbsBp2BCTmC74Ycv5-CVR6wuIqQfHKZpY","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.1wLjNnFcPSwbsBp2BCTmC74Ycv5-CVR6wuIqQfHKZpY"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.-pn4K9UeFp4D7x3Po3PQyEHAfNgC1FmeaJWwA1yQla8","qmk1.2_geTedi9WPKCn0ub8J_z9LsJqaK1ZCB9yqLzQ8SywM","qmk1.3cxJ1jmauj5Ct7ByVbbiMtwCElG7as2aKVArrWZ2ZHg","qmk1.4hRxstjYugA-4ilKVaMQqgqaBusEVxrDjnuw07GC5cI","qmk1.9LMrm37MtnqE0oHNo-4H1-ggNCo9XVhq16G3FLF2IqE","qmk1.TlMh1QE4mnsveTmDWjl1-MN7NtBWDC0-d-NP0idPrcg","qmk1.VojZRjK60IkvTRAtzRhQ8UgA1pkJEY03jP6PzbDC2OE","qmk1.W4D_Jpg2LglJXT5oK_iE6U6BgmH9ZlcDFII-TABA1dY","qmk1.aBdQEosT_yPyU0aaG0FJJAHzc1IKylJKCLyrqDs4vT0","qmk1.aWTJPw1Y8pHwMgfD26VU-Ml3dq3A4yAlLTkGaWG_-H4","qmk1.bDzV0l2fjC77wY5Zd_6RpR1Mzr1H3XWcQrtNyrXlUiQ","qmk1.da1hby5mNNa_JFIq9GRKGWxHTkaGFjkPVbPssghfAvA","qmk1.diRb1offjITq-u7ie7QZfLv7yN5xf6qKOmby_OWlzRU","qmk1.gAt_ieZkZWBIk33wVBZ1BMw3z5aGbpAzXA_I2fYtSm4","qmk1.j4fD5eXcyW99ogr0QpDMo6qqnGEgGPabtQ-CxfrnbhI","qmk1.mQ3P_vqVdKLMZDeabSburnN90aW-1QWEQErwQztR6iw","qmk1.qmkDtBFX547r5CZlWIGYMgZW-SlgNXOJZHMyh2S3GBo","qmk1.rrjIZSktnQO6CFIiUpnUTNNGOFi0u70yNlnNaGzvYXI","qmk1.tscQNsrk9ZiqLP8SmiHxv1aTqou7yEYw6XEhKPT0RCw","qmk1.wiWawNUNY60JbLeCrob5Wjn19c3pJVZ0ncYZWpfF-WE"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.1wLjNnFcPSwbsBp2BCTmC74Ycv5-CVR6wuIqQfHKZpY","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
