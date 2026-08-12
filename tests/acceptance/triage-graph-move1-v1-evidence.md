# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `b92bcd412622d63300105883154ae767d5927401` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.e-URfm4CTyrquHG4RR2tfPtDqfzvKdfn7Qm_KO8YsW0"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.0R_wSnTHii0rTkumCT8d9VMnc6y50l4ERvH6aYYhivk","qmk1.2CvgLyuZBUR0-WPEhIOuybQ2HAnUD9hGqs4qBcto0RQ","qmk1.2PxPnx6dXsSNDx7LNfnusroJjOwctiMNa645ZRhy5mQ","qmk1.4-lCwJKmq5uGKuWt21-XPLsNCvi7GmztomX3nfW4WwE","qmk1.5rwQPuP0Ov4ot-jUZDXVLf7SggY5C7ons67uwbFnSq0","qmk1.7LsmwzZDMQHCD6shWmtbqQ51l9h7bO-CWohmsORISrA","qmk1.AQI31kIoJhQK0DJU7QkN6Mw5yUKKoA4QY3Z3PKJFtCo","qmk1.HSoEZjlLKGknWu6ltoygdGZOCnS6eEwAF1sbxRt1UXI","qmk1.OLQ_PGk6jAHxbkAI8WunFTUoKNUmFotAADcU6YBJ4rs","qmk1.TlRuNFCfM1gQcDu8yJn8nGUAkZrEZc0KrkJBbLx2jIw","qmk1.XFbSNMbpctLEfpohkHeqjsnZiREaASqDAORt4vsZSSY","qmk1.aUd5M04UdZwdComnKguI44ej2UwKzopuBnmYVJ2ZHfs","qmk1.cFGLLW22hSwAL98w_U38CW_K8vyj3lW1cZx3DuGVWQc","qmk1.eeY2M8k8-kOqS_HmEuV16KzrEIfroS57JLyZaaoXgCI","qmk1.fYzFILhCbYMuq90tJCfj1wGJg9PxCE6LuP2P6e7kTtc","qmk1.fsF_1trJ_GQMlucQcxA9nd2UuUAAWm1Ejx1x7pz0Xs8","qmk1.gBtpX_CvDMAhY_82ZIFwxtnZk7UacsFu0OXCP_FUo9A","qmk1.ih474m7Y72N_zE7hit1qh8eLkOpagySKU9xC8vnfqq4","qmk1.qZYZT_Rts9sXdsVsqIIW5pN7FUJy0Ah2cOuv6KWTqME","qmk1.xuYbSimo0qLM6aK60f6yuXzLKqFnSPI1OwoVtVvt9Eg"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.e-URfm4CTyrquHG4RR2tfPtDqfzvKdfn7Qm_KO8YsW0","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.e-URfm4CTyrquHG4RR2tfPtDqfzvKdfn7Qm_KO8YsW0"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.0R_wSnTHii0rTkumCT8d9VMnc6y50l4ERvH6aYYhivk","qmk1.2CvgLyuZBUR0-WPEhIOuybQ2HAnUD9hGqs4qBcto0RQ","qmk1.2PxPnx6dXsSNDx7LNfnusroJjOwctiMNa645ZRhy5mQ","qmk1.4-lCwJKmq5uGKuWt21-XPLsNCvi7GmztomX3nfW4WwE","qmk1.5rwQPuP0Ov4ot-jUZDXVLf7SggY5C7ons67uwbFnSq0","qmk1.7LsmwzZDMQHCD6shWmtbqQ51l9h7bO-CWohmsORISrA","qmk1.AQI31kIoJhQK0DJU7QkN6Mw5yUKKoA4QY3Z3PKJFtCo","qmk1.HSoEZjlLKGknWu6ltoygdGZOCnS6eEwAF1sbxRt1UXI","qmk1.OLQ_PGk6jAHxbkAI8WunFTUoKNUmFotAADcU6YBJ4rs","qmk1.TlRuNFCfM1gQcDu8yJn8nGUAkZrEZc0KrkJBbLx2jIw","qmk1.XFbSNMbpctLEfpohkHeqjsnZiREaASqDAORt4vsZSSY","qmk1.aUd5M04UdZwdComnKguI44ej2UwKzopuBnmYVJ2ZHfs","qmk1.cFGLLW22hSwAL98w_U38CW_K8vyj3lW1cZx3DuGVWQc","qmk1.eeY2M8k8-kOqS_HmEuV16KzrEIfroS57JLyZaaoXgCI","qmk1.fYzFILhCbYMuq90tJCfj1wGJg9PxCE6LuP2P6e7kTtc","qmk1.fsF_1trJ_GQMlucQcxA9nd2UuUAAWm1Ejx1x7pz0Xs8","qmk1.gBtpX_CvDMAhY_82ZIFwxtnZk7UacsFu0OXCP_FUo9A","qmk1.ih474m7Y72N_zE7hit1qh8eLkOpagySKU9xC8vnfqq4","qmk1.qZYZT_Rts9sXdsVsqIIW5pN7FUJy0Ah2cOuv6KWTqME","qmk1.xuYbSimo0qLM6aK60f6yuXzLKqFnSPI1OwoVtVvt9Eg"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.e-URfm4CTyrquHG4RR2tfPtDqfzvKdfn7Qm_KO8YsW0","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
