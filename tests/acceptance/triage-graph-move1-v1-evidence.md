# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `7ae7bd3d50b1b956c110f6b132ca7efcff1e2e99` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.icgdG3H7aKSeM--iyaBiXkYGc0h5V2ygXkpyJEiNNGI"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.5b7SYho4uGXoEAZaFIezG408jNgg_wuIxP1eJpyfWMk","qmk1.8X19qGoSiZimGssUdDq9hLNIsVk9VD5rhOj4LNtghlE","qmk1.8eJMMOV_LNzvXwccWDIQ-3GJIh64AUen952jPM1vUiA","qmk1.EgKwp2lrdM4cQ6fA-LVX25JlTsYcFMwwYZswmMkl9OI","qmk1.Gfdd6IH_FgQ3-_iNpCzazmHGXIG-Mc_6eT6djQ7Pszw","qmk1.Jee4-iTbIxflLEuCjSkJrdCfVMBI4RFzXXKLkzD9rpg","qmk1.LGzmFEGHYjfsZfqpayQ3zkwoH3DaUj4EBtyiggqChGQ","qmk1.U5ECdNu6MI0H4uzAFznQKtdkLy8QkD07t4ojo2lxDk8","qmk1.WhFSKZoFAnggKixvBthos5XHtnSueygjoAI3BsUP9Qc","qmk1.WwAbPL4YxJqVcuntaG-3OYgw0BGw_xERqOm-dOsOq8k","qmk1.Yz1aeYB6OdE9TuRjhB4qW0Objjw7eeZv5PweDh8ql_w","qmk1.axBcYqg7DuZCn-qH9u2KEh33Ly8NdcpAc37xfCHTDcA","qmk1.bPHinqmjYozqHlhdmvCbgc8cmeqpAHFFYDCvcZFfMzQ","qmk1.bklkDJ4FBoyUixeY4TjxvarTgNanmPXlTXUEE72AHmo","qmk1.d1HfXadtfNVvV2fPXOhmdVYfLllyOXD2PcM02j7IUOQ","qmk1.dejsIJsldi8qoip1GSfEGdwRoa9EHtgbZK3MAKQJJ0w","qmk1.kgFNdGaQbDg_L7-iswtni2DpVtRarTtHD0DyswvtCkA","qmk1.nZLbT5XBUk3YrpIq-ouRPyLbhXgClFEFQ9FqOfa0Pn0","qmk1.ot-smPHNtlleXCQgCExWTtVHNSi6NVQQh-8BUNt75qs","qmk1.x_iRR9zYC10OH67SAKLNo1V5QOGwAF0YxoVbHX_6Qm8"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.icgdG3H7aKSeM--iyaBiXkYGc0h5V2ygXkpyJEiNNGI","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.icgdG3H7aKSeM--iyaBiXkYGc0h5V2ygXkpyJEiNNGI"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.5b7SYho4uGXoEAZaFIezG408jNgg_wuIxP1eJpyfWMk","qmk1.8X19qGoSiZimGssUdDq9hLNIsVk9VD5rhOj4LNtghlE","qmk1.8eJMMOV_LNzvXwccWDIQ-3GJIh64AUen952jPM1vUiA","qmk1.EgKwp2lrdM4cQ6fA-LVX25JlTsYcFMwwYZswmMkl9OI","qmk1.Gfdd6IH_FgQ3-_iNpCzazmHGXIG-Mc_6eT6djQ7Pszw","qmk1.Jee4-iTbIxflLEuCjSkJrdCfVMBI4RFzXXKLkzD9rpg","qmk1.LGzmFEGHYjfsZfqpayQ3zkwoH3DaUj4EBtyiggqChGQ","qmk1.U5ECdNu6MI0H4uzAFznQKtdkLy8QkD07t4ojo2lxDk8","qmk1.WhFSKZoFAnggKixvBthos5XHtnSueygjoAI3BsUP9Qc","qmk1.WwAbPL4YxJqVcuntaG-3OYgw0BGw_xERqOm-dOsOq8k","qmk1.Yz1aeYB6OdE9TuRjhB4qW0Objjw7eeZv5PweDh8ql_w","qmk1.axBcYqg7DuZCn-qH9u2KEh33Ly8NdcpAc37xfCHTDcA","qmk1.bPHinqmjYozqHlhdmvCbgc8cmeqpAHFFYDCvcZFfMzQ","qmk1.bklkDJ4FBoyUixeY4TjxvarTgNanmPXlTXUEE72AHmo","qmk1.d1HfXadtfNVvV2fPXOhmdVYfLllyOXD2PcM02j7IUOQ","qmk1.dejsIJsldi8qoip1GSfEGdwRoa9EHtgbZK3MAKQJJ0w","qmk1.kgFNdGaQbDg_L7-iswtni2DpVtRarTtHD0DyswvtCkA","qmk1.nZLbT5XBUk3YrpIq-ouRPyLbhXgClFEFQ9FqOfa0Pn0","qmk1.ot-smPHNtlleXCQgCExWTtVHNSi6NVQQh-8BUNt75qs","qmk1.x_iRR9zYC10OH67SAKLNo1V5QOGwAF0YxoVbHX_6Qm8"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.icgdG3H7aKSeM--iyaBiXkYGc0h5V2ygXkpyJEiNNGI","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
