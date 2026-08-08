# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `1cb7e39417cf6fdb9844df30362d50cb5dadc5d9` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.Wz6wH5V5jA86RDrINJbOB7XhYzyk1HpohKvG4E9xK10"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.1C8wVNBv0ZvXYVAQNrZLMadjPR_RqIyXiXInnkQwwrM","qmk1.7yjm0K-OqDXTbg19ADtExST-vWs0nFckGIlMaFzIJFc","qmk1.8s23jf_unvaHZy81edXvjxDUx06nWSN_tGvpB6R3--c","qmk1.DwsI1a5K2OfxjP4wUufi5-5zBW8-ZwTpB-AohA2pt5k","qmk1.EMaG39TFSxHGguqE8gwvTn4sPXhTcks80QxOZkH1QW8","qmk1.F2BHuIJYe8YGqRTgHGxVbSczu0aXMNlhWcu1TzgwE0M","qmk1.KEJMiy2p7jhK2lrJCMsm0MQiC0x7_8ot4vB3fJZgcig","qmk1.OxFOf2X3pIo2vlZP4yDONMXFK90CpzbXig9lg5W-_xQ","qmk1.QYSVTk8G_qsadMFABL3q9oKMm-eG2h-yGciliIkgRr0","qmk1.QeFQvCLE8KEJ-SHs24AE9KLYmllooJ3q_oIjYUEaGPI","qmk1.aw8fKlGAfsJq0kczawkgzdRFkVztkVQeQzgvTRQN5oM","qmk1.awywo3h0cU8ltylizXbIhm5h3tDXvRT6B7vTQuchRr8","qmk1.brqaHwIjw2kybfs4y0uYuLnKdjbSowb0bGNMNigYLOg","qmk1.gVF9PH29FH9x5hV4GsMOBuYOHKErpOQvX7ht67jaT2w","qmk1.hIfrIemrg68tSk35Du0UMxNWHqMZnKaTIzscPZq5XBU","qmk1.hctzoo4rT_UJpsUCsvMqi4-YriIzCRo5Ex0XQf6KkkI","qmk1.pITh1I1gRT2vlT84aO6DrQaRiF5F622mJWAEZRTIQFA","qmk1.saryv8GILYyIlyOBqHL27AoZU41qBbAY-zMCAGItuKA","qmk1.xbNZjH-Hoj247KQ1S6v0wYlBukaiMkG1jFWntnI_Rlo","qmk1.ys6AeGrM5anC_oTVlnuJTnEA0jS8Gd6ZrfZ-GCiAExU"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.Wz6wH5V5jA86RDrINJbOB7XhYzyk1HpohKvG4E9xK10","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.Wz6wH5V5jA86RDrINJbOB7XhYzyk1HpohKvG4E9xK10"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.1C8wVNBv0ZvXYVAQNrZLMadjPR_RqIyXiXInnkQwwrM","qmk1.7yjm0K-OqDXTbg19ADtExST-vWs0nFckGIlMaFzIJFc","qmk1.8s23jf_unvaHZy81edXvjxDUx06nWSN_tGvpB6R3--c","qmk1.DwsI1a5K2OfxjP4wUufi5-5zBW8-ZwTpB-AohA2pt5k","qmk1.EMaG39TFSxHGguqE8gwvTn4sPXhTcks80QxOZkH1QW8","qmk1.F2BHuIJYe8YGqRTgHGxVbSczu0aXMNlhWcu1TzgwE0M","qmk1.KEJMiy2p7jhK2lrJCMsm0MQiC0x7_8ot4vB3fJZgcig","qmk1.OxFOf2X3pIo2vlZP4yDONMXFK90CpzbXig9lg5W-_xQ","qmk1.QYSVTk8G_qsadMFABL3q9oKMm-eG2h-yGciliIkgRr0","qmk1.QeFQvCLE8KEJ-SHs24AE9KLYmllooJ3q_oIjYUEaGPI","qmk1.aw8fKlGAfsJq0kczawkgzdRFkVztkVQeQzgvTRQN5oM","qmk1.awywo3h0cU8ltylizXbIhm5h3tDXvRT6B7vTQuchRr8","qmk1.brqaHwIjw2kybfs4y0uYuLnKdjbSowb0bGNMNigYLOg","qmk1.gVF9PH29FH9x5hV4GsMOBuYOHKErpOQvX7ht67jaT2w","qmk1.hIfrIemrg68tSk35Du0UMxNWHqMZnKaTIzscPZq5XBU","qmk1.hctzoo4rT_UJpsUCsvMqi4-YriIzCRo5Ex0XQf6KkkI","qmk1.pITh1I1gRT2vlT84aO6DrQaRiF5F622mJWAEZRTIQFA","qmk1.saryv8GILYyIlyOBqHL27AoZU41qBbAY-zMCAGItuKA","qmk1.xbNZjH-Hoj247KQ1S6v0wYlBukaiMkG1jFWntnI_Rlo","qmk1.ys6AeGrM5anC_oTVlnuJTnEA0jS8Gd6ZrfZ-GCiAExU"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.Wz6wH5V5jA86RDrINJbOB7XhYzyk1HpohKvG4E9xK10","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
