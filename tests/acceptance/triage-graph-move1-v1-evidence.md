# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-04
**Source revision:** `e7275c54460a6bc87cd5455aa9eade30f1500cb7` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.bNweZX9L7rym_VtL70AoyglKb3oUhIWlVMtHnVLgIQA"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.0aRi2zjdGDvUidEBy1vAsI83KF6iPYT_3J7pdsHXNY0","qmk1.0y-zCENxtwxbvUvJH22po6Ef7vcgbp6ZK9ITMAXuO2E","qmk1.7vePbj6LNgKUvqAl7JQhnY3Hqt9FjrOiXvWzens9H70","qmk1.910lf8S_PsfDYT2hJ-dChJeB0e5Tlraury9LwOVWZjI","qmk1.EDucSYdh7riIzWIM0PmhCG5mDyN4tWjX0bQ7WTGcqXc","qmk1.FR-R-hvqxg6s-grChRiPKcNiPtdGbb0dAXJnEbE5GDA","qmk1.Ft7vrSNpH0H75-HieOgtsdFo2WrQ6X1LMuv8IZ8M8Dg","qmk1.GpAY4q9OamzLf7ME11c11_KllEZHP7EUcCJIa_o1IUA","qmk1.PHC-BloLxeZ3mIGLDvI4dkScxQ_7Ehvjfzouf86j1bc","qmk1.QSAtrk8DzmGMXRSsccNQNfIg3eFT8FF1UKIVXtDP9tw","qmk1.ZyeqT8nEzlkpLkORjHWTMpCDr1sRyagJoABoP7w5mx8","qmk1.czMsMMnBNeC6GRltF3DNziKG0cSdY6dXlSFJGfqdV74","qmk1.dvWpMoSCgUlZ6x7sTWT5esbRPylRtAD0GiAX8A0c9vY","qmk1.fsNpl8nfuuP51gWw0n54nacf40qaPcDz2QsRDBGAKFM","qmk1.gBbwcyo67IN7BQ7qOFnXDSM1tlTFGhKy0TZK58Lv9Zo","qmk1.kR61qloNiSEawduLEFWBR4QC31c5NWY0KUqghwHsbq8","qmk1.l2XYfBePGi_g_ifVM7o568DrjE6Jq9i2hNBMT4HSE-o","qmk1.oy9n0GM4Fud_zL3-cA3By-UANRhEKFRSsCe6psiCAtg","qmk1.u24y4Je5AI7XylFYQiV_pLB7mN3rpigN3eoxJUdJq-A","qmk1.yc8zaNaUQ3HoF-WiyJ4EZ5cZcFa5wBXoGdHHrTw5VC8"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.bNweZX9L7rym_VtL70AoyglKb3oUhIWlVMtHnVLgIQA","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.bNweZX9L7rym_VtL70AoyglKb3oUhIWlVMtHnVLgIQA"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.0aRi2zjdGDvUidEBy1vAsI83KF6iPYT_3J7pdsHXNY0","qmk1.0y-zCENxtwxbvUvJH22po6Ef7vcgbp6ZK9ITMAXuO2E","qmk1.7vePbj6LNgKUvqAl7JQhnY3Hqt9FjrOiXvWzens9H70","qmk1.910lf8S_PsfDYT2hJ-dChJeB0e5Tlraury9LwOVWZjI","qmk1.EDucSYdh7riIzWIM0PmhCG5mDyN4tWjX0bQ7WTGcqXc","qmk1.FR-R-hvqxg6s-grChRiPKcNiPtdGbb0dAXJnEbE5GDA","qmk1.Ft7vrSNpH0H75-HieOgtsdFo2WrQ6X1LMuv8IZ8M8Dg","qmk1.GpAY4q9OamzLf7ME11c11_KllEZHP7EUcCJIa_o1IUA","qmk1.PHC-BloLxeZ3mIGLDvI4dkScxQ_7Ehvjfzouf86j1bc","qmk1.QSAtrk8DzmGMXRSsccNQNfIg3eFT8FF1UKIVXtDP9tw","qmk1.ZyeqT8nEzlkpLkORjHWTMpCDr1sRyagJoABoP7w5mx8","qmk1.czMsMMnBNeC6GRltF3DNziKG0cSdY6dXlSFJGfqdV74","qmk1.dvWpMoSCgUlZ6x7sTWT5esbRPylRtAD0GiAX8A0c9vY","qmk1.fsNpl8nfuuP51gWw0n54nacf40qaPcDz2QsRDBGAKFM","qmk1.gBbwcyo67IN7BQ7qOFnXDSM1tlTFGhKy0TZK58Lv9Zo","qmk1.kR61qloNiSEawduLEFWBR4QC31c5NWY0KUqghwHsbq8","qmk1.l2XYfBePGi_g_ifVM7o568DrjE6Jq9i2hNBMT4HSE-o","qmk1.oy9n0GM4Fud_zL3-cA3By-UANRhEKFRSsCe6psiCAtg","qmk1.u24y4Je5AI7XylFYQiV_pLB7mN3rpigN3eoxJUdJq-A","qmk1.yc8zaNaUQ3HoF-WiyJ4EZ5cZcFa5wBXoGdHHrTw5VC8"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.bNweZX9L7rym_VtL70AoyglKb3oUhIWlVMtHnVLgIQA","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
