# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-04
**Source revision:** `45de8206dbaa6b94e3392357e38ac4cad50484d0` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.qHg4xqqw2sso_vgKj-ubchKTelFi1ZDmLb_rFVqV5o8"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.0ucQm4Py-iXVa0h2Vli5QuJwGkqVMzHYoy-Me1QX9fw","qmk1.1tW13svlyIkCx5tQ0CMuZVZxeNEKMfipPhyEem8PnMo","qmk1.7RNAqZuBLmVWNZVcK6rAo41mLL5KdnOuTvphLPgWiN8","qmk1.IDQfyMzcj7cLw1hz0HiQBZDFztyF1qwuOXRGxEMs7rw","qmk1.M3gpDloVNY1-wMM5aowMgzbNKM6Kcaq4cPfnuak38wc","qmk1.RDx_PqWS78G1Q2yaJIw6vrxxklrTtf5JNQdkWmFChSU","qmk1.RxQhnqoRJbSxaJY6gOJNQ0gAmEMCVfg8Q9ByZJ61Jxk","qmk1.S2Gu0d-SlHU_2dvrLwR7UvA7w4Hk8gTNPbXueZ3tGa8","qmk1.UePgACTCwjZ8zQbC_fOGQnHJhZbNQ_8qCPL2ce4CvYs","qmk1.Yd_fCCi1rxdws1vsvGQgtkpOaFx6L1ADlcrmUWrgMXw","qmk1._zzkXXOWh6xEMLpj5I1Q-AFbxKkydGG0mV-EtKgktxY","qmk1.bvff-dfZ3gtbVbRloMNI2k2A_HpTiGTrNUAUhRPycCs","qmk1.i9mWmn5-mNmxLC6coQl4kOE0tfqpa8YGmaQ3x18UoBM","qmk1.ilYytrHOKxMpAFynki3s7QE3bs-5Rwxr3QXp3aMnMYU","qmk1.lkstO6-FmMYAyPh4tqZh2TZ3kqE6sY7UdOUNG7nf5ck","qmk1.mgw5EZMuSDvst0KT-42bXNRvQAdt45G_xcoPSZB0VAQ","qmk1.rzVYvfoUQ_VyMFSqaXeRGluyd4BcTho_7pEcZeh2rbA","qmk1.xJ1jN1C0ToGB8h2xMnz0lnO9XXBAlk0XUPecA_e36dM","qmk1.yhl9gXMu558AV1g5R0GDIDZ-OHVEFi0II818zkYRdOM","qmk1.zQu_09TkJac2TN21hY9ka53Xz557DaP5bxeYYlITTYg"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.qHg4xqqw2sso_vgKj-ubchKTelFi1ZDmLb_rFVqV5o8","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.qHg4xqqw2sso_vgKj-ubchKTelFi1ZDmLb_rFVqV5o8"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.0ucQm4Py-iXVa0h2Vli5QuJwGkqVMzHYoy-Me1QX9fw","qmk1.1tW13svlyIkCx5tQ0CMuZVZxeNEKMfipPhyEem8PnMo","qmk1.7RNAqZuBLmVWNZVcK6rAo41mLL5KdnOuTvphLPgWiN8","qmk1.IDQfyMzcj7cLw1hz0HiQBZDFztyF1qwuOXRGxEMs7rw","qmk1.M3gpDloVNY1-wMM5aowMgzbNKM6Kcaq4cPfnuak38wc","qmk1.RDx_PqWS78G1Q2yaJIw6vrxxklrTtf5JNQdkWmFChSU","qmk1.RxQhnqoRJbSxaJY6gOJNQ0gAmEMCVfg8Q9ByZJ61Jxk","qmk1.S2Gu0d-SlHU_2dvrLwR7UvA7w4Hk8gTNPbXueZ3tGa8","qmk1.UePgACTCwjZ8zQbC_fOGQnHJhZbNQ_8qCPL2ce4CvYs","qmk1.Yd_fCCi1rxdws1vsvGQgtkpOaFx6L1ADlcrmUWrgMXw","qmk1._zzkXXOWh6xEMLpj5I1Q-AFbxKkydGG0mV-EtKgktxY","qmk1.bvff-dfZ3gtbVbRloMNI2k2A_HpTiGTrNUAUhRPycCs","qmk1.i9mWmn5-mNmxLC6coQl4kOE0tfqpa8YGmaQ3x18UoBM","qmk1.ilYytrHOKxMpAFynki3s7QE3bs-5Rwxr3QXp3aMnMYU","qmk1.lkstO6-FmMYAyPh4tqZh2TZ3kqE6sY7UdOUNG7nf5ck","qmk1.mgw5EZMuSDvst0KT-42bXNRvQAdt45G_xcoPSZB0VAQ","qmk1.rzVYvfoUQ_VyMFSqaXeRGluyd4BcTho_7pEcZeh2rbA","qmk1.xJ1jN1C0ToGB8h2xMnz0lnO9XXBAlk0XUPecA_e36dM","qmk1.yhl9gXMu558AV1g5R0GDIDZ-OHVEFi0II818zkYRdOM","qmk1.zQu_09TkJac2TN21hY9ka53Xz557DaP5bxeYYlITTYg"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.qHg4xqqw2sso_vgKj-ubchKTelFi1ZDmLb_rFVqV5o8","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
