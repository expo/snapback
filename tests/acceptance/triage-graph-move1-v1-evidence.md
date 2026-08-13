# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `1c772c04ff62504f4566d9ac74052f20b7c29df6` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.yL7pGPYtviYyOMVY1sFRs_UNkvDC8yCUWflGwRVuF6c"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.6AsqVojCWC2JawK-OKA7wuzMxezHyS9N4wlgjU_-MdM","qmk1.78RpJa6VmCE6NtdVRC982pj7heL8i65hG3hU8Cdbz7w","qmk1.A4d8DJGhgVAh3RgNVyfctJsdmyCwK2RmumZbu2fPJIk","qmk1.A_28MHem_zf1zrKG4ZF1XF_Ul6M1BewVag--IkV--dE","qmk1.EwgnNv0YanmWRKr0MdwYDxrYvAV9VFWLGl7cWzjoXjU","qmk1.FOw3_Wxn2QdXbYNhyxaqsqNhTwbdBuT3phVosBLt4tE","qmk1.JaceNy6U6VL1fCWDpZLsvgciZIyiKC5O7onVsOnIAKo","qmk1.QutgYANBY0toXnpL_5T4JAq3qnF6ruZdpnk8Jx2L7ic","qmk1.UdtSLlQiUkP87YoC0HOu24-Llb5hLfj-AoG5y-7hKns","qmk1.fC4c3JvxN1nH49sVf5WYjcwlpRApe8GgYPjsPlo3lAg","qmk1.hyZbwsdcCOigNCld_DQcQAoLkvdOB8Ukygnu8rd2cxM","qmk1.k80sJ0ranx8o9QoAQ1VyzhthmKlalWIQ118SYhErJEU","qmk1.m7M2H3jJTeoJdQJrij7icRd-v07B0ufCWbRdimKVEv0","qmk1.mbF3Pf4KgHEVcMG8O_H3Z8h4GyXRhk_2K7_piQjHCRA","qmk1.qDpyWdsdGpCOL_v3NmXgXoy9Obo8o206WjniyQDYfa8","qmk1.qnBB1MlxfiARoI5VfIjCFP01thpZULh995ovr9bnOb0","qmk1.reCXxi0UerNEXDPLEXkWMeOGMU6AhYW8Y2EGuEJpKsg","qmk1.vyurnR8jH3D5ZRlnYFO_8c8_XZRLjfaYwpPAqKbcTco","qmk1.wbrH01nO36uks4VGifR7VxxfGpQxre7accGjT070zPA","qmk1.yk9uNm1q9Wg36NXSg4mi3U_ChbP9ysnOgBRWZDHvb04"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.yL7pGPYtviYyOMVY1sFRs_UNkvDC8yCUWflGwRVuF6c","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.yL7pGPYtviYyOMVY1sFRs_UNkvDC8yCUWflGwRVuF6c"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.6AsqVojCWC2JawK-OKA7wuzMxezHyS9N4wlgjU_-MdM","qmk1.78RpJa6VmCE6NtdVRC982pj7heL8i65hG3hU8Cdbz7w","qmk1.A4d8DJGhgVAh3RgNVyfctJsdmyCwK2RmumZbu2fPJIk","qmk1.A_28MHem_zf1zrKG4ZF1XF_Ul6M1BewVag--IkV--dE","qmk1.EwgnNv0YanmWRKr0MdwYDxrYvAV9VFWLGl7cWzjoXjU","qmk1.FOw3_Wxn2QdXbYNhyxaqsqNhTwbdBuT3phVosBLt4tE","qmk1.JaceNy6U6VL1fCWDpZLsvgciZIyiKC5O7onVsOnIAKo","qmk1.QutgYANBY0toXnpL_5T4JAq3qnF6ruZdpnk8Jx2L7ic","qmk1.UdtSLlQiUkP87YoC0HOu24-Llb5hLfj-AoG5y-7hKns","qmk1.fC4c3JvxN1nH49sVf5WYjcwlpRApe8GgYPjsPlo3lAg","qmk1.hyZbwsdcCOigNCld_DQcQAoLkvdOB8Ukygnu8rd2cxM","qmk1.k80sJ0ranx8o9QoAQ1VyzhthmKlalWIQ118SYhErJEU","qmk1.m7M2H3jJTeoJdQJrij7icRd-v07B0ufCWbRdimKVEv0","qmk1.mbF3Pf4KgHEVcMG8O_H3Z8h4GyXRhk_2K7_piQjHCRA","qmk1.qDpyWdsdGpCOL_v3NmXgXoy9Obo8o206WjniyQDYfa8","qmk1.qnBB1MlxfiARoI5VfIjCFP01thpZULh995ovr9bnOb0","qmk1.reCXxi0UerNEXDPLEXkWMeOGMU6AhYW8Y2EGuEJpKsg","qmk1.vyurnR8jH3D5ZRlnYFO_8c8_XZRLjfaYwpPAqKbcTco","qmk1.wbrH01nO36uks4VGifR7VxxfGpQxre7accGjT070zPA","qmk1.yk9uNm1q9Wg36NXSg4mi3U_ChbP9ysnOgBRWZDHvb04"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.yL7pGPYtviYyOMVY1sFRs_UNkvDC8yCUWflGwRVuF6c","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
