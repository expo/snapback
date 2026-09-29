# AV round 3 failure ledger

Each failed diagnostic execution is retained. Deliberately red controls are
separate from the full-suite result. No assertions or test deadlines were
relaxed to obtain a pass.

| Evidence | Failure | Classification | Disposition |
| --- | --- | --- | --- |
| `buffered-before.log.gz` | `real buffered HTTP downloads over five seconds reach ready and paint, ordinary and once` | Baseline defect, deliberate pre-fix proof | Built merged round-2 source fails all four readiness states. Completion-only and streamless ordinary calls retry; once calls end `error/E_OFFLINE` without replay. Fixed group passes. |
| `mutant-empty.log.gz` | `empty chunks cannot postpone a stall or its bounded recovery` | Ours, deliberate negative control | Changing `if (value.byteLength)` to `if (true)` fails at the five-second cancellation assertion. Restored the built file immediately; production already had the correct guard. |

The single full suite passed: `== 0 failure(s) in 1404 s`, exit 0. There are
no full-suite failures classified as ours, baseline or environmental. All positive
verification runs passed; pre-fix, mutation and setup failures are enumerated
here. All intentionally introduced mutations were restored before subsequent
affected verification; the first preceded the single full run, and the Grok
controls followed it. The before-fix failure proves the inherited buffered-transfer
bug. No environmental test exemption was used.


Grok completed after the full run. Additional failed diagnostic executions:

| Evidence | Failed test(s) | Classification and disposition |
| --- | --- | --- |
| `grok-before.log.gz` | Completed ordinary/once rotation: online, process, wasm, and parent; online asset rotation test | Baseline defects, deliberate pre-fix controls: completed bodies returned E_AUTH. Fixed; three-tier and disposal controls pass. |
| `grok-before.log.gz` | Local queue saturation: process, wasm, and parent | Ours, initial probe assertion: assumed a denied result before inspecting the link, but old E_OFFLINE logic returned cached bytes. Now asserts the link first. The isolated E_OFFLINE mutation detects the actual incorrect offline transition on both tiers. |
| `grok-before.log.gz` | asset-retry file: pending promise/cancellation | Ours: its custom queue ignored an already-aborted signal, unlike the real queue, and the virtual clock no longer advanced. Interrupted the recorded execution session; no unrelated process was stopped. Fixed the queue double and reran it separately. |
| `grok-before-retry.log.gz` | Queue expiry during Retry-After | Baseline defect, deliberate pre-fix proof: E_OFFLINE replaced E_RATE_LIMIT and its minimum. Corrected implementation preserves E_RATE_LIMIT and deadline 131000. |
| `grok-before-retry.log.gz` | Post-download retention, ordinary | Baseline defect, deliberate pre-fix proof: host errors were E_OFFLINE and non-retryable. Final test checks retryability first; the isolated false-retryability mutation also fails. |
| `grok-before-retry.log.gz` | Post-download retention, once | Ours, intentional before/after assertion for the new E_CLIENT classification. Its existing non-retryable rule was already correct and stays so. |
| `mutant-setup.log.gz` | No tests launched | Ours: mutation setup's literal compiled indentation did not match; it stopped before writing any file. Corrected the selector to a method-scoped regex. |
| `mutant-refresh-wait.log.gz` | Process and wasm intermediate-refresh checks; parent | Ours, intentional mutation: removing only the refresh wait sends an old bearer while its successor is withheld. Restored. |
| `mutant-local-timeout.log.gz` | Process and wasm queue saturation; parent | Ours, intentional mutation: E_OFFLINE classification changes the link to offline. Restored. |
| `mutant-queue-bound.log.gz` | Cumulative queue/backoff budget | Ours, intentional mutation: removing the admission timer prevents settlement at thirty seconds. Restored. |
| `mutant-retention-retry.log.gz` | Ordinary post-download retention | Ours, intentional mutation: forcing retryability false prevents ordinary recovery. The once control passes. Restored. |
| `mutant-socket-link.log.gz` | Process and wasm real socket-failure transition; parent | Ours, intentional mutation: removing setLink(offline) loses the required actual-transport signal. Restored. |

No full-suite failure and no environmental exemption. Parent test failures
repeat child failures and are not independent root causes. The full-suite green
snapshot precedes the late Grok fixes; their final affected checks are separate.
