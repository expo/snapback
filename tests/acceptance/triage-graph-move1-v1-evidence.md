# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-04
**Source revision:** `2048ba89f99b8c7198536d5b54e4a422162ae212` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.Cio4PxNOUzvLb4qPQFU3_gUwhcIrAptqMYyfukIhDTs"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.03yTn9BmMVqVSFrEMs65047JZbkZAV_grL70bda20i0","qmk1.7fIuyqWGLheHj7f_dT-RoQRwCJ14Yc3CfbgN-CNy11M","qmk1.ACwxQU3C8X5ez6pmns7bCScj8dKd07S1TqRY6UhI4JA","qmk1.BsHedsFqztODCO-np6OVMJobzE3qyIFlLyBGSmZeAyE","qmk1.GV_jGnbd5MNKzb_9Ql1YDIpZMZ9yEDpBUEca7Nz3ULE","qmk1.JYQTnFpnw8qpXnctdwolC2e_M75sJ-Rb87ahf0EPEH8","qmk1.MnXp8l23LFB1D4T105TAU79lhgaAnbenKar5eSj2bF8","qmk1.NnpljFWBmdm-R0eNSoWjws1IknFAC9GcnD3yrYCXVMs","qmk1.Q3duZR-dxmX82d0UjlCz_s19dBZafaNUu2uTpVv5S24","qmk1.UsR0gQQ9eOi_QIT7saasAya4JKe73c_ZrcFm6UcRrP4","qmk1.Xj7gWWmXd96s4g2tGkJ6C9fYJgUVIWjzxiDZG11UO7c","qmk1.YCxPTEFN2o_hk0Chv8NG8GooZnymiuVq8R90zgbxU_Q","qmk1.Z5Gl774KkaTWav2vBpXGi115IyTaQ3K9ddq6JCkMnUA","qmk1.lLzLHej9QvQeIAqzTJsAf4VpzDSoobYkOArqx_UwgEM","qmk1.qE4NBnZHPSNtzWipI8KBp1E-IwaDAgpv3ugIEtKvgbg","qmk1.rIxDCWqDrBGVL4ntb5oMHr29QroztrIopx0CL9NUiqI","qmk1.scMYss4iHKaleV_ebl04UK2TPz3JtRA5C33rr5ddZZM","qmk1.vpw-12fSgZ57ujdFqZaHyuph9-ALx2p1gMgx62Yia9Q","qmk1.w_HGTVZzoSPwX84L3vKufjYOBGhJC5l6RsPCSJsTaWE","qmk1.wp3lE6nkwmlvcj42MZq9TJ5v8TtHDb4QNsJWok-FVio"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.Cio4PxNOUzvLb4qPQFU3_gUwhcIrAptqMYyfukIhDTs","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.Cio4PxNOUzvLb4qPQFU3_gUwhcIrAptqMYyfukIhDTs"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.03yTn9BmMVqVSFrEMs65047JZbkZAV_grL70bda20i0","qmk1.7fIuyqWGLheHj7f_dT-RoQRwCJ14Yc3CfbgN-CNy11M","qmk1.ACwxQU3C8X5ez6pmns7bCScj8dKd07S1TqRY6UhI4JA","qmk1.BsHedsFqztODCO-np6OVMJobzE3qyIFlLyBGSmZeAyE","qmk1.GV_jGnbd5MNKzb_9Ql1YDIpZMZ9yEDpBUEca7Nz3ULE","qmk1.JYQTnFpnw8qpXnctdwolC2e_M75sJ-Rb87ahf0EPEH8","qmk1.MnXp8l23LFB1D4T105TAU79lhgaAnbenKar5eSj2bF8","qmk1.NnpljFWBmdm-R0eNSoWjws1IknFAC9GcnD3yrYCXVMs","qmk1.Q3duZR-dxmX82d0UjlCz_s19dBZafaNUu2uTpVv5S24","qmk1.UsR0gQQ9eOi_QIT7saasAya4JKe73c_ZrcFm6UcRrP4","qmk1.Xj7gWWmXd96s4g2tGkJ6C9fYJgUVIWjzxiDZG11UO7c","qmk1.YCxPTEFN2o_hk0Chv8NG8GooZnymiuVq8R90zgbxU_Q","qmk1.Z5Gl774KkaTWav2vBpXGi115IyTaQ3K9ddq6JCkMnUA","qmk1.lLzLHej9QvQeIAqzTJsAf4VpzDSoobYkOArqx_UwgEM","qmk1.qE4NBnZHPSNtzWipI8KBp1E-IwaDAgpv3ugIEtKvgbg","qmk1.rIxDCWqDrBGVL4ntb5oMHr29QroztrIopx0CL9NUiqI","qmk1.scMYss4iHKaleV_ebl04UK2TPz3JtRA5C33rr5ddZZM","qmk1.vpw-12fSgZ57ujdFqZaHyuph9-ALx2p1gMgx62Yia9Q","qmk1.w_HGTVZzoSPwX84L3vKufjYOBGhJC5l6RsPCSJsTaWE","qmk1.wp3lE6nkwmlvcj42MZq9TJ5v8TtHDb4QNsJWok-FVio"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.Cio4PxNOUzvLb4qPQFU3_gUwhcIrAptqMYyfukIhDTs","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
