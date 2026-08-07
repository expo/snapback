# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `18ed09d8557efc2c9497e908cf16f0d99ba4eb71` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.JRJefdedIdW0B3ApeDoUQIhySZBLsnWEA2sAV1BGM5o"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.-OfNsrBCwEggwmNQPTYeo9JR-nqMitzBhvXpyR3dxMo","qmk1.0F35a9EAvCxsl3g6i439CucEVLJwO7MFS4b9bwZfWdA","qmk1.5Zs3soZUD-hFfIjQ2mTHETejHfZ9iyGYGEtIxJkAWgs","qmk1.6lUPsC7dmDQxjXheQyfT1ZUq-7rzkpmpr45NjGnEdeM","qmk1.E40JTQHjyp5JvzazdETkx_-WmJ_PT5dELQjQiQfKtm0","qmk1.Ly6T5-sWPAmFkQLcLpYkbzlijle31kfoL0jR1uYdOak","qmk1.PZ8viGDXfFzpuh_jjKWrA5K4I6R7zEEJORP2NgaYez4","qmk1.R6Ij4MT87PDAAJkUDZ4dJVp9nVncMCYIxXKqfn0BRdU","qmk1.RWkpwgxnMMrp49i4eiXS9hM2LGSuqWSHm4OdUBojh8I","qmk1.S1nsC3w2ocZpDNeaflko_aPDjncbEXBwgAFNpvh-_ww","qmk1.T4eEY2VfnHI00ld9qXsKUAxAH6_O2zGbsg0AyAfbV9M","qmk1.VYcY_woYy2J-Q-EUfVQsLBbTPZcqvHuow8Adf_b-czE","qmk1.YM9A0U7stAedhCz09Sb4vvlCL39Vfp1PJvrjFpbdm2A","qmk1.dYgMY6zjIfQSOuY3-rCO2iBk_h2ze1YQu9Go0VGHl7g","qmk1.ghYt2RwEAAkR6p7mSau8_YQoe2ogQ68xwV_029GrRyo","qmk1.p4xtaVHFon1HPKiDVbEyt9ZqEcSDBDI9bjSdJYLpJI8","qmk1.rRwUc9FJ1_B2u-dSDm_itmZem9VYAOibNL9E_Dr0f88","qmk1.tSVHFliW2_UkN7MW2I1yR7V5EnLa6L_TwTCz3naTBX8","qmk1.tsVy83OnXkstut8sinVEYTyMKR7soi2nqsq7mSqSN7I","qmk1.xgtMr2N-u_7m9PlD6wYnnkxIi0KXXi2HEua5UJga77w"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.JRJefdedIdW0B3ApeDoUQIhySZBLsnWEA2sAV1BGM5o","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.JRJefdedIdW0B3ApeDoUQIhySZBLsnWEA2sAV1BGM5o"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.-OfNsrBCwEggwmNQPTYeo9JR-nqMitzBhvXpyR3dxMo","qmk1.0F35a9EAvCxsl3g6i439CucEVLJwO7MFS4b9bwZfWdA","qmk1.5Zs3soZUD-hFfIjQ2mTHETejHfZ9iyGYGEtIxJkAWgs","qmk1.6lUPsC7dmDQxjXheQyfT1ZUq-7rzkpmpr45NjGnEdeM","qmk1.E40JTQHjyp5JvzazdETkx_-WmJ_PT5dELQjQiQfKtm0","qmk1.Ly6T5-sWPAmFkQLcLpYkbzlijle31kfoL0jR1uYdOak","qmk1.PZ8viGDXfFzpuh_jjKWrA5K4I6R7zEEJORP2NgaYez4","qmk1.R6Ij4MT87PDAAJkUDZ4dJVp9nVncMCYIxXKqfn0BRdU","qmk1.RWkpwgxnMMrp49i4eiXS9hM2LGSuqWSHm4OdUBojh8I","qmk1.S1nsC3w2ocZpDNeaflko_aPDjncbEXBwgAFNpvh-_ww","qmk1.T4eEY2VfnHI00ld9qXsKUAxAH6_O2zGbsg0AyAfbV9M","qmk1.VYcY_woYy2J-Q-EUfVQsLBbTPZcqvHuow8Adf_b-czE","qmk1.YM9A0U7stAedhCz09Sb4vvlCL39Vfp1PJvrjFpbdm2A","qmk1.dYgMY6zjIfQSOuY3-rCO2iBk_h2ze1YQu9Go0VGHl7g","qmk1.ghYt2RwEAAkR6p7mSau8_YQoe2ogQ68xwV_029GrRyo","qmk1.p4xtaVHFon1HPKiDVbEyt9ZqEcSDBDI9bjSdJYLpJI8","qmk1.rRwUc9FJ1_B2u-dSDm_itmZem9VYAOibNL9E_Dr0f88","qmk1.tSVHFliW2_UkN7MW2I1yR7V5EnLa6L_TwTCz3naTBX8","qmk1.tsVy83OnXkstut8sinVEYTyMKR7soi2nqsq7mSqSN7I","qmk1.xgtMr2N-u_7m9PlD6wYnnkxIi0KXXi2HEua5UJga77w"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.JRJefdedIdW0B3ApeDoUQIhySZBLsnWEA2sAV1BGM5o","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
