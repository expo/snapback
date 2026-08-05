# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-04
**Source revision:** `779c4f16985d375d66a6a52b2a9932cfb8386de7` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.qnkTJfLPF5KhMqXeM7LzvN0zpgux5nYccAnB5LvRCNQ"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.-UP4WgoR2zlDQt0qvfQZAyX5xaV2glTw5aCHOJXVAvs","qmk1.-gZKg7QHAyiiqT0-P-BVGlXPJo-zfzoQK0lUUJad8Fk","qmk1.08ddO-HQl9pFwtca-_3sj_Wu397aHVZ_hM3cc-tj8PM","qmk1.9ArnFTIen9bHJUjDueAXJd1aUdl9RcQFqnOhyXQiH0I","qmk1.9CyM1Y304VD6kr3kePuvp36nb-66xFd7bzUV-rco_7U","qmk1.CmPGvAaRO0c7NUpZ0IZqdjuaAlAridgYoTdyYqViCQw","qmk1.NBPq9nYefCV_Mv9eA2MHI1mKiI6ersxc33-qyrFjVow","qmk1.O5PyBWaMN2MUV7wejqYEAmqLCBpEZRoaChmCXOyvIAQ","qmk1.Xdb3WzDnWDyII8apvZg6OrAybM6_NvzPqMWgWUgoHpY","qmk1.YHJq5_UNKZdvOAVa9RHYVByG4JkIiBp9UiktH3onJnA","qmk1.Yx9GmPhvnpALsppRWvZJTtHYzz1qn4r8nJMp7QkozEE","qmk1.f96VkzK5urzfCRnO-uZao2MYe6HyG1irrmmHWPumJJY","qmk1.fKMzaw91ji7-8B1n7HOzpZX3_g1Her4_DBNFIM8Jwuo","qmk1.hCxQNTLtwGceLsa37ktk8yhWwpDJqEPeEfv8Ff2bMmU","qmk1.iLlDWo_hPUKfsFv0QHCv8XZ6BDu5n3eV7GGdIF2n5iY","qmk1.mQriRVduX_KpxfLwFXk0NA1bDBO7CS7zUbl7tTPEWtI","qmk1.nfjkjNtBQaK_R3HBRoDVjMnT1q0PIA5feMos2ewiGo0","qmk1.vJN9MhHTaYduDlSCmXH08HsUN0OcvymXv-v1iUVpkvo","qmk1.wfnB3dp_SKETd2S5DMUaiFhefQmK7wC9ig5mkw-LTSc","qmk1.xxaSGcGdq8khv-Y_B8EAAEuzW2NOEy1pe-iiSZHIWBc"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.qnkTJfLPF5KhMqXeM7LzvN0zpgux5nYccAnB5LvRCNQ","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.qnkTJfLPF5KhMqXeM7LzvN0zpgux5nYccAnB5LvRCNQ"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.-UP4WgoR2zlDQt0qvfQZAyX5xaV2glTw5aCHOJXVAvs","qmk1.-gZKg7QHAyiiqT0-P-BVGlXPJo-zfzoQK0lUUJad8Fk","qmk1.08ddO-HQl9pFwtca-_3sj_Wu397aHVZ_hM3cc-tj8PM","qmk1.9ArnFTIen9bHJUjDueAXJd1aUdl9RcQFqnOhyXQiH0I","qmk1.9CyM1Y304VD6kr3kePuvp36nb-66xFd7bzUV-rco_7U","qmk1.CmPGvAaRO0c7NUpZ0IZqdjuaAlAridgYoTdyYqViCQw","qmk1.NBPq9nYefCV_Mv9eA2MHI1mKiI6ersxc33-qyrFjVow","qmk1.O5PyBWaMN2MUV7wejqYEAmqLCBpEZRoaChmCXOyvIAQ","qmk1.Xdb3WzDnWDyII8apvZg6OrAybM6_NvzPqMWgWUgoHpY","qmk1.YHJq5_UNKZdvOAVa9RHYVByG4JkIiBp9UiktH3onJnA","qmk1.Yx9GmPhvnpALsppRWvZJTtHYzz1qn4r8nJMp7QkozEE","qmk1.f96VkzK5urzfCRnO-uZao2MYe6HyG1irrmmHWPumJJY","qmk1.fKMzaw91ji7-8B1n7HOzpZX3_g1Her4_DBNFIM8Jwuo","qmk1.hCxQNTLtwGceLsa37ktk8yhWwpDJqEPeEfv8Ff2bMmU","qmk1.iLlDWo_hPUKfsFv0QHCv8XZ6BDu5n3eV7GGdIF2n5iY","qmk1.mQriRVduX_KpxfLwFXk0NA1bDBO7CS7zUbl7tTPEWtI","qmk1.nfjkjNtBQaK_R3HBRoDVjMnT1q0PIA5feMos2ewiGo0","qmk1.vJN9MhHTaYduDlSCmXH08HsUN0OcvymXv-v1iUVpkvo","qmk1.wfnB3dp_SKETd2S5DMUaiFhefQmK7wC9ig5mkw-LTSc","qmk1.xxaSGcGdq8khv-Y_B8EAAEuzW2NOEy1pe-iiSZHIWBc"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.qnkTJfLPF5KhMqXeM7LzvN0zpgux5nYccAnB5LvRCNQ","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
