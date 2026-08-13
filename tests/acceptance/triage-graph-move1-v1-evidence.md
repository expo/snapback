# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `9fdced897cfbe426aefdb4b1d4f6c75700645779` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.K1rh5shDcFckSDtYXDhkLRrP4HNS3sNQq_OiUI-IiZk"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.4nPBNezILOB7Wr5RTwrA4uZVesvS_cjddbN64RvStqE","qmk1.5ERtZNT-1sj1zLwqdxEvJIajJ1PB9SIRm8hB15aK5rM","qmk1.8gPcppx_hgr_cgPyltW6GQGmNkcOP7_aH6Vh9omwEdE","qmk1.9kTvjQBTTGrFpVRNaHJ1Y309kry8Tg1nb_9j_ZopPIU","qmk1.AF1XyWMQyJDd7rfmgCzHms2T9VFvBo12scH3iiS0C3Q","qmk1.AWSlti3NFPY01RCdMm4rBaO63iPjhjvWnO_AcEYLnkU","qmk1.Hh6nMGJtedz41btVu5nZru4QMM8lyFRAq2n6y5Ibbzc","qmk1.KDRzYXiorq1CAEXx6HL_WEc9ynyc04nSaEBJ_kQ2_Mk","qmk1.V2hXpLPXL5P5uA0nsATDXu3m-Aj5D3cqUnY58TOjoSk","qmk1.ZZDgcwHR_UpOnBU6MG2mFcq0U07mLCkQ3Ctl4YVvSb0","qmk1.aJYDkWdZtrxcWWMht_skluuTcEtvKWROdOKpcn9zeOM","qmk1.huERhyXlVWTJW23g1ZcS58pn5AO3LNlC6IYrh1n8xGA","qmk1.jmlFH-HC-NaZ9rtNS1JNDqt5PBDIq267azV8ZgX6k0k","qmk1.lpPhRijYcECybH9CBgOkUM5z034P8uUkEu2gSINpbJE","qmk1.pWbv1rCEMmkPlB2PGC_7cJ1aJAgJN9iQ3di2BwfXwWU","qmk1.qHKzrEvjpUaycGQEIOSQwHMtnPtapoFy7nU1gVCKZNI","qmk1.sFvg5ZNSjV-TYquI4gyOrsxJcMhWuuvDIpypJHJ7vJ8","qmk1.wTULYrFqI4NKOU67nbTQB7C4qbT32f87ntcvAq8qjsc","qmk1.xqY-SAVnSOTit6CBzUw1IGnNeCzeyptNwZzGsNjpmQE","qmk1.y4ftgDoqd9ls2eATkFDQENa91aMZLivyvETV4lb7jV0"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.K1rh5shDcFckSDtYXDhkLRrP4HNS3sNQq_OiUI-IiZk","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.K1rh5shDcFckSDtYXDhkLRrP4HNS3sNQq_OiUI-IiZk"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.4nPBNezILOB7Wr5RTwrA4uZVesvS_cjddbN64RvStqE","qmk1.5ERtZNT-1sj1zLwqdxEvJIajJ1PB9SIRm8hB15aK5rM","qmk1.8gPcppx_hgr_cgPyltW6GQGmNkcOP7_aH6Vh9omwEdE","qmk1.9kTvjQBTTGrFpVRNaHJ1Y309kry8Tg1nb_9j_ZopPIU","qmk1.AF1XyWMQyJDd7rfmgCzHms2T9VFvBo12scH3iiS0C3Q","qmk1.AWSlti3NFPY01RCdMm4rBaO63iPjhjvWnO_AcEYLnkU","qmk1.Hh6nMGJtedz41btVu5nZru4QMM8lyFRAq2n6y5Ibbzc","qmk1.KDRzYXiorq1CAEXx6HL_WEc9ynyc04nSaEBJ_kQ2_Mk","qmk1.V2hXpLPXL5P5uA0nsATDXu3m-Aj5D3cqUnY58TOjoSk","qmk1.ZZDgcwHR_UpOnBU6MG2mFcq0U07mLCkQ3Ctl4YVvSb0","qmk1.aJYDkWdZtrxcWWMht_skluuTcEtvKWROdOKpcn9zeOM","qmk1.huERhyXlVWTJW23g1ZcS58pn5AO3LNlC6IYrh1n8xGA","qmk1.jmlFH-HC-NaZ9rtNS1JNDqt5PBDIq267azV8ZgX6k0k","qmk1.lpPhRijYcECybH9CBgOkUM5z034P8uUkEu2gSINpbJE","qmk1.pWbv1rCEMmkPlB2PGC_7cJ1aJAgJN9iQ3di2BwfXwWU","qmk1.qHKzrEvjpUaycGQEIOSQwHMtnPtapoFy7nU1gVCKZNI","qmk1.sFvg5ZNSjV-TYquI4gyOrsxJcMhWuuvDIpypJHJ7vJ8","qmk1.wTULYrFqI4NKOU67nbTQB7C4qbT32f87ntcvAq8qjsc","qmk1.xqY-SAVnSOTit6CBzUw1IGnNeCzeyptNwZzGsNjpmQE","qmk1.y4ftgDoqd9ls2eATkFDQENa91aMZLivyvETV4lb7jV0"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.K1rh5shDcFckSDtYXDhkLRrP4HNS3sNQq_OiUI-IiZk","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
