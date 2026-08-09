# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `6915f2fe318f40ca06e4c4ce73b9b1e82abd98f3` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.PV2z0pEYdNcuyvqhsIO64I2i0mA22_RN-f23_I8VAOk"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.5aQShJQ0bbEwZa-mkU9_OaLQhM0WQ2I81TmrHZZVEYM","qmk1.6myn3qFQc5kBXQhKdWLNrb7oHGMRgPy__YEQ3EzSWBU","qmk1.7FP0jtitPPtXSOHf1HhMkCpkZGnuBm0fxR6g2XpuMfc","qmk1.9DOSZgSFxO_4G3efENKlyxxjlBnRxskXhlxjULfgbm8","qmk1.9xvwgibqEubYZkiy19XwrOjOCoDjwLdHiCO5oc-97-g","qmk1.AAj8XZjgRZXRdsjIELxI93CvDOLpy6RNzwqtxfX4nxY","qmk1.AhHdhbd4It70VvK0Ob9FDiBcN1mpGdeu78dI1SaMKp4","qmk1.CVeeUGijZn5u5g67hrUelHtRi4istXRoz8JGPn4k4PE","qmk1.NUIoYWpxN_2RY33a84ynqJlWVVsfln9l7jdrk044CC4","qmk1.SCkez9OZ-aim6tjG4If40Bt5_p1P0Gum9qVUu2Br444","qmk1.Sby3Zk8f95oecZWj47kAsTuvpt28F6TYUb1lQ3e7qcY","qmk1.Um2Vq7wVFOTJC2Nl1VGs5-JOLqqhEUBOFbeHS4Cm0VM","qmk1.VTGCmNQiQMxs5EHGhePvvJxCzcVRX_sG8lDZ3egeAQY","qmk1.WzvBVdOtaev6I8dWMUh6HdZC3wfA61uDM_eN9WZzPnE","qmk1.dPWg7fjb0TUNBcubXq6Mh10nPoS8LUbg9B8sZvfuwcY","qmk1.iPLmz_4DFS47vyU_zpei88c2qlDws2RgSdtG-17UJbE","qmk1.kwOYj4FbBeRoOpllBn23lh2SAyHxRodpjxHfLi_roo8","qmk1.mL1LPn0ya_cH4LnG9MdAsES4rYGHlFAyd7S3BhVGIHQ","qmk1.o7gsw7Do0dQUV5NhR4xIe5QcAyWYwQjqr0RhlDqsIGU","qmk1.raH7t_Nrvp4_m71JmGDHw-FG3QWjMWNUuvQRxjpfONo"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.PV2z0pEYdNcuyvqhsIO64I2i0mA22_RN-f23_I8VAOk","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.PV2z0pEYdNcuyvqhsIO64I2i0mA22_RN-f23_I8VAOk"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.5aQShJQ0bbEwZa-mkU9_OaLQhM0WQ2I81TmrHZZVEYM","qmk1.6myn3qFQc5kBXQhKdWLNrb7oHGMRgPy__YEQ3EzSWBU","qmk1.7FP0jtitPPtXSOHf1HhMkCpkZGnuBm0fxR6g2XpuMfc","qmk1.9DOSZgSFxO_4G3efENKlyxxjlBnRxskXhlxjULfgbm8","qmk1.9xvwgibqEubYZkiy19XwrOjOCoDjwLdHiCO5oc-97-g","qmk1.AAj8XZjgRZXRdsjIELxI93CvDOLpy6RNzwqtxfX4nxY","qmk1.AhHdhbd4It70VvK0Ob9FDiBcN1mpGdeu78dI1SaMKp4","qmk1.CVeeUGijZn5u5g67hrUelHtRi4istXRoz8JGPn4k4PE","qmk1.NUIoYWpxN_2RY33a84ynqJlWVVsfln9l7jdrk044CC4","qmk1.SCkez9OZ-aim6tjG4If40Bt5_p1P0Gum9qVUu2Br444","qmk1.Sby3Zk8f95oecZWj47kAsTuvpt28F6TYUb1lQ3e7qcY","qmk1.Um2Vq7wVFOTJC2Nl1VGs5-JOLqqhEUBOFbeHS4Cm0VM","qmk1.VTGCmNQiQMxs5EHGhePvvJxCzcVRX_sG8lDZ3egeAQY","qmk1.WzvBVdOtaev6I8dWMUh6HdZC3wfA61uDM_eN9WZzPnE","qmk1.dPWg7fjb0TUNBcubXq6Mh10nPoS8LUbg9B8sZvfuwcY","qmk1.iPLmz_4DFS47vyU_zpei88c2qlDws2RgSdtG-17UJbE","qmk1.kwOYj4FbBeRoOpllBn23lh2SAyHxRodpjxHfLi_roo8","qmk1.mL1LPn0ya_cH4LnG9MdAsES4rYGHlFAyd7S3BhVGIHQ","qmk1.o7gsw7Do0dQUV5NhR4xIe5QcAyWYwQjqr0RhlDqsIGU","qmk1.raH7t_Nrvp4_m71JmGDHw-FG3QWjMWNUuvQRxjpfONo"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.PV2z0pEYdNcuyvqhsIO64I2i0mA22_RN-f23_I8VAOk","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
