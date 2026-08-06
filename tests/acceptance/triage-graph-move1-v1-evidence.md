# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-04
**Source revision:** `b22d1f7299c2597f39a4ec5ee8670a7ff00a80a1` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.Ksl7h9jxg5rlBm3LHav7sENMsVdzFT1S1XBpCUUsy18"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.6Wf7A0q3KkcJgej-foFxLNLthatgeYDDC5vIEYB0u2I","qmk1.DDvuGNsXq6t5hxVoLrHCxM4rnW2fWJUiZjQ1O6iA0zY","qmk1.FCc3x7xWhh3uQIeXzWyouz7W5nMOXQKNQdu2ek7QJ38","qmk1.OcJYk1iN1m5JmLZCEhCj8dpykMUOJQ1TyqjTf5XzyYw","qmk1.QQHNXzbsBItj8OrU3zLLFqiKaoLT23Q1R9v_tOZ0dXw","qmk1.XGC6V6A7vN9vlURy9REOC7Q21N93VAu9rtgrXShgfiU","qmk1.Y3QkIIxTPZgf-PMTrrPhpCDrZFOa4GZ6QiqDU6lr234","qmk1.aFAwNEJj5OpkmfMGyI8qDhQjgiWoEnHjYulW3zsm79Q","qmk1.c0_AXNir0GfzgdFR0-Vw3e-rfAOXa8q2uC-oOwFQiJY","qmk1.cUndGqqwiP8lXkHM9UXDW_6gmFa9jlLWW1bj9sElVI8","qmk1.jceTzOoCeTL7YFqrS6-WMqZVCegyF57VJu6StlKau3U","qmk1.kIXTrXYtV6zKQxtS3tGe4Ic-3iI5MiG3vTSPuIgVUHw","qmk1.kJwUToH1_spVl3mM1hQDHsK8kcYj-hCPf9nkOOAQnXA","qmk1.kkhRNB_qZnfAoMBNROz3ZU-KsF9s3aveCUSIY8MukwQ","qmk1.lsCNEepPHzpnWzqJRmgKvcDm5DR0KgrQJcQ0XeGmRnk","qmk1.lyim3GRjvF1IYKz9NrP9-be-K_9t2hXeG_x1_VGSJxo","qmk1.pZc1Sr7UoXFGETOxTzqI43uIrkr9iyyrgQ0LPJuwcmU","qmk1.wdsz4D6OQx7vOPntgX9IvS3ihuPCBqOEbL-wjVYAiIM","qmk1.yJoBqkSUXMY0l2PJBjmbgqGYb9mlskgH4jarokXvcjU","qmk1.yuhk6dv9fZ9lOYksuDOTwHoSyPexExIcsOFgxtdQMjA"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.Ksl7h9jxg5rlBm3LHav7sENMsVdzFT1S1XBpCUUsy18","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.Ksl7h9jxg5rlBm3LHav7sENMsVdzFT1S1XBpCUUsy18"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.6Wf7A0q3KkcJgej-foFxLNLthatgeYDDC5vIEYB0u2I","qmk1.DDvuGNsXq6t5hxVoLrHCxM4rnW2fWJUiZjQ1O6iA0zY","qmk1.FCc3x7xWhh3uQIeXzWyouz7W5nMOXQKNQdu2ek7QJ38","qmk1.OcJYk1iN1m5JmLZCEhCj8dpykMUOJQ1TyqjTf5XzyYw","qmk1.QQHNXzbsBItj8OrU3zLLFqiKaoLT23Q1R9v_tOZ0dXw","qmk1.XGC6V6A7vN9vlURy9REOC7Q21N93VAu9rtgrXShgfiU","qmk1.Y3QkIIxTPZgf-PMTrrPhpCDrZFOa4GZ6QiqDU6lr234","qmk1.aFAwNEJj5OpkmfMGyI8qDhQjgiWoEnHjYulW3zsm79Q","qmk1.c0_AXNir0GfzgdFR0-Vw3e-rfAOXa8q2uC-oOwFQiJY","qmk1.cUndGqqwiP8lXkHM9UXDW_6gmFa9jlLWW1bj9sElVI8","qmk1.jceTzOoCeTL7YFqrS6-WMqZVCegyF57VJu6StlKau3U","qmk1.kIXTrXYtV6zKQxtS3tGe4Ic-3iI5MiG3vTSPuIgVUHw","qmk1.kJwUToH1_spVl3mM1hQDHsK8kcYj-hCPf9nkOOAQnXA","qmk1.kkhRNB_qZnfAoMBNROz3ZU-KsF9s3aveCUSIY8MukwQ","qmk1.lsCNEepPHzpnWzqJRmgKvcDm5DR0KgrQJcQ0XeGmRnk","qmk1.lyim3GRjvF1IYKz9NrP9-be-K_9t2hXeG_x1_VGSJxo","qmk1.pZc1Sr7UoXFGETOxTzqI43uIrkr9iyyrgQ0LPJuwcmU","qmk1.wdsz4D6OQx7vOPntgX9IvS3ihuPCBqOEbL-wjVYAiIM","qmk1.yJoBqkSUXMY0l2PJBjmbgqGYb9mlskgH4jarokXvcjU","qmk1.yuhk6dv9fZ9lOYksuDOTwHoSyPexExIcsOFgxtdQMjA"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.Ksl7h9jxg5rlBm3LHav7sENMsVdzFT1S1XBpCUUsy18","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
