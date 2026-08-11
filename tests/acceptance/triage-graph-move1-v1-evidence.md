# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `c71222e8480ed0cde87fa9f16fa141146bade020` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.BtXDrCh2N12Axa_0WKT9yhFHbrtSH2b7VLuFrkJnB7I"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.0Khst007XeFwE3WUo1qIK65FbcBo8nEk9go6dffauTA","qmk1.1uz4iNcfx0j0wxG2DUhH93nx64ew-hVEc8WQbbsVl-I","qmk1.3nNtlABkXma8ifxa8aDs6eUN0qziz4spC3dtZw8uW2k","qmk1.5gjE_W5UadMbm1ZBm7Gf8lgTUAXvIX1e9i71r3O2_aY","qmk1.7x7hayd5dWVMM5whzsiCPiEddT8zDNGPeYmyD9Jf-B8","qmk1.DevnFLqkbr3Bducz3DLSp2EZ8_0U_K4mdn8q4KoTN9k","qmk1.E2gWzFuwigpurD75a4k0_J_vXqNzj_GWuOyKp-XUFzw","qmk1.FN071tYmDDrweJGvTWgSBfuAntn2vfiONqUfnQ83UP8","qmk1.I-OLrgPwmHY9ujHeh1SfeQP5X5_aazg66k5YpyZL1D8","qmk1.JzljYNTaNcgRUP2qztz9quhVtunmqAH1zBBi6OqC0Cs","qmk1.K1DzYbdsdZIoTwSN81nVaX91wBiMpFmSnQaEfM3DnD0","qmk1.L1GPDtYCUC6g297fkZjQWk2Hq7DdePllrfzniNluC4A","qmk1.Mo0e-QOv1hdH9hEDlMC6S50CMShrVcvTx3_IWQCVLFU","qmk1.Pa7P2Zgl2gU1_nJsn-6bxEaXo1t1_XDcPurJKehlCGk","qmk1.RKQM4CaPu9cajS9qXGzj-OTYV2JyaZAVKULoyOvzz-8","qmk1.VL6FoUY4WQ2iZxtuUtVFMaAEKFKKaaFPBZW6r9xcbDU","qmk1.jSRl1q9OGyhE0YExiWyX58H_Euc7cvJwcTGvpTcv6JU","qmk1.pnw4WFJ0KIfg-j7ZVZa4RgZLWzivn1wKbrCbjpyUF2c","qmk1.uwYXbxQEOpSjZLFJc5UXVj4Ri9oipkTRZ0_zAYaekSw","qmk1.vq5DbRbhn44RhuEiZHYbdqFxY0uf_xk-oUg7O2tIq3Q"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.BtXDrCh2N12Axa_0WKT9yhFHbrtSH2b7VLuFrkJnB7I","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.BtXDrCh2N12Axa_0WKT9yhFHbrtSH2b7VLuFrkJnB7I"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.0Khst007XeFwE3WUo1qIK65FbcBo8nEk9go6dffauTA","qmk1.1uz4iNcfx0j0wxG2DUhH93nx64ew-hVEc8WQbbsVl-I","qmk1.3nNtlABkXma8ifxa8aDs6eUN0qziz4spC3dtZw8uW2k","qmk1.5gjE_W5UadMbm1ZBm7Gf8lgTUAXvIX1e9i71r3O2_aY","qmk1.7x7hayd5dWVMM5whzsiCPiEddT8zDNGPeYmyD9Jf-B8","qmk1.DevnFLqkbr3Bducz3DLSp2EZ8_0U_K4mdn8q4KoTN9k","qmk1.E2gWzFuwigpurD75a4k0_J_vXqNzj_GWuOyKp-XUFzw","qmk1.FN071tYmDDrweJGvTWgSBfuAntn2vfiONqUfnQ83UP8","qmk1.I-OLrgPwmHY9ujHeh1SfeQP5X5_aazg66k5YpyZL1D8","qmk1.JzljYNTaNcgRUP2qztz9quhVtunmqAH1zBBi6OqC0Cs","qmk1.K1DzYbdsdZIoTwSN81nVaX91wBiMpFmSnQaEfM3DnD0","qmk1.L1GPDtYCUC6g297fkZjQWk2Hq7DdePllrfzniNluC4A","qmk1.Mo0e-QOv1hdH9hEDlMC6S50CMShrVcvTx3_IWQCVLFU","qmk1.Pa7P2Zgl2gU1_nJsn-6bxEaXo1t1_XDcPurJKehlCGk","qmk1.RKQM4CaPu9cajS9qXGzj-OTYV2JyaZAVKULoyOvzz-8","qmk1.VL6FoUY4WQ2iZxtuUtVFMaAEKFKKaaFPBZW6r9xcbDU","qmk1.jSRl1q9OGyhE0YExiWyX58H_Euc7cvJwcTGvpTcv6JU","qmk1.pnw4WFJ0KIfg-j7ZVZa4RgZLWzivn1wKbrCbjpyUF2c","qmk1.uwYXbxQEOpSjZLFJc5UXVj4Ri9oipkTRZ0_zAYaekSw","qmk1.vq5DbRbhn44RhuEiZHYbdqFxY0uf_xk-oUg7O2tIq3Q"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.BtXDrCh2N12Axa_0WKT9yhFHbrtSH2b7VLuFrkJnB7I","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
