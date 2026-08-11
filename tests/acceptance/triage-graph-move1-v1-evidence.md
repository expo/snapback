# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `f045d6c1c65d6e73435dca5a95799fc5093333d3` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.CoRT9l9qwj76E49WlyOMrrhlM0EmbByrOhR5Vi9zFO8"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.-AweqJyKEaW03UlWnFastRh14BBW-0HhBPNXoy3B91s","qmk1.-cqcQe2VO2_2LOGyJXfqE0pnlUZH_O_tR0ZKyb-VPDg","qmk1.-iQ9j_gsIRjCluQEnGt2S8jgf-Kg3LZhjl04mgcTG2I","qmk1.0-Ql-oRtkqJs8bG5PaF0C68PxVby2JDz8Hd-f1U1his","qmk1.3Ga3wqulFI96SRzKqm5cnzfdl5yPCrrCUe7Kp__4Q78","qmk1.3YvrMOQ72_RgsBC6PVrqx9huLogeeQw5jqkogSOSoRs","qmk1.8A3UlVRCN7oogpVlUDmFRmcfXmlMkvQK2gxvCYxrFas","qmk1.A43ycAthkzF1ndddGo036lM2q6VKOZ0DBMWe21xz1Tc","qmk1.KCz859MrXICarFkyF58XQI0lOhCF_lhVZlGf-UXHEc4","qmk1.LykkfhlrcK4tgKE_20ipnc6ciezuxuVwZoE63yUwFNo","qmk1.QazGsKeuXZ-V2zuHRj_cZruroDR14BK5Ww_2z-CV8Do","qmk1.QorptTm6oLSXAkUqt1TUzMotsfebCRCt8GNwjuEwWj0","qmk1.RgBCpW5ZfXI3qtpm-sqVQIVRJ9Rn1sWtwm1N_Gmt6Go","qmk1.ThVXXlSYcrBWcekLChpp_jxcY884GdMt-R4uxt6oYCs","qmk1.d3r0FN2qwaWvyx4DXYVkIogPBfEvbUHIZG6mvCqZASk","qmk1.hZA_Xyk64UmmWDmU9CMMIXYVpRtqXUlU5upq3Ogt5QU","qmk1.haBKmJwNqWziyh3FXDlgDe1orX7xT2ixDdLqBsPbe2s","qmk1.jmiTi4q2EOLdMBXCMoj4LPQi97Hdux3NUIJS1PD_rws","qmk1.w5eoqRLYCsCYNSLDT2yHY7aU1L78qpZrxjm1ywmBVxg","qmk1.ydiPLnrMC3URNDmPbB2ae4xKKmtRouULWnEFaxhZ4D4"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.CoRT9l9qwj76E49WlyOMrrhlM0EmbByrOhR5Vi9zFO8","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.CoRT9l9qwj76E49WlyOMrrhlM0EmbByrOhR5Vi9zFO8"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.-AweqJyKEaW03UlWnFastRh14BBW-0HhBPNXoy3B91s","qmk1.-cqcQe2VO2_2LOGyJXfqE0pnlUZH_O_tR0ZKyb-VPDg","qmk1.-iQ9j_gsIRjCluQEnGt2S8jgf-Kg3LZhjl04mgcTG2I","qmk1.0-Ql-oRtkqJs8bG5PaF0C68PxVby2JDz8Hd-f1U1his","qmk1.3Ga3wqulFI96SRzKqm5cnzfdl5yPCrrCUe7Kp__4Q78","qmk1.3YvrMOQ72_RgsBC6PVrqx9huLogeeQw5jqkogSOSoRs","qmk1.8A3UlVRCN7oogpVlUDmFRmcfXmlMkvQK2gxvCYxrFas","qmk1.A43ycAthkzF1ndddGo036lM2q6VKOZ0DBMWe21xz1Tc","qmk1.KCz859MrXICarFkyF58XQI0lOhCF_lhVZlGf-UXHEc4","qmk1.LykkfhlrcK4tgKE_20ipnc6ciezuxuVwZoE63yUwFNo","qmk1.QazGsKeuXZ-V2zuHRj_cZruroDR14BK5Ww_2z-CV8Do","qmk1.QorptTm6oLSXAkUqt1TUzMotsfebCRCt8GNwjuEwWj0","qmk1.RgBCpW5ZfXI3qtpm-sqVQIVRJ9Rn1sWtwm1N_Gmt6Go","qmk1.ThVXXlSYcrBWcekLChpp_jxcY884GdMt-R4uxt6oYCs","qmk1.d3r0FN2qwaWvyx4DXYVkIogPBfEvbUHIZG6mvCqZASk","qmk1.hZA_Xyk64UmmWDmU9CMMIXYVpRtqXUlU5upq3Ogt5QU","qmk1.haBKmJwNqWziyh3FXDlgDe1orX7xT2ixDdLqBsPbe2s","qmk1.jmiTi4q2EOLdMBXCMoj4LPQi97Hdux3NUIJS1PD_rws","qmk1.w5eoqRLYCsCYNSLDT2yHY7aU1L78qpZrxjm1ywmBVxg","qmk1.ydiPLnrMC3URNDmPbB2ae4xKKmtRouULWnEFaxhZ4D4"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.CoRT9l9qwj76E49WlyOMrrhlM0EmbByrOhR5Vi9zFO8","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
