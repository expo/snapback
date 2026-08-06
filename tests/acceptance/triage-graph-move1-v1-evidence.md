# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-04
**Source revision:** `b6d4b550c41eb5b0101b7c85218cbfb1bcd49fe6` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.ugBbE8pho_hYnqqH8nsCPJovuofWfyMCViIhYnmpbO8"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.5yklX6lUGWWnKbcklBn8dzmEriCe5vLfNeo9otVoP50","qmk1.7z0FY_HPfMRmNsKYY05_MSxBFmNyZlHhlhfQyH2Hh9U","qmk1.7z4g9JHKlHB9gbU1TVWVonr0Va6RUfsPUBl6Ao2X1vY","qmk1.8Tbp3ku0dIv9BdRwPSXGzWb_tK6l-jxjIcB0BLNDxFg","qmk1.A3qomQt7-d4ZISdEzXpdlAW4t569vwb5a1OSXWOOWtQ","qmk1.Ae7Td9fb4N7zLvxa9JbdcVortxTuUJgqWEbbBrJG9CE","qmk1.B0SVM8iWUCTh7o_Z88BFpkRVL11ZrnpUOOT70YlLY4g","qmk1.ElPZ0SlSC-ZA1N7zwJkSYltzoULrY68lQkyqcERigPQ","qmk1.GmFzNlOu463B2lmVOeZ6jvS7m2AZ6Op0LvyzGtYcV8s","qmk1.HRV6lE9aQ278ilzje2vOTQDsLBW71YIZFHzAZd9gdZw","qmk1.KtoaJqZe6iuhDzGpIhsUDmH-BOnbpYvOaDCjHVT6zPY","qmk1.MBV0px3qlLO_dG95t6etrOWgrFOzqdKFNQbKMbRqsM4","qmk1.WYyvTl_vzQd5MpH5SeQXT4zDkmM9pY03h1w9_4X6_WA","qmk1.Xn1rSeBr8P1ig7hwzfFOUSr7gyJ1u6R19--ocJfnFnM","qmk1.XuJ_4BwSPw4Iuma9OsZpMVKzJEK3d8MpE7aMIBBLUTA","qmk1.mtyeP_4TomVvoWQeOhJpJOfYTCgK1wMs3XLKG_nGuow","qmk1.rAiPvSvXr6TZqLQy89L7wCC5Bki55afNrrhNc_sO0jY","qmk1.wcPuVMGA3i-8MHf5HQt4txceE2sAgFPWKAYxomg9CTU","qmk1.yoLZN0-6DufQZpRd7RtCl5bh-cPsH15ChrFZTak7oGU","qmk1.yrLp9P7r7jIxaOfWlV3_o1ay1-VxiU6ekxEOK-403RA"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.ugBbE8pho_hYnqqH8nsCPJovuofWfyMCViIhYnmpbO8","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.ugBbE8pho_hYnqqH8nsCPJovuofWfyMCViIhYnmpbO8"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.5yklX6lUGWWnKbcklBn8dzmEriCe5vLfNeo9otVoP50","qmk1.7z0FY_HPfMRmNsKYY05_MSxBFmNyZlHhlhfQyH2Hh9U","qmk1.7z4g9JHKlHB9gbU1TVWVonr0Va6RUfsPUBl6Ao2X1vY","qmk1.8Tbp3ku0dIv9BdRwPSXGzWb_tK6l-jxjIcB0BLNDxFg","qmk1.A3qomQt7-d4ZISdEzXpdlAW4t569vwb5a1OSXWOOWtQ","qmk1.Ae7Td9fb4N7zLvxa9JbdcVortxTuUJgqWEbbBrJG9CE","qmk1.B0SVM8iWUCTh7o_Z88BFpkRVL11ZrnpUOOT70YlLY4g","qmk1.ElPZ0SlSC-ZA1N7zwJkSYltzoULrY68lQkyqcERigPQ","qmk1.GmFzNlOu463B2lmVOeZ6jvS7m2AZ6Op0LvyzGtYcV8s","qmk1.HRV6lE9aQ278ilzje2vOTQDsLBW71YIZFHzAZd9gdZw","qmk1.KtoaJqZe6iuhDzGpIhsUDmH-BOnbpYvOaDCjHVT6zPY","qmk1.MBV0px3qlLO_dG95t6etrOWgrFOzqdKFNQbKMbRqsM4","qmk1.WYyvTl_vzQd5MpH5SeQXT4zDkmM9pY03h1w9_4X6_WA","qmk1.Xn1rSeBr8P1ig7hwzfFOUSr7gyJ1u6R19--ocJfnFnM","qmk1.XuJ_4BwSPw4Iuma9OsZpMVKzJEK3d8MpE7aMIBBLUTA","qmk1.mtyeP_4TomVvoWQeOhJpJOfYTCgK1wMs3XLKG_nGuow","qmk1.rAiPvSvXr6TZqLQy89L7wCC5Bki55afNrrhNc_sO0jY","qmk1.wcPuVMGA3i-8MHf5HQt4txceE2sAgFPWKAYxomg9CTU","qmk1.yoLZN0-6DufQZpRd7RtCl5bh-cPsH15ChrFZTak7oGU","qmk1.yrLp9P7r7jIxaOfWlV3_o1ay1-VxiU6ekxEOK-403RA"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.ugBbE8pho_hYnqqH8nsCPJovuofWfyMCViIhYnmpbO8","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
