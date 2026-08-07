# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-06
**Source revision:** `877e01fac68ac133cfc23c3b91b4002a65817606` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.dS9pfhei6hAiG8cWW42yNF24Lnk1qF6GNsi-P9auUiQ"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.0H-2rpacaq_gHLlsnpe5AMmREw9ezVXP9ZbwkLaDtzk","qmk1.0RGMNlyBZCax9MWdfuatOid33_OwOHs826wC26w9aC8","qmk1.3rWU5eVu6LqnDpzck5-cF0awEjLqYelbbzzuSyhh-ro","qmk1.8qfc5ICaFB4SXRq3s_VMGSIhmDGDxhZiePt4OyRFd1A","qmk1.Co5cfgcyv6AQi1yGLf0grv6PUwfZdQOXPbmgt6IxkQM","qmk1.FxVSUlGJpAkFSn9Fc-THm5DZmtWGwJn9LEfVj6dsdiA","qmk1.HSRbqUcFyI5lVasE8CH_Yj4vxDiHa9Cg9SzhEKe3u-Y","qmk1.L7cKUlP1jbnKjPZ685rhqeT4KJCRSfz-SIJlBW3NgSI","qmk1.Na63fOch5yhhov84WGIdnHyz33fpiEmetUpVweHGijc","qmk1.Qw3qqfZgH1J1vclYyjvdzYvI_wNjug4VJzz9Ruq9vN4","qmk1.UZf9o-TvtOL66CnhZQ1lUyXD3mBzOLmG_V3D2a3bJWg","qmk1.VmRZ_wweH_i3zn-uivB6GpnKoYU3kjQRT7NsyoO4vZk","qmk1.YsCnXdJfpXsxqXRk5PiqGJ1npYSANTF9K_knupH12oQ","qmk1.hABqzYOk9qzOh5wDpXBI4Yxq2vshW6nWKIOYttbHNbE","qmk1.iUCEsp70RlH54fue7y0u8921wuP44w44gobSbymhoKQ","qmk1.nyQZZ-ENwsjNARWxTRwvVCJ22YtBwo57KsbfSBCvRDI","qmk1.r33MmowysCPx51-d6NUk3mnZ53OenX_k0YsQK5Guueo","qmk1.w5Yrc7HC8ORT6KcF1_diGl5cO1h8n5xgjU4spQ9QRX8","qmk1.yA7LIMSoZDnYGVABXhRQhe9GN6hkJnc-L0Klu_ppBf4","qmk1.zAD-mTy_gM7h4MUt07v3vk6sFhgK-Pb7XFV4MF6sGGE"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.dS9pfhei6hAiG8cWW42yNF24Lnk1qF6GNsi-P9auUiQ","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.dS9pfhei6hAiG8cWW42yNF24Lnk1qF6GNsi-P9auUiQ"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.0H-2rpacaq_gHLlsnpe5AMmREw9ezVXP9ZbwkLaDtzk","qmk1.0RGMNlyBZCax9MWdfuatOid33_OwOHs826wC26w9aC8","qmk1.3rWU5eVu6LqnDpzck5-cF0awEjLqYelbbzzuSyhh-ro","qmk1.8qfc5ICaFB4SXRq3s_VMGSIhmDGDxhZiePt4OyRFd1A","qmk1.Co5cfgcyv6AQi1yGLf0grv6PUwfZdQOXPbmgt6IxkQM","qmk1.FxVSUlGJpAkFSn9Fc-THm5DZmtWGwJn9LEfVj6dsdiA","qmk1.HSRbqUcFyI5lVasE8CH_Yj4vxDiHa9Cg9SzhEKe3u-Y","qmk1.L7cKUlP1jbnKjPZ685rhqeT4KJCRSfz-SIJlBW3NgSI","qmk1.Na63fOch5yhhov84WGIdnHyz33fpiEmetUpVweHGijc","qmk1.Qw3qqfZgH1J1vclYyjvdzYvI_wNjug4VJzz9Ruq9vN4","qmk1.UZf9o-TvtOL66CnhZQ1lUyXD3mBzOLmG_V3D2a3bJWg","qmk1.VmRZ_wweH_i3zn-uivB6GpnKoYU3kjQRT7NsyoO4vZk","qmk1.YsCnXdJfpXsxqXRk5PiqGJ1npYSANTF9K_knupH12oQ","qmk1.hABqzYOk9qzOh5wDpXBI4Yxq2vshW6nWKIOYttbHNbE","qmk1.iUCEsp70RlH54fue7y0u8921wuP44w44gobSbymhoKQ","qmk1.nyQZZ-ENwsjNARWxTRwvVCJ22YtBwo57KsbfSBCvRDI","qmk1.r33MmowysCPx51-d6NUk3mnZ53OenX_k0YsQK5Guueo","qmk1.w5Yrc7HC8ORT6KcF1_diGl5cO1h8n5xgjU4spQ9QRX8","qmk1.yA7LIMSoZDnYGVABXhRQhe9GN6hkJnc-L0Klu_ppBf4","qmk1.zAD-mTy_gM7h4MUt07v3vk6sFhgK-Pb7XFV4MF6sGGE"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.dS9pfhei6hAiG8cWW42yNF24Lnk1qF6GNsi-P9auUiQ","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
