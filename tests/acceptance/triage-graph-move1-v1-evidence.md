# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `8860d3fb269a35d424bd745b064d73bd793d6b29` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.Ii4g_m3vn8wJTAWsQpMTRb4qNFUajp7vKT1ayfxVqMU"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.AVFsapW23gRm689SkM4FZcjnD-zA-A1WYCtayownH4M","qmk1.CXpWSRL0xoI3-yUNvaUWCiGht-6nNhfUpDgyPLDJcYg","qmk1.GGLp5gZLWJ2j3UYBR66UP_-C5dt5buw-TeXoC1wymOQ","qmk1.JPf3HlIYffXyPlHSZEnh3KKQyZvEDi14baE1F2lGDyI","qmk1.QnCj0gSJDFn4Wilpjb_a2LZjZtNsRa25j-i818ZX6GE","qmk1.ZAXAemAveeGS7QmJ55wM8C4MI0sPMdcfl-pax1WjFIE","qmk1.ZgExUbW1Hpu1E4YHSD-SfH5n_RrzcOANeqR0WPD_yEw","qmk1.buPuDofQ6i8Hd41lm8-Yrw99rT0RdQXJaI3rup_b8VI","qmk1.d9e27PJBYyeU9cLn5K1YFzr8cegurmIf6ZKiOOtUurg","qmk1.fv9LaIcNVvRE04VWENQfLNYTE9zaTBTDDy9i4r8LENQ","qmk1.glR3vqk8nvdFTlAWWQBNH_wag1v1l9TJY_MPTzBT6BM","qmk1.jdX8fDGwfEY9BygKkFCRHjroMj3CRdauGC8wJ9aI5NA","qmk1.jvmHgUIPeTGKUOb-AgvdjIxmAgH2djbvmvlth8-IQf0","qmk1.lEo9aTgXsXYoEswFhoGUTiAuI-GeX3pMrwT3RmjN82U","qmk1.n9a-tw2Pqb5rqMuv5B2BA84dfX1e--IZBBmV_YjrdPM","qmk1.qKYKuVUztV96n4RI5vR755xQt_-YRA_Y30Dk_u_Aaic","qmk1.qRNsf_YM-FFc16XQ1Kx0dpI2u8AThIup623tJJuzqy0","qmk1.vbN2PouFSoPWUWsg0t8nQPDmZgwb62LUegejwwTy214","qmk1.y27GLEQgEwC_xudmeAxFY68dcBvuy6dO9QaUNFtFKo8","qmk1.yfcllwxHY4g07Bt0hlUTVJOuc7wB46RNY5YdTF9-6Ek"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.Ii4g_m3vn8wJTAWsQpMTRb4qNFUajp7vKT1ayfxVqMU","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.Ii4g_m3vn8wJTAWsQpMTRb4qNFUajp7vKT1ayfxVqMU"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.AVFsapW23gRm689SkM4FZcjnD-zA-A1WYCtayownH4M","qmk1.CXpWSRL0xoI3-yUNvaUWCiGht-6nNhfUpDgyPLDJcYg","qmk1.GGLp5gZLWJ2j3UYBR66UP_-C5dt5buw-TeXoC1wymOQ","qmk1.JPf3HlIYffXyPlHSZEnh3KKQyZvEDi14baE1F2lGDyI","qmk1.QnCj0gSJDFn4Wilpjb_a2LZjZtNsRa25j-i818ZX6GE","qmk1.ZAXAemAveeGS7QmJ55wM8C4MI0sPMdcfl-pax1WjFIE","qmk1.ZgExUbW1Hpu1E4YHSD-SfH5n_RrzcOANeqR0WPD_yEw","qmk1.buPuDofQ6i8Hd41lm8-Yrw99rT0RdQXJaI3rup_b8VI","qmk1.d9e27PJBYyeU9cLn5K1YFzr8cegurmIf6ZKiOOtUurg","qmk1.fv9LaIcNVvRE04VWENQfLNYTE9zaTBTDDy9i4r8LENQ","qmk1.glR3vqk8nvdFTlAWWQBNH_wag1v1l9TJY_MPTzBT6BM","qmk1.jdX8fDGwfEY9BygKkFCRHjroMj3CRdauGC8wJ9aI5NA","qmk1.jvmHgUIPeTGKUOb-AgvdjIxmAgH2djbvmvlth8-IQf0","qmk1.lEo9aTgXsXYoEswFhoGUTiAuI-GeX3pMrwT3RmjN82U","qmk1.n9a-tw2Pqb5rqMuv5B2BA84dfX1e--IZBBmV_YjrdPM","qmk1.qKYKuVUztV96n4RI5vR755xQt_-YRA_Y30Dk_u_Aaic","qmk1.qRNsf_YM-FFc16XQ1Kx0dpI2u8AThIup623tJJuzqy0","qmk1.vbN2PouFSoPWUWsg0t8nQPDmZgwb62LUegejwwTy214","qmk1.y27GLEQgEwC_xudmeAxFY68dcBvuy6dO9QaUNFtFKo8","qmk1.yfcllwxHY4g07Bt0hlUTVJOuc7wB46RNY5YdTF9-6Ek"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.Ii4g_m3vn8wJTAWsQpMTRb4qNFUajp7vKT1ayfxVqMU","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
