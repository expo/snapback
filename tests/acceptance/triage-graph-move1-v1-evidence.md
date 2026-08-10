# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `c6162230643b8e84f467df94a8beacc360b8efb4` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.GRmTAwhYQxQMstScp4154TcgiAyDddRpHM0Yz3wvtrI"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.1an0Q9EWxIrR2G1nfDTkRFuAT6weSNH9HV1Ma8EQbJo","qmk1.8-N-535LpZgmNQxBYE3V0NWMAO2nPx7nroeI5jm0hjY","qmk1.8EMI5Q9d6FjW8HDd3Ud3sY6gBuflh_Vqgt3AoZD8nJ8","qmk1.Cf6oxGmgOp0BMRTmKcrsmnCXUTM7uQRj0AaKSk4OUwc","qmk1.E9dpy7i67EWvi_8wpMyzZ3vP8CgzABp5G_89On15p4U","qmk1.FamFpDNSHO1lFxWbiXXz9-wYOmnf94-cdSQ5e0T9Gww","qmk1.Kk7Vjq3fNNV6CzSJF9jk7QBLzPwSr9EVd5pA4nj_Mjw","qmk1.Pw1ygF_hcNzMeb3tkvZlzSoANu36kin4tTW6idpe9Jo","qmk1.WGSRaQKqG9xauUWVBXgLORY07ORgzAGmNyZO6qTE1Ak","qmk1.XXAiq0ppaZ0tYVSdC16N4SIgVMk1F6wEmu2viat7p-g","qmk1.Zq2xl-jYBkgUeYJnP36fQA5CBaLB1jc-SI8WtxqF79w","qmk1._OmCXIYft8AprSILu0geO0HTNu08gLhYOamIlIyp-oc","qmk1.e4Si_o34hJ4bseTx6kXKYBWaHPYCM4i-5JH7xrSUsk0","qmk1.eGcIG_ZIa3-nbhs3uzMugz45oSGOAwLu9V3_5j2Jrqs","qmk1.gp2hZ6IdY9fh6ZYiUOSjEGGTyHfgEtLe4R0fdA0nbbc","qmk1.nC2Iab8zcCCApAuXL8uptfSPZIqJTBNba5r6qyya-7I","qmk1.oGJvdRvLUv_6qxVHMM5Io5ojIPJFYL6N8jZD9-Lswko","qmk1.uIfq6oHVGTiUUma037zcXogo1E5RGg4uAt9C5IcJVrY","qmk1.vNjmxqcyqlB1ySWum729aH3Lxk9EREGRaaea2TdNJzg","qmk1.y9f6Ykd0uj4fzl2RghWOZZNNLm8G8ymBFDRoe4oPJ58"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.GRmTAwhYQxQMstScp4154TcgiAyDddRpHM0Yz3wvtrI","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.GRmTAwhYQxQMstScp4154TcgiAyDddRpHM0Yz3wvtrI"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.1an0Q9EWxIrR2G1nfDTkRFuAT6weSNH9HV1Ma8EQbJo","qmk1.8-N-535LpZgmNQxBYE3V0NWMAO2nPx7nroeI5jm0hjY","qmk1.8EMI5Q9d6FjW8HDd3Ud3sY6gBuflh_Vqgt3AoZD8nJ8","qmk1.Cf6oxGmgOp0BMRTmKcrsmnCXUTM7uQRj0AaKSk4OUwc","qmk1.E9dpy7i67EWvi_8wpMyzZ3vP8CgzABp5G_89On15p4U","qmk1.FamFpDNSHO1lFxWbiXXz9-wYOmnf94-cdSQ5e0T9Gww","qmk1.Kk7Vjq3fNNV6CzSJF9jk7QBLzPwSr9EVd5pA4nj_Mjw","qmk1.Pw1ygF_hcNzMeb3tkvZlzSoANu36kin4tTW6idpe9Jo","qmk1.WGSRaQKqG9xauUWVBXgLORY07ORgzAGmNyZO6qTE1Ak","qmk1.XXAiq0ppaZ0tYVSdC16N4SIgVMk1F6wEmu2viat7p-g","qmk1.Zq2xl-jYBkgUeYJnP36fQA5CBaLB1jc-SI8WtxqF79w","qmk1._OmCXIYft8AprSILu0geO0HTNu08gLhYOamIlIyp-oc","qmk1.e4Si_o34hJ4bseTx6kXKYBWaHPYCM4i-5JH7xrSUsk0","qmk1.eGcIG_ZIa3-nbhs3uzMugz45oSGOAwLu9V3_5j2Jrqs","qmk1.gp2hZ6IdY9fh6ZYiUOSjEGGTyHfgEtLe4R0fdA0nbbc","qmk1.nC2Iab8zcCCApAuXL8uptfSPZIqJTBNba5r6qyya-7I","qmk1.oGJvdRvLUv_6qxVHMM5Io5ojIPJFYL6N8jZD9-Lswko","qmk1.uIfq6oHVGTiUUma037zcXogo1E5RGg4uAt9C5IcJVrY","qmk1.vNjmxqcyqlB1ySWum729aH3Lxk9EREGRaaea2TdNJzg","qmk1.y9f6Ykd0uj4fzl2RghWOZZNNLm8G8ymBFDRoe4oPJ58"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.GRmTAwhYQxQMstScp4154TcgiAyDddRpHM0Yz3wvtrI","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
