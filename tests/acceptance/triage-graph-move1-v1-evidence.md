# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `4c258767642a9e3f1ed3575499251b8aa7bbe668` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.C-igzTXbtE9MfKvbqb0WcKtf359MX4ZINVUSBVXnWPI"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.-VlL8kMWkCBGHAZ7pvUuprw_4aQyUE-BIw4lHDlKOUw","qmk1.3HMm8sroG0XOe6N-CULAaVaPMO31SFczM0P2wFjQWTE","qmk1.7D3ZaYWgYNI-iziwTvSFQYLywLw_Hy8bpFqzGR46qac","qmk1.BYLgjGg_ilL2pr-m5HfcTAwG59RgCH2jXZIo_lm4KwQ","qmk1.EOIGfe2rZGVShjOM-8j7QuwNDATGq6AgaJD93fk5UeE","qmk1.F6qkxPmjK7I1U4GSHlo98lszr_fyN4wSaCnYLJ0mBUc","qmk1.GlorBUFcbYhZLmth_6xlfauOAwx6qLmDYrxnvi10b2M","qmk1.IhgPmxHaWNakO2NWtfXdWRiTLOiyPwZqDQhWmVVlIrI","qmk1.J6dEa35wo6ERVFtkJe7Z5UWL8mbfBq8A76GoxRZUwo4","qmk1.SOJw_B2W6CQONFOV8znSuxe1yi1SqWAIluc-DIHlW6g","qmk1.YF0aqgD6K8avCRcF4-xUQ8Lxmcd3gczxX-5mfngKjbw","qmk1.cFdQ1S6f9wmZzjRCZvlwYeqOrzMhCq7VGamC27za0kI","qmk1.ill1cmYdlLXTqBupKSM6u-Hsa9wI6b6q0TJTD3mpWK0","qmk1.ipSpoauEsboiRQOBakw_wjFqF67NZKwgYP-ktJ_qcDg","qmk1.kIZWekx8e-Qva_onwcG8Owtmf6r2wMKogskZGZ_qvto","qmk1.lc3XY4luaLUrsBihAfQvcoRpZSg0rCr6q74AqpH5xLY","qmk1.mDMB3BvjXWUOGojmF-T6vJjRxKW-tyv-j1jvRXChYHE","qmk1.p3OdOBFAX22Ip8DS3TEs4Z5WXJPbJ_jTzkHCgbNxV2w","qmk1.qsFGSghlVcNWmr4G1AysP5LVd_z3Yus4_0SbQBS9wpY","qmk1.xS5p36DihPr7E5EysbVKpQi8l5coi1HEFcsk2w-zpRU"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.C-igzTXbtE9MfKvbqb0WcKtf359MX4ZINVUSBVXnWPI","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.C-igzTXbtE9MfKvbqb0WcKtf359MX4ZINVUSBVXnWPI"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.-VlL8kMWkCBGHAZ7pvUuprw_4aQyUE-BIw4lHDlKOUw","qmk1.3HMm8sroG0XOe6N-CULAaVaPMO31SFczM0P2wFjQWTE","qmk1.7D3ZaYWgYNI-iziwTvSFQYLywLw_Hy8bpFqzGR46qac","qmk1.BYLgjGg_ilL2pr-m5HfcTAwG59RgCH2jXZIo_lm4KwQ","qmk1.EOIGfe2rZGVShjOM-8j7QuwNDATGq6AgaJD93fk5UeE","qmk1.F6qkxPmjK7I1U4GSHlo98lszr_fyN4wSaCnYLJ0mBUc","qmk1.GlorBUFcbYhZLmth_6xlfauOAwx6qLmDYrxnvi10b2M","qmk1.IhgPmxHaWNakO2NWtfXdWRiTLOiyPwZqDQhWmVVlIrI","qmk1.J6dEa35wo6ERVFtkJe7Z5UWL8mbfBq8A76GoxRZUwo4","qmk1.SOJw_B2W6CQONFOV8znSuxe1yi1SqWAIluc-DIHlW6g","qmk1.YF0aqgD6K8avCRcF4-xUQ8Lxmcd3gczxX-5mfngKjbw","qmk1.cFdQ1S6f9wmZzjRCZvlwYeqOrzMhCq7VGamC27za0kI","qmk1.ill1cmYdlLXTqBupKSM6u-Hsa9wI6b6q0TJTD3mpWK0","qmk1.ipSpoauEsboiRQOBakw_wjFqF67NZKwgYP-ktJ_qcDg","qmk1.kIZWekx8e-Qva_onwcG8Owtmf6r2wMKogskZGZ_qvto","qmk1.lc3XY4luaLUrsBihAfQvcoRpZSg0rCr6q74AqpH5xLY","qmk1.mDMB3BvjXWUOGojmF-T6vJjRxKW-tyv-j1jvRXChYHE","qmk1.p3OdOBFAX22Ip8DS3TEs4Z5WXJPbJ_jTzkHCgbNxV2w","qmk1.qsFGSghlVcNWmr4G1AysP5LVd_z3Yus4_0SbQBS9wpY","qmk1.xS5p36DihPr7E5EysbVKpQi8l5coi1HEFcsk2w-zpRU"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.C-igzTXbtE9MfKvbqb0WcKtf359MX4ZINVUSBVXnWPI","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
