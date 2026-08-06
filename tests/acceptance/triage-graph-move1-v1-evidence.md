# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-04
**Source revision:** `236037bf3328d4edcb0b2e5b6ce7d17f35391c0a` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.Mio5pw0_1D2LXv7vDoiS8xWFt1NgPtE6qqpmQf4hs-k"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.-d27tv1wy4fVWAEoU-UwQHQJFmwzFRgb0nUqlpIAI1c","qmk1.-idJWC3SELJwVAy4dlOptXYoAc5gHx40_4ypef5iwG8","qmk1.351URr_x6LC1vkrI8S13dBM8R9vHyHHc1uJzXPUBARg","qmk1.7lEPnA9lXRWhak2jrkL5CvLtctJ-txTRUSQjldnFnOQ","qmk1.AV_1ouuQaKYz2YkET65evY7xIe8BpoDzNG7chACTF4g","qmk1.D-_pfHZ7MUFXYAaVosr5YENR2EgpSvhzZUncSUNnkEY","qmk1.FGmAJl3-dixQxS4gz3FnHdbLWddphxH40m4JriJOJrA","qmk1.KpWxBbpWU7JzNtfE5pc_gItKAZYPk-FLXe7WWIYDziM","qmk1.QjjN_4c7Pj4Ueli9Zarsh0k-Fgqz0mX4QC-NMMYqmIg","qmk1.Ub1JBudreOdFvzl5lcW5IWU1Ha40fDxhCS6nwOtNaMU","qmk1.aM5FmMbNLz_0p6XUqC282tCtKtPiDaIGBL7ZMczk9NY","qmk1.i-mSk4kYIVS9JiA3D9jpp26HGeM76MgLhwmxba8esbY","qmk1.khQKZpJQjtRVrwnH9CX1ybFHw_uPs-b7xbXiB2iDhvQ","qmk1.lc2yYbWz6nj6jo-SLb-sC5wuC8S8FnmMvKvxaLlQmFs","qmk1.nPONthrntC556tg4TnHSQxyDRo-YGx_oe8xEcR8Th00","qmk1.ooBWzYZa7OFvl0VwiDUKz_LEqlKMMbBZjLgET2keBNY","qmk1.qNq3hUQUrO05Nr1fuaT_qNVxUX_EtbWusoxEnRj_-Og","qmk1.qdRj4nYyg_GS1zmTLJbSlursD49SYXN0Hr9bQXQ7r5w","qmk1.tYoMpOOJMt_5P51QpNhgdudTSyAgwpTO3tjvCeUC25k","qmk1.vm5jqmC6YMnGnJExANlss3VAbktywrOjPz_OaeHw3OU"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.Mio5pw0_1D2LXv7vDoiS8xWFt1NgPtE6qqpmQf4hs-k","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.Mio5pw0_1D2LXv7vDoiS8xWFt1NgPtE6qqpmQf4hs-k"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.-d27tv1wy4fVWAEoU-UwQHQJFmwzFRgb0nUqlpIAI1c","qmk1.-idJWC3SELJwVAy4dlOptXYoAc5gHx40_4ypef5iwG8","qmk1.351URr_x6LC1vkrI8S13dBM8R9vHyHHc1uJzXPUBARg","qmk1.7lEPnA9lXRWhak2jrkL5CvLtctJ-txTRUSQjldnFnOQ","qmk1.AV_1ouuQaKYz2YkET65evY7xIe8BpoDzNG7chACTF4g","qmk1.D-_pfHZ7MUFXYAaVosr5YENR2EgpSvhzZUncSUNnkEY","qmk1.FGmAJl3-dixQxS4gz3FnHdbLWddphxH40m4JriJOJrA","qmk1.KpWxBbpWU7JzNtfE5pc_gItKAZYPk-FLXe7WWIYDziM","qmk1.QjjN_4c7Pj4Ueli9Zarsh0k-Fgqz0mX4QC-NMMYqmIg","qmk1.Ub1JBudreOdFvzl5lcW5IWU1Ha40fDxhCS6nwOtNaMU","qmk1.aM5FmMbNLz_0p6XUqC282tCtKtPiDaIGBL7ZMczk9NY","qmk1.i-mSk4kYIVS9JiA3D9jpp26HGeM76MgLhwmxba8esbY","qmk1.khQKZpJQjtRVrwnH9CX1ybFHw_uPs-b7xbXiB2iDhvQ","qmk1.lc2yYbWz6nj6jo-SLb-sC5wuC8S8FnmMvKvxaLlQmFs","qmk1.nPONthrntC556tg4TnHSQxyDRo-YGx_oe8xEcR8Th00","qmk1.ooBWzYZa7OFvl0VwiDUKz_LEqlKMMbBZjLgET2keBNY","qmk1.qNq3hUQUrO05Nr1fuaT_qNVxUX_EtbWusoxEnRj_-Og","qmk1.qdRj4nYyg_GS1zmTLJbSlursD49SYXN0Hr9bQXQ7r5w","qmk1.tYoMpOOJMt_5P51QpNhgdudTSyAgwpTO3tjvCeUC25k","qmk1.vm5jqmC6YMnGnJExANlss3VAbktywrOjPz_OaeHw3OU"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.Mio5pw0_1D2LXv7vDoiS8xWFt1NgPtE6qqpmQf4hs-k","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
