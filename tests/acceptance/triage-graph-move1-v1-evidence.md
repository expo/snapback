# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `c6a8be9699e6a8ca5b8f89eed14316588a963945` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.6lXh4ntvFZpIamEUEHh4TvkkU-XNn0X_nV48AUFD8f0"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.01nrl0qPZ68D8ToDMrYU7zGCQ6e5mUEGGmbC8CwcdXA","qmk1.16X5zTTuI-VDv1gM2KgmJWLWRxgDKAnn7C6ly4w2I3U","qmk1.8JW2EBLZl2OH25l5VtRfbpfK-W3JMz5mrF-cLbSNS_g","qmk1.8LeaYM_GBob9jaXigEf0Kt1N6byZJhrYJcwugs0SvzE","qmk1.9cvbsoBF8oyaReKUhuDUMWVhjXQ6gAyFwzyrx718ywU","qmk1.EArqlMC-u6RFOnFL1jkxYxKULTkzvzyM2Y5gPUm9h7I","qmk1.NRkWGqeDMjImJ2bLevoTp_0jTOJyNnOJvHwvDVp2G-Y","qmk1.T04XRUN3gPFtxrizWXRC5wcXRb9jbDDVf5vaC6asdBE","qmk1.T3HRnL1qnMgq3-Ks-9W-BLuO8M1y_tzXqx3uiTySvzQ","qmk1.Uu431PzeC7VxQ3AOfwJfLDTZujqYhvjvxzXhpyKfR2k","qmk1.V8aal4TZTO2RXqXNQ3VGpxWqTiEGHDfIpRCP5MiMaM4","qmk1.Y2n5gZO5-kq1KYWEngvq0-AuMqLUi_kQGP_Jhd22zkU","qmk1.bz8Fn3WFm9WxG8y_WmZCEAL-Uj_Fv0hN0LCkaYmig74","qmk1.fhvxEEokpSo2u7E2w9hlG1-uTBlixf01YDZv4AJpfLY","qmk1.heDP0j9lZHSHdbKT23OBC-jSCYQL0H2ygShUcLgPGqg","qmk1.pG4S9j2oxQsWQTg0nig9SSRm1K7A-yVY8x4y0ijDPDc","qmk1.r85cK-IOL6Nixr6CA-pBwokMSi6l9Xf-HwD9EsROoSY","qmk1.rvG6o9YP1Ns2PObyJN-B22GwCLTZvybjdkn0Nul4Y_E","qmk1.sCrOYFL_BCPiM3g0BM-NaYXVrLaQWf9l4VazD0vX2S4","qmk1.szB2bW6mF5FEoEGVPw4Rb_f0xVgZzETERdgl0ZmpWhA"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.6lXh4ntvFZpIamEUEHh4TvkkU-XNn0X_nV48AUFD8f0","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.6lXh4ntvFZpIamEUEHh4TvkkU-XNn0X_nV48AUFD8f0"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.01nrl0qPZ68D8ToDMrYU7zGCQ6e5mUEGGmbC8CwcdXA","qmk1.16X5zTTuI-VDv1gM2KgmJWLWRxgDKAnn7C6ly4w2I3U","qmk1.8JW2EBLZl2OH25l5VtRfbpfK-W3JMz5mrF-cLbSNS_g","qmk1.8LeaYM_GBob9jaXigEf0Kt1N6byZJhrYJcwugs0SvzE","qmk1.9cvbsoBF8oyaReKUhuDUMWVhjXQ6gAyFwzyrx718ywU","qmk1.EArqlMC-u6RFOnFL1jkxYxKULTkzvzyM2Y5gPUm9h7I","qmk1.NRkWGqeDMjImJ2bLevoTp_0jTOJyNnOJvHwvDVp2G-Y","qmk1.T04XRUN3gPFtxrizWXRC5wcXRb9jbDDVf5vaC6asdBE","qmk1.T3HRnL1qnMgq3-Ks-9W-BLuO8M1y_tzXqx3uiTySvzQ","qmk1.Uu431PzeC7VxQ3AOfwJfLDTZujqYhvjvxzXhpyKfR2k","qmk1.V8aal4TZTO2RXqXNQ3VGpxWqTiEGHDfIpRCP5MiMaM4","qmk1.Y2n5gZO5-kq1KYWEngvq0-AuMqLUi_kQGP_Jhd22zkU","qmk1.bz8Fn3WFm9WxG8y_WmZCEAL-Uj_Fv0hN0LCkaYmig74","qmk1.fhvxEEokpSo2u7E2w9hlG1-uTBlixf01YDZv4AJpfLY","qmk1.heDP0j9lZHSHdbKT23OBC-jSCYQL0H2ygShUcLgPGqg","qmk1.pG4S9j2oxQsWQTg0nig9SSRm1K7A-yVY8x4y0ijDPDc","qmk1.r85cK-IOL6Nixr6CA-pBwokMSi6l9Xf-HwD9EsROoSY","qmk1.rvG6o9YP1Ns2PObyJN-B22GwCLTZvybjdkn0Nul4Y_E","qmk1.sCrOYFL_BCPiM3g0BM-NaYXVrLaQWf9l4VazD0vX2S4","qmk1.szB2bW6mF5FEoEGVPw4Rb_f0xVgZzETERdgl0ZmpWhA"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.6lXh4ntvFZpIamEUEHh4TvkkU-XNn0X_nV48AUFD8f0","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
