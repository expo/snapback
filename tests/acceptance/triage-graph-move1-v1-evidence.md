# Triage Graph Move-1 exit evidence

**Run date:** 2026-08-04
**Source revision:** `8caf77857b575a0e8be271be53ca58b6f1db2f7a` (dirty lane worktree)
**Controlled run:** PASS

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
| 1 | PASS | required screens consume generated composites rather than JavaScript collection joins | {"graphProfile":"snapshot-batch.v1","graphNodeTakes":[50,20],"graphRetention":"none","retainedProfile":"relational-query.v1","retainedTake":100,"predecessorTransformsCopied":false,"manifestDecision":"refreeze-fresh-successor-manifest"} |
| 2 | PASS | the client retains only desired bounded query results | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.FJXSZTUUwx9ZtVkXsKbXXow0XD4bSwrv8dxWP9dbX0c"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.0ge0-eBoRtP3T1fYGhnomp0YR-NftfxRQZpAux7Ol04","qmk1.3TpryefSNfPEb54HsPhQxYwrtQXHM84EAF0Aarevbyc","qmk1.77OH6sB8dZ_-1WD7xuCBCkP7lshhhgvld-nHMFe9bAY","qmk1.78ldmoF3XOCJ-sqGl2_IDELOnf82dJEFM8q_trSxXSs","qmk1.9vOZdjqIAzvAiOL_ojCGbjK-5QdzPDAZzWjE_M45ijU","qmk1.AlvyqzG01cSaH7lpwOg90ewUGotGfjCGJh110lv35HQ","qmk1.CDXnPB9s1t3nG_DeXkgxwrYtoZKv01-d1QoV6LAUY3k","qmk1.CDZhOF9kUztvM4v9hvJtoEl7S1KXZ_gOhy-g3owTrAA","qmk1.JDryv4YnNZTOg3CY7SGvjSiwnHEiF-96OTjv25kzgkc","qmk1.LTd1-KJuoleDyDArxrvtyAnZyptyrDqbY7SG_UicQCo","qmk1.PDKEUEwlHeaCAR-__8uuyEECoux_OHBZJRk28mTLj4c","qmk1.PvI820ajME-C9Z0ioWIWxOLQicK6qaGuZknUirl_6lo","qmk1.RZiU2YefxctqN7CNZhSqKCvGkZDPcACl6fMHVXfTkKk","qmk1.XPytCm1oz8p75Xmfw4ve84lKHS9Ya_e0gvV0wfUJ6xQ","qmk1.dzpg4nPMqrnbABHCUiW1TnLoAx4ZZb4EA8MCm8uXCC4","qmk1.e-JejR_LF69y2ID6s9nElCelw9sBvdNIZgFZzZZlI9M","qmk1.goR22IMyh5gLm9Y98Bpz3YwF90AwBNS4vJOfNeUyGIM","qmk1.kL6dbvzbuxcAH9a4qljBwhhaDKwV_RueFRDUPf6XA0Q","qmk1.ra7ncZbiS7NALafy9S-Vk-UiVS3swgifAHMTeELXR0A","qmk1.xVd6nWoWxXZkW2aC2br2UX0PD2Yqzd3Z9PdQ5efBdtQ"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.FJXSZTUUwx9ZtVkXsKbXXow0XD4bSwrv8dxWP9dbX0c","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |
| 3 | PASS | pagination neither duplicates nor skips an untouched root | {"pages":2,"rows":100,"uniqueIssueKeys":100,"ranks":[0,99],"transitionRows":20} |
| 4 | PASS | 20 query changes leak no predecessor rows | {"changes":20,"rows":["SWITCH-0","SWITCH-1","SWITCH-2","SWITCH-3","SWITCH-4","SWITCH-5","SWITCH-6","SWITCH-7","SWITCH-8","SWITCH-9","SWITCH-10","SWITCH-11","SWITCH-12","SWITCH-13","SWITCH-14","SWITCH-15","SWITCH-16","SWITCH-17","SWITCH-18","SWITCH-19"],"retainedVolatilePayloadEnvelopes":0,"compactedInstanceBookkeepingStubs":20,"offlineRenderability":"unknown-render-nothing"} |
| 5 | PASS | the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst | {"baselineEvents":249000,"updateBurst":1000,"totalEvents":250000,"activeMatches":100} |
| 6 | PASS | an implicit incomplete prefix is impossible to consume as complete | {"refusal":"SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"} |
| 7 | PASS | Mallory receives no protected source or result rows | {"protectedGraphRows":0,"protectedRetainedRows":0} |
| 8 | PASS | inspection explains every retained row and completeness transition | {"materializationRecords":21,"payloadBearingRecords":1,"releasedVolatilePayloadRecords":0,"retainingSets":{"registrations":["qmk1.FJXSZTUUwx9ZtVkXsKbXXow0XD4bSwrv8dxWP9dbX0c"],"releaseGrace":[],"safetyBlockers":[],"instanceBookkeepingStubs":["qmk1.0ge0-eBoRtP3T1fYGhnomp0YR-NftfxRQZpAux7Ol04","qmk1.3TpryefSNfPEb54HsPhQxYwrtQXHM84EAF0Aarevbyc","qmk1.77OH6sB8dZ_-1WD7xuCBCkP7lshhhgvld-nHMFe9bAY","qmk1.78ldmoF3XOCJ-sqGl2_IDELOnf82dJEFM8q_trSxXSs","qmk1.9vOZdjqIAzvAiOL_ojCGbjK-5QdzPDAZzWjE_M45ijU","qmk1.AlvyqzG01cSaH7lpwOg90ewUGotGfjCGJh110lv35HQ","qmk1.CDXnPB9s1t3nG_DeXkgxwrYtoZKv01-d1QoV6LAUY3k","qmk1.CDZhOF9kUztvM4v9hvJtoEl7S1KXZ_gOhy-g3owTrAA","qmk1.JDryv4YnNZTOg3CY7SGvjSiwnHEiF-96OTjv25kzgkc","qmk1.LTd1-KJuoleDyDArxrvtyAnZyptyrDqbY7SG_UicQCo","qmk1.PDKEUEwlHeaCAR-__8uuyEECoux_OHBZJRk28mTLj4c","qmk1.PvI820ajME-C9Z0ioWIWxOLQicK6qaGuZknUirl_6lo","qmk1.RZiU2YefxctqN7CNZhSqKCvGkZDPcACl6fMHVXfTkKk","qmk1.XPytCm1oz8p75Xmfw4ve84lKHS9Ya_e0gvV0wfUJ6xQ","qmk1.dzpg4nPMqrnbABHCUiW1TnLoAx4ZZb4EA8MCm8uXCC4","qmk1.e-JejR_LF69y2ID6s9nElCelw9sBvdNIZgFZzZZlI9M","qmk1.goR22IMyh5gLm9Y98Bpz3YwF90AwBNS4vJOfNeUyGIM","qmk1.kL6dbvzbuxcAH9a4qljBwhhaDKwV_RueFRDUPf6XA0Q","qmk1.ra7ncZbiS7NALafy9S-Vk-UiVS3swgifAHMTeELXR0A","qmk1.xVd6nWoWxXZkW2aC2br2UX0PD2Yqzd3Z9PdQ5efBdtQ"]},"fragments":1,"storedResultRowsExplained":100,"authoritativeRetainedRowsExplained":100,"durableRegistrations":1,"leaseRecords":1,"addressKey":"qmk1.FJXSZTUUwx9ZtVkXsKbXXow0XD4bSwrv8dxWP9dbX0c","currentTransition":{"answerClass":"authoritative","freshness":"current"},"relaunchTransition":{"answerClass":"authoritative","freshness":"retained","updateKind":null,"updateCallbackObserved":false}} |

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
