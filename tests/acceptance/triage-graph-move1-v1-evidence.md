# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `e3e477aa2616e00889ad7ba9fc5b5ff4e20686a1` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.l0Gbg2vAhumZ5AL1brtA89a6nRvVlz3yFCWKi1AVWx0"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.0M1--oGtS4F3BECeGH_hAW_WczJ-FrSqPl-IfqPYmsM","qmk1.3EStHQuCIa5ZNl_H2io_fxLuyPV3vq7R8DMCSb7oVuM","qmk1.ElAuMmc_VhL0m5TGYFmWNU96ppRJwoPaVEWZO0Z51yg","qmk1.H3BhOYiVmpYrUACl8CIXXUJBIGMt5TW2080zWmgJFnY","qmk1.IUeryahn7VVnWjeA6OxIydU1w57Vru0NNvl6pbgv_g0","qmk1.KnF9pnCH6IvL-sAm2dmwWYRULcOCAW2ZTbzVXA7g390","qmk1.KxArjfV1nNoYnvYrwNtxClF6oupYGiBI15O-rCz0ASk","qmk1.LTtzZrr3MV65s3j7qE63HCQSd24vgSoNbWwE-CLdlhQ","qmk1.PhU_2Xi2Ban1sVy8kMUI54K-zXUsOgramj3H6S1Idb0","qmk1.TE9X29Uw-bR3aWVCaw3mVSIpaRt6f-RBM3h7CmP7KeE","qmk1.bApEXxUxpR3tMfIqfcCsLA5k5iu2CKDKXQA1CPwnlsk","qmk1.e5gtTQ6yLuPo1skh2STkNlsPWDFhaW6jch9DH_B9Np4","qmk1.ijMn76k7gxvK9laLyzU8Smsy7Nbl3K3L57KtJaRXmKw","qmk1.mFicKaBlz-PaWKZ_b5YOQUYzNXkmNVX_GJAz-a2VOsU","qmk1.oGG6HwF4KM2OgrYzMLLCFK--V0iPhY8bdrbeiWRlB20","qmk1.pnO_hKS7GdvwNmt9sCJBxwDa4bNfzoFj3Nl4rfGbHd8","qmk1.qsDkpRmfjUyNM9Cjzs2KwfjBSBEbPvkakYu3kc2pbCA","qmk1.t5tJo69qx63hJrA-U5PXAqI7X151hG-jFmVZSO9Fyqc","qmk1.wfeTjJU83-Cl2J2NmiTSxLF8lriR8iDMRyHu98y_Wvg","qmk1.wou6ASG0Ok6vxsANyzMs7V6QENjdLjvPX5xl6FcA4so"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.l0Gbg2vAhumZ5AL1brtA89a6nRvVlz3yFCWKi1AVWx0","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.l0Gbg2vAhumZ5AL1brtA89a6nRvVlz3yFCWKi1AVWx0"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.0M1--oGtS4F3BECeGH_hAW_WczJ-FrSqPl-IfqPYmsM","qmk1.3EStHQuCIa5ZNl_H2io_fxLuyPV3vq7R8DMCSb7oVuM","qmk1.ElAuMmc_VhL0m5TGYFmWNU96ppRJwoPaVEWZO0Z51yg","qmk1.H3BhOYiVmpYrUACl8CIXXUJBIGMt5TW2080zWmgJFnY","qmk1.IUeryahn7VVnWjeA6OxIydU1w57Vru0NNvl6pbgv_g0","qmk1.KnF9pnCH6IvL-sAm2dmwWYRULcOCAW2ZTbzVXA7g390","qmk1.KxArjfV1nNoYnvYrwNtxClF6oupYGiBI15O-rCz0ASk","qmk1.LTtzZrr3MV65s3j7qE63HCQSd24vgSoNbWwE-CLdlhQ","qmk1.PhU_2Xi2Ban1sVy8kMUI54K-zXUsOgramj3H6S1Idb0","qmk1.TE9X29Uw-bR3aWVCaw3mVSIpaRt6f-RBM3h7CmP7KeE","qmk1.bApEXxUxpR3tMfIqfcCsLA5k5iu2CKDKXQA1CPwnlsk","qmk1.e5gtTQ6yLuPo1skh2STkNlsPWDFhaW6jch9DH_B9Np4","qmk1.ijMn76k7gxvK9laLyzU8Smsy7Nbl3K3L57KtJaRXmKw","qmk1.mFicKaBlz-PaWKZ_b5YOQUYzNXkmNVX_GJAz-a2VOsU","qmk1.oGG6HwF4KM2OgrYzMLLCFK--V0iPhY8bdrbeiWRlB20","qmk1.pnO_hKS7GdvwNmt9sCJBxwDa4bNfzoFj3Nl4rfGbHd8","qmk1.qsDkpRmfjUyNM9Cjzs2KwfjBSBEbPvkakYu3kc2pbCA","qmk1.t5tJo69qx63hJrA-U5PXAqI7X151hG-jFmVZSO9Fyqc","qmk1.wfeTjJU83-Cl2J2NmiTSxLF8lriR8iDMRyHu98y_Wvg","qmk1.wou6ASG0Ok6vxsANyzMs7V6QENjdLjvPX5xl6FcA4so"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.l0Gbg2vAhumZ5AL1brtA89a6nRvVlz3yFCWKi1AVWx0","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
