# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `abf959f4cd17b0a9e3eb7de1677f19a51290acc3` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.f38X5C8XED_USCuAPiNC81PAO2FIJC0F1cqtktmyfLY"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.-GonKC1wmSrImuiTgINPyv5PIvoPTi1MHna1cIo2n_0","qmk1.ECId2s-8ly-Lu5oHe7YHSPXze-058X8Hnxs5K9dwFcc","qmk1.EDijiEDLkvhdl_3z2x7p3WeL7Z6PSS_Pws3NZlkaj20","qmk1.IMbmMtPb1Ldc3-invb1jbcnsNx8Plx5Kara3XG9BHpM","qmk1.IxFd4UkvYtUE1hevZwrz7jVPi-Yg9vFJNhdMvJ2dUQE","qmk1.KyKJyloQ2fETDQCoxV2JC7tNmM38jJlN-bWsQTXRWRE","qmk1.P2RG90E_5vAeWON-YDlrq9AMJmQGfJ8LHc12Y0xpcpI","qmk1.PWTnBej8enzGZQ-80vOWVBz8Ni4ipKWVWcQvAANRdg4","qmk1.TZvXiHm7C4ZJanDg7L8JOk1hqzFTniYNgkOB7Jrth6s","qmk1.TlsL7em7SylhnzTij9eXTVxIDG0hrk8MUHXfYEvEQRM","qmk1.ToJWelUTVpbM5cRKE8IsafGBjSS07fSRW4lAJZCpixI","qmk1.YUCSgZaZgAuWj4Q5d0c1zSTunNL8zqmCmLwBqCq8V5c","qmk1.YUm0u8OICLIWAIXV8T4c_hAnCfc9TdkrAe5h9PKCw_g","qmk1.bofKer5aAuGzmx99lDJ1QcSoeWX8JM20me3CfsICkBQ","qmk1.bvEB5Yg1xsKUPOBDh5VjEEOsS6q_RksTJH1pxY3Ez_E","qmk1.gFyf3lIf4Oo4A-Er6YG2Ij_PC-ac354mhsJwM64Dlr4","qmk1.sYUNsTm88yusnhEhjXM4G0Sqb4eGlKBjg5V2lnlN0hM","qmk1.sqtjHcjpgBHGtEKX3olkwGtD0DlomfRIeYMHl1T0x0M","qmk1.vRwUmLBMDxEHUufXprVKyEM0_QpKTW9nEcBmbwhl7Yg","qmk1.w4ct8oxcKYtAPYbQyHIRR78x5JmnicgfU_I_iMtUgBQ"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.f38X5C8XED_USCuAPiNC81PAO2FIJC0F1cqtktmyfLY","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.f38X5C8XED_USCuAPiNC81PAO2FIJC0F1cqtktmyfLY"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.-GonKC1wmSrImuiTgINPyv5PIvoPTi1MHna1cIo2n_0","qmk1.ECId2s-8ly-Lu5oHe7YHSPXze-058X8Hnxs5K9dwFcc","qmk1.EDijiEDLkvhdl_3z2x7p3WeL7Z6PSS_Pws3NZlkaj20","qmk1.IMbmMtPb1Ldc3-invb1jbcnsNx8Plx5Kara3XG9BHpM","qmk1.IxFd4UkvYtUE1hevZwrz7jVPi-Yg9vFJNhdMvJ2dUQE","qmk1.KyKJyloQ2fETDQCoxV2JC7tNmM38jJlN-bWsQTXRWRE","qmk1.P2RG90E_5vAeWON-YDlrq9AMJmQGfJ8LHc12Y0xpcpI","qmk1.PWTnBej8enzGZQ-80vOWVBz8Ni4ipKWVWcQvAANRdg4","qmk1.TZvXiHm7C4ZJanDg7L8JOk1hqzFTniYNgkOB7Jrth6s","qmk1.TlsL7em7SylhnzTij9eXTVxIDG0hrk8MUHXfYEvEQRM","qmk1.ToJWelUTVpbM5cRKE8IsafGBjSS07fSRW4lAJZCpixI","qmk1.YUCSgZaZgAuWj4Q5d0c1zSTunNL8zqmCmLwBqCq8V5c","qmk1.YUm0u8OICLIWAIXV8T4c_hAnCfc9TdkrAe5h9PKCw_g","qmk1.bofKer5aAuGzmx99lDJ1QcSoeWX8JM20me3CfsICkBQ","qmk1.bvEB5Yg1xsKUPOBDh5VjEEOsS6q_RksTJH1pxY3Ez_E","qmk1.gFyf3lIf4Oo4A-Er6YG2Ij_PC-ac354mhsJwM64Dlr4","qmk1.sYUNsTm88yusnhEhjXM4G0Sqb4eGlKBjg5V2lnlN0hM","qmk1.sqtjHcjpgBHGtEKX3olkwGtD0DlomfRIeYMHl1T0x0M","qmk1.vRwUmLBMDxEHUufXprVKyEM0_QpKTW9nEcBmbwhl7Yg","qmk1.w4ct8oxcKYtAPYbQyHIRR78x5JmnicgfU_I_iMtUgBQ"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.f38X5C8XED_USCuAPiNC81PAO2FIJC0F1cqtktmyfLY","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
