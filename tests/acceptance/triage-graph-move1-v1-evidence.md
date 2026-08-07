# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `faf77f6d869c04662b40de7c5cf7bb4c6412959a` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.PA5Cmywy59doe1RMvfmTDNTAlxc3OKKXGfjN9txx-9M"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.-fVPq-vsMXAT19CommfbchNTc_LQ7KK8A4SBlgmJcb4","qmk1.-nmk3EGt3p-H1vjCOUvt6nUU0t5ccSwHMjawr6Drdds","qmk1.BPv-6fQm1mSYxgG-AveSGLztyq1jF_1MFpVP39Ex6a0","qmk1.Cc7i01HDaF362BugDTDnadj7F49DbMtdYLn26euMVxc","qmk1.D48nfj5uUEVyLv8GRJ55lYmUmJDHALeFIsx8turU7ik","qmk1.G9aZaXrIti17RnGSIcn-_KU2ZXK6xOM24ajzGZZ9foA","qmk1.IFqq8TnIBjeceLQfP-6eHFBaSrAv71V8LcJlLTe0AVI","qmk1.UOLb9_vqCZpYb_0zfDdONqdXNCFLD7_oSg7tcDLnoB0","qmk1.Xhvxw-zpeJJlhEv4d7OQGsoUI672C3h9QRekUThMdds","qmk1.Xz1Oj5FgQs1uDRCkCJut--MwmemW4fBNNVqzIoRHOzY","qmk1.axxadgaD8q_fUpJMBcjhoJ-JV5Sb1OTcMEgQ0Yob8nY","qmk1.h6dj9lG6B28GDSaHGQ4PFVonuQLCY2dgX600lS3U2zY","qmk1.hUUPWLjB69OeHM5sNibk1JrwlgIxiPpUKr7qo2nwt48","qmk1.jguts-piAOoKGCDM5od1087YjaBjU4By0VWULqb_kTA","qmk1.mvAQ5MEMNiCsF9Phv9Sg4JjtVl_8bDjFBnZTT2pAHtk","qmk1.ndbZuFsJZZzQus74kOCtIdAqDhwpXZXfab1zmHdBNS4","qmk1.sBIBmQuBujAQHUlHu2NRFh9t64NukKnYzuhPj_yUGOY","qmk1.wE6b77WTfRVyUiFyMp4tcUFfF-6DN1Bd1FP23-4wVI8","qmk1.yIHkmZ3LvV043osxje1Y7S0sYYep2rqS6Q-_Z7KmmkQ","qmk1.yt-g163On94IqG0nMmZS4DIk03l6_w-G9nJTJxQvAYM"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.PA5Cmywy59doe1RMvfmTDNTAlxc3OKKXGfjN9txx-9M","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.PA5Cmywy59doe1RMvfmTDNTAlxc3OKKXGfjN9txx-9M"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.-fVPq-vsMXAT19CommfbchNTc_LQ7KK8A4SBlgmJcb4","qmk1.-nmk3EGt3p-H1vjCOUvt6nUU0t5ccSwHMjawr6Drdds","qmk1.BPv-6fQm1mSYxgG-AveSGLztyq1jF_1MFpVP39Ex6a0","qmk1.Cc7i01HDaF362BugDTDnadj7F49DbMtdYLn26euMVxc","qmk1.D48nfj5uUEVyLv8GRJ55lYmUmJDHALeFIsx8turU7ik","qmk1.G9aZaXrIti17RnGSIcn-_KU2ZXK6xOM24ajzGZZ9foA","qmk1.IFqq8TnIBjeceLQfP-6eHFBaSrAv71V8LcJlLTe0AVI","qmk1.UOLb9_vqCZpYb_0zfDdONqdXNCFLD7_oSg7tcDLnoB0","qmk1.Xhvxw-zpeJJlhEv4d7OQGsoUI672C3h9QRekUThMdds","qmk1.Xz1Oj5FgQs1uDRCkCJut--MwmemW4fBNNVqzIoRHOzY","qmk1.axxadgaD8q_fUpJMBcjhoJ-JV5Sb1OTcMEgQ0Yob8nY","qmk1.h6dj9lG6B28GDSaHGQ4PFVonuQLCY2dgX600lS3U2zY","qmk1.hUUPWLjB69OeHM5sNibk1JrwlgIxiPpUKr7qo2nwt48","qmk1.jguts-piAOoKGCDM5od1087YjaBjU4By0VWULqb_kTA","qmk1.mvAQ5MEMNiCsF9Phv9Sg4JjtVl_8bDjFBnZTT2pAHtk","qmk1.ndbZuFsJZZzQus74kOCtIdAqDhwpXZXfab1zmHdBNS4","qmk1.sBIBmQuBujAQHUlHu2NRFh9t64NukKnYzuhPj_yUGOY","qmk1.wE6b77WTfRVyUiFyMp4tcUFfF-6DN1Bd1FP23-4wVI8","qmk1.yIHkmZ3LvV043osxje1Y7S0sYYep2rqS6Q-_Z7KmmkQ","qmk1.yt-g163On94IqG0nMmZS4DIk03l6_w-G9nJTJxQvAYM"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.PA5Cmywy59doe1RMvfmTDNTAlxc3OKKXGfjN9txx-9M","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
