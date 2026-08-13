# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `e5d924c109d670667dd7b862ac2bc1a648a898e3` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.9vQVqnGMTsIP2ivAk1e2AQoQEBV4-mjyzD7EmS16m5Q"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.-SwbpyDvd94umdXPFf1Wzj2hxD38FpzDIspCrt6-sRQ","qmk1.7mB8FilRlja_b-o6TgKAnG1vk_IIiOb8kTFbUIz3txo","qmk1.JtY1CFN8pnY2nvBGycDlyUEq8hvbXQLhE2dfDalJG84","qmk1.KkL5NxRan8kbcm6TdgykrVdneN27E4H7po062HE8Ui0","qmk1.PeCvDGfALADSKCJgtsnY8k4VBf1ocXaj1Y2FwHox_po","qmk1.QM49bjAsNiMWKH_koUw198Iy-8-PcMaRxMRcICnoKaw","qmk1.QZ1sIHoXXNowR0NFSCS_YrCzoWlqSMjDm2ncAA0GQIk","qmk1.UDHxAsCOonXdrs8QVWXt0h5GSGWGx08i-oOn43F2p3o","qmk1._16UMZ7jq-zTZPoQ4bEyoem65YbBslsfVLFWll_GNO0","qmk1._PycNv3S5jJ32cbaXx4mbXglei-wM3BeKatBIVRfhfM","qmk1.bgUfas2xAhwf5ngEbxvynUcb9v1TtA70BMluGSYsgMA","qmk1.j6scZnEFV43IWNuhrYaX6vX4OzJUTSoXrmBD6_DuHmc","qmk1.o1sVCT0juFKZXcPEeKyX9rkLNbi8heRy9tU-yj32Mp0","qmk1.qTqJ4Y0Fnn88HHsfGqKCLeIvQOBh2El2DTt3YwQAMRg","qmk1.qt3UzvIqirn7mh97s9PwvypoyLdydoW_cHWAoX9w2uE","qmk1.qy7x97UTO2KH3pO3sOMs18ei4GHk3jjc25yHXzxTPlc","qmk1.tyrQO8O9U3rUSeKFBGp0yMtoOs2JnaXbmTGpV9BbOC0","qmk1.w7HXI7Wm8y6hg-vHwzunX4omsmaYIiDFwv0_QH3RupE","qmk1.yo-4EmE-4bMnlRUkYIpkDOeKPQlOSv8yAurL3keSrMM","qmk1.z6z0Q23eZmd5LR4JuAamtwZC4AXYJHHbq5_QcFLKDN0"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.9vQVqnGMTsIP2ivAk1e2AQoQEBV4-mjyzD7EmS16m5Q","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.9vQVqnGMTsIP2ivAk1e2AQoQEBV4-mjyzD7EmS16m5Q"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.-SwbpyDvd94umdXPFf1Wzj2hxD38FpzDIspCrt6-sRQ","qmk1.7mB8FilRlja_b-o6TgKAnG1vk_IIiOb8kTFbUIz3txo","qmk1.JtY1CFN8pnY2nvBGycDlyUEq8hvbXQLhE2dfDalJG84","qmk1.KkL5NxRan8kbcm6TdgykrVdneN27E4H7po062HE8Ui0","qmk1.PeCvDGfALADSKCJgtsnY8k4VBf1ocXaj1Y2FwHox_po","qmk1.QM49bjAsNiMWKH_koUw198Iy-8-PcMaRxMRcICnoKaw","qmk1.QZ1sIHoXXNowR0NFSCS_YrCzoWlqSMjDm2ncAA0GQIk","qmk1.UDHxAsCOonXdrs8QVWXt0h5GSGWGx08i-oOn43F2p3o","qmk1._16UMZ7jq-zTZPoQ4bEyoem65YbBslsfVLFWll_GNO0","qmk1._PycNv3S5jJ32cbaXx4mbXglei-wM3BeKatBIVRfhfM","qmk1.bgUfas2xAhwf5ngEbxvynUcb9v1TtA70BMluGSYsgMA","qmk1.j6scZnEFV43IWNuhrYaX6vX4OzJUTSoXrmBD6_DuHmc","qmk1.o1sVCT0juFKZXcPEeKyX9rkLNbi8heRy9tU-yj32Mp0","qmk1.qTqJ4Y0Fnn88HHsfGqKCLeIvQOBh2El2DTt3YwQAMRg","qmk1.qt3UzvIqirn7mh97s9PwvypoyLdydoW_cHWAoX9w2uE","qmk1.qy7x97UTO2KH3pO3sOMs18ei4GHk3jjc25yHXzxTPlc","qmk1.tyrQO8O9U3rUSeKFBGp0yMtoOs2JnaXbmTGpV9BbOC0","qmk1.w7HXI7Wm8y6hg-vHwzunX4omsmaYIiDFwv0_QH3RupE","qmk1.yo-4EmE-4bMnlRUkYIpkDOeKPQlOSv8yAurL3keSrMM","qmk1.z6z0Q23eZmd5LR4JuAamtwZC4AXYJHHbq5_QcFLKDN0"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.9vQVqnGMTsIP2ivAk1e2AQoQEBV4-mjyzD7EmS16m5Q","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
