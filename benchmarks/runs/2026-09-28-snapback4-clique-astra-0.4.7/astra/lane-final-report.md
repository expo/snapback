# Clique final report

Lane: astra-clique-snapback4-full-20260913. Model: gpt-6-astra, effort medium. Exact public pins: snapback4@0.4.7 and snapback4-expo@0.4.7, including the resolved nested pin. See [resolved package evidence](evidence/resolved-pins-final.json).

Raw run start: 1790586668. Raw report completion: 1790601440.944. All seven requested authoring milestones are green. M7 is not-run by instruction. No milestone exhausted its four-hour wall limit.

## Milestone clocks and proof

| Milestone | Status | Start epoch | Boundary end epoch | Wall seconds | First suite + choreography green epoch | Seconds to first green |
|---|---|---:|---:|---:|---:|---:|
| M1 | green | 1790586668 | 1790587206.772 | 538.772 | 1790587206.772 | 538.772 |
| M2 | green | 1790587246 | 1790588586.869 | 1340.869 | 1790588586.869 | 1340.869 |
| M3 | green | 1790588622 | 1790589681.653 | 1059.653 | 1790589681.653 | 1059.653 |
| M4 | green | 1790589732 | 1790593927.805 | 4195.805 | 1790593927.805 | 4195.805 |
| M5 | green | 1790594147 | 1790595240.86 | 1093.860 | 1790595240.86 | 1093.860 |
| M6 | green | 1790595276 | 1790596281.917 | 1005.917 | 1790596148.865 | 872.865 |
| M7 | not-run | — | — | — | — | — |
| M8 | green | 1790596281.917 | 1790597130.11 | 848.193 | 1790596750.882 | 468.965 |

M1 starts at the run start so its initial orientation is charged; its later explicit milestone marker was 1790586728. First green is the earliest passing suite-linked choreography summary. Boundary ends can be later because adapter instrumentation, additional checks, diary and bookkeeping continued. The raw report end includes the separate replay and reporting work. Phase-level and token figures are not estimated.

- **M1**: suite pass, 7 suite-required IDs covered; choreography 3/3 required checks pass. 1 recorded choreography attempt(s). [Suite](evidence/suite-m1.json), [coverage](evidence/coverage-m1.json), [final choreography](evidence/choreo-m1.jsonl), [iOS Hermes artifact](artifacts/m1-ios/metadata.json).
- **M2**: suite pass, 22 suite-required IDs covered; choreography 9/9 required checks pass. 4 recorded choreography attempt(s). [Suite](evidence/suite-m2.json), [coverage](evidence/coverage-m2.json), [final choreography](evidence/choreo-m2-1790588480576.jsonl), [iOS Hermes artifact](artifacts/m2-ios/metadata.json).
- **M3**: suite pass, 7 suite-required IDs covered; choreography 5/5 required checks pass. 2 recorded choreography attempt(s). [Suite](evidence/suite-m3.json), [coverage](evidence/coverage-m3.json), [final choreography](evidence/choreo-m3-1790589412396.jsonl), [iOS Hermes artifact](artifacts/m3-ios/metadata.json).
- **M4**: suite pass, 5 suite-required IDs covered; choreography 5/5 required checks pass. 8 recorded choreography attempt(s). [Suite](evidence/suite-m4.json), [coverage](evidence/coverage-m4.json), [final choreography](evidence/choreo-m4-1790593810151.jsonl), [iOS Hermes artifact](artifacts/m4-ios/metadata.json).
- **M5**: suite pass, 6 suite-required IDs covered; choreography 2/2 required checks pass. 1 recorded choreography attempt(s). [Suite](evidence/suite-m5.json), [coverage](evidence/coverage-m5.json), [final choreography](evidence/choreo-m5-1790594877533.jsonl), [iOS Hermes artifact](artifacts/m5-ios/metadata.json).
- **M6**: suite pass, 5 suite-required IDs covered; choreography 1/1 required checks pass. 1 recorded choreography attempt(s). [Suite](evidence/suite-m6.json), [coverage](evidence/coverage-m6.json), [final choreography](evidence/choreo-m6-1790596120384.jsonl), [iOS Hermes artifact](artifacts/m6-ios/metadata.json).
- **M8**: suite pass, 6 suite-required IDs covered; choreography 5/5 required checks pass. 2 recorded choreography attempt(s). [Suite](evidence/suite-m8.json), [coverage](evidence/coverage-m8.json), [final choreography](evidence/choreo-m8-1790597065224.jsonl), [iOS Hermes artifact](artifacts/m8-ios/metadata.json).

All failed and retry evidence is retained. The ordinary choreography timeout was raised through the documented option to 30 seconds during M4 and retained thereafter; fixed brief ceilings were unchanged. No required check was relabeled or structurally skipped. Native simulator assertions are separately unproven, as allowed by the environment overlay; Hermes exports exist for every milestone.

## Additional evidence

- [Closed-client expiry](evidence/acceptance-m5.log): server-enforced deadline checked with all browser clients closed.
- [Fresh-install clean-directory demo](evidence/api-clean-demo.json) and [custom client demo](evidence/custom-client-demo.json) and [API documentation](API.md): issued user token, conversations, paged history, send, and polling.
- [Sample conformance](evidence/replay-sample/verification.json): all 50 actions settled on the development instance and all 13 verbs/final intents were verified; fixture grammar validation is also retained.
- [Browser cold-offline restart](evidence/cold-offline-verification.json): two pending writes restored and flushed exactly once in order.
- [Scheduled digest](evidence/digest-verification.json): all clients closed, mid-period owned-backend restart, independently matched per-user counts, private-chat and tombstone exclusion, zero-user suppression, and no digest in the quiet next period.

## Scale replay

Fresh instance: scale-instance, seeded through real auth/mutations with starter M1–M3. Backend 49362, web 49363. Replay flag suppressed notifications and schedules. Workload hash: sha256:b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9.

Start=1790597148.377; end=1790601333.761; raw wall=4185.384 seconds; excluded checkpoint/final verification=28.978 seconds; active replay=4156.406 seconds; cap=14400 seconds. Settled prefix=167157/167157; failedActions=0; result=pass. [Receipt](evidence/replay-scale/result.json), [action receipts](evidence/replay-scale/receipts.jsonl).

The launcher clock began at 1790597147.314, before the child initialized. Including that initialization, raw wall is 4186.447 seconds and charged wall after the same verification exclusions is 4157.469 seconds.

One checkpoint-verification attempt stopped at 88,057 settled actions on a retryable E_OFFLINE read. The backend remained alive; re-verification of the unchanged store passed. No workload mutation was rejected or replayed during recovery. The raw first-attempt receipt incorrectly counted that verification error as failedActions=1; it is preserved, and the runner now separates those categories. The continuation kept the original start and cap, charged diagnostic/repair wall, and retained earlier checkpoint evidence. [Original attempt](evidence/replay-scale/attempt-1-result.json), [error log](evidence/replay-scale/attempt-1.log), [resumed log](evidence/replay-scale/attempt-2.log).

- 10pct: manifest pass; all per-entity, per-user, per-chat and group counts checked; named spots and busy-group authorized paging checked. [Verification and builder probes](evidence/replay-scale/verification-10pct.json).
- 50pct: manifest pass; all per-entity, per-user, per-chat and group counts checked; named spots and busy-group authorized paging checked. [Verification and builder probes](evidence/replay-scale/verification-50pct.json).
- final: manifest pass; all per-entity, per-user, per-chat and group counts checked; named spots and busy-group authorized paging checked. [Verification and builder probes](evidence/replay-scale/verification-final.json).

Builder probes are not the hidden grader probe set. No O5 score or hosted performance claim is manufactured. Core replay verbs and sample conformance were authored during M6; verification instrumentation and reporting were refined subsequently, with those changes logged.


Builder degradation checks: some fail; see individual measurements below. These observations do not change the authoring suite/choreography status or constitute an official O5 score. [Raw measurements](evidence/replay-scale/builder-envelope.json).

| Builder check | Observed ratio or latency | Maximum | Pass |
|---|---:|---:|---|
| deepPaging | 1.041 | 3.000 | true |
| following500 | 2.890 | 3.000 | true |
| celebrityRead | 0.690 | 3.000 | true |
| celebrityWrite | 1.006 | 3.000 | true |
| search100 | 2.554 | 3.000 | true |
| search100MidCurve | 16.326 | 15.193 | false |
| insights | 2.943 | 3.000 | true |
| insightsMidCurve | 5.007 | 4.260 | false |
| trending | 1.584 | 3.000 | true |
| trendingMidCurve | 4.609 | 9.890 | true |

Fresh browser u0500 cold sync: pass, 11.617000102996826 seconds; offline inbox and newest history-page coverage for 100 conversations. This checks the declared 500-message sync window, not unlimited archived history. [Evidence](evidence/replay-scale/cold-100-conversations.json).

## Corrections and attribution

Logged correction/error/diagnostic entries by attribution: environment=4, agent-error=34, ambiguous=4. This is an entry count, not a reconstructed count of independent causal episodes. No proven snapback4 defect is asserted. Full timestamped entries follow.

- 1790586907 **environment**: error attribution=environment evidence=evidence/choreo-install.log copied frozen directory retained read-only permission; retry chmod lane copy. Node login-shell PATH selects 22 despite overlay; use absolute Node24 PATH.
- 1790587058 **agent-error**: correction-loop attribution=agent-error evidence=evidence/inspect.log optional catchall produced unmatched root; add explicit index and ordinary catchall.
- 1790587150 **agent-error**: error attribution=agent-error evidence=evidence/m1-types.log unused starter chat files moved out of app; copied kit test excluded from application typecheck
- 1790587190 **environment**: error attribution=environment evidence=evidence/choreo-m1.log copied harness imports ../metering/observations.mjs; link frozen dependencies into lane, no harness edits
- 1790587588 **agent-error**: correction-loop attribution=agent-error evidence=evidence/acceptance-m2.log Stack retained inactive duplicate form nodes; use single active Slot for route shell
- 1790587652 **agent-error**: correction-loop attribution=agent-error evidence=evidence/acceptance-m2-retry.log avatar rendered before asynchronous image assets; suite must await two image nodes instead of immediate count
- 1790587697 **agent-error**: correction-loop attribution=agent-error evidence=evidence/acceptance-m2-retry2.log clearing absent follow returned NOT_FOUND; guard absent deletes for all set-state intents per feeds recipe
- 1790587769 **environment**: error attribution=environment evidence=tool-transcript initial rm-f command rejected by command guard; no edit ran; safer file moves used for unused generated starter files
- 1790587817 **agent-error**: correction-loop attribution=agent-error evidence=evidence/choreo-m2.log Global tab state reset on route push, leaving Bob in Following after suite cleared edges; lift tab state above routes
- 1790587862 **agent-error**: correction-loop attribution=agent-error evidence=evidence/web.log live export removed bundle while static server opened stream; add stream error handling and avoid exports during verification
- 1790587908 **agent-error**: error attribution=agent-error source=diagnostic package.json is not exported; resolved pin verification uses installed package metadata file evidence=evidence/resolved-pins.txt
- 1790588052 **ambiguous**: correction-loop attribution=ambiguous evidence=evidence/choreo-m2-retry.log tab switch could expose previous usePage projection while hook changes operation; key feed subtree by projection to ensure no stale Global frame under Following
- 1790588111 **agent-error**: correction-loop attribution=agent-error evidence=evidence/acceptance-m2-keyed.log suite assumed immediate data after mutation; documented replica loading requires waiting for acquisition/observation, bounded to 10s
- 1790588336 **agent-error**: correction-loop attribution=agent-error evidence=evidence/reprojection.log backend correctly returns only own repost after explicit unfollow; profile rendered Follow before followState resolved, turning intended unfollow into set-true. Wait for real state before rendering control. Earlier ambiguous tab hypothesis not sufficient.
- 1790588436 **agent-error**: retry attribution=agent-error evidence=evidence/acceptance-m2-followstate.log async-test timing loop iteration: parent point query and reply page settle independently; wait for both before count
- 1790588906 **agent-error**: error attribution=agent-error source=diagnostic evidence=evidence/seed-m3.log E_ADMISSION before replica identifies store; retry same unadmitted intent as diagnostic instructs
- 1790589286 **agent-error**: correction-loop attribution=agent-error evidence=evidence/choreo-m3.log quoted body rendered before its independently queried excerpt; defer that individual quoted bubble until excerpt resolves, leave remaining history mounted
- 1790590032 **agent-error**: error attribution=agent-error evidence=evidence/m4-types.log first-pass JSX attachment callback missing closing expression brace; corrected before compile success
- 1790590382 **agent-error**: correction-loop attribution=agent-error evidence=evidence/choreo-m4.log video viewer mounted asynchronously as root video after harness had chosen descendant selector; use consistent viewer container with child player across platforms
- 1790590732 **ambiguous**: diagnostic attribution=ambiguous evidence=evidence/delete-diagnostic2.log delete commits and recipient point/history reads return tombstone; UI transiently clears during read loading then renders correct tombstone; retest latency with corrected video viewer
- 1790590946 **agent-error**: correction-loop attribution=agent-error evidence=src/Messaging.tsx,evidence/choreo-m4-retry.log DM route gated its mounted conversation on transient profile loading; retain resolved route principal, while message content continues to follow current protected reads
- 1790591281 **agent-error**: correction-loop attribution=agent-error evidence=scripts/serve.mjs static server sent no-store for immutable hashed bundles and WASM, defeating browser code caching on repeated full navigation; enable immutable cache only for hash-named build assets, HTML revalidates
- 1790591540 **agent-error**: correction-loop attribution=agent-error evidence=src/Messaging.tsx,evidence/choreo-m4-cache.log viewer-container fix alone insufficient: viewer state still lived in transient bubble; lift ownership to conversation and watch point read for revocation
- 1790591777 **agent-error**: correction-loop attribution=agent-error evidence=evidence/acceptance-m4-owned-viewer.log suite treated pending custody return as terminal failure; poll documented client.write(originalId) without resubmission. Video playback/lifetime regression passed.
- 1790592278 **agent-error**: correction-loop attribution=agent-error evidence=src/Messaging.tsx,evidence/choreo-m4-receipt.log video now passes; reaction picker has same transient-row ownership defect. Lift reaction target and picker above list, await actual own reaction state before showing controls.
- 1790592331 **agent-error**: correction-loop attribution=agent-error evidence=node_modules/snapback4/README.md:270,src/Messaging.tsx bare message list remounted all row observers during transient reload; use documented keep:true for history, confirmed answers/refusals and identity resets still replace/clear rows. M5 adds deadline rendering for expiring rows.
- 1790592523 **agent-error**: correction source=fixture attribution=agent-error evidence=instrument/choreography/README.md:91 earlier commentary treated default 10000ms ordinary timeout as frozen; published harness supports --timeout/CHOREO_TIMEOUT_MS, explicitly preserves fixed M3 ceilings. No protocol prohibition found. Future retry may use 30000ms under measured host load; raw waits retained.
- 1790592652 **environment**: retry workaround attribution=environment source=fixture evidence=evidence/choreo-m4-timeout30.log use documented CHOREO_TIMEOUT_MS=30000 ordinary observation timeout; fixed brief ceilings untouched; identical app and suite, no concurrent build
- 1790593550 **ambiguous**: diagnostic attribution=ambiguous evidence=evidence/reaction-ui-diagnostic.log replacement is stored and queryable as heart on both clients while recipient chip fails to update; test explicit reaction projection instead of bare rows. Lookup source=package-guide evidence=evidence/guide-sync.txt,evidence/guide-rules.txt confirms read-through inferred audience and upsert queues without local row.
- 1790593627 **agent-error**: correction-loop attribution=agent-error evidence=evidence/reaction-shaped-diagnostic.log delayed completion of first pick closed a subsequently opened picker. Close at submission, route later errors to the screen. Also remove reactions horizon so per-message grouping is locally complete; exact N_SYNC_ORDER evidence=evidence/m4-check-reaction-shape.log. Explicit shape retained; no proven platform defect.
- 1790594828 **agent-error**: verification M5 first-pass Quarry compiled with expiry, once assets, settings and search evidence=evidence/m5-check1.log; error attribution=agent-error evidence=evidence/m5-types1.log conditional usePage operation produced incompatible argument union; replace with one nullable-scope Quarry searchMessages query, types pass evidence=evidence/m5-types2.log
- 1790595655.09 **agent-error**: correction-loop attribution=agent-error source=diagnostic evidence=evidence/m6-check1.log E_READ_THROUGH_SCAN on custom API reaction aggregates; lookup snapback4 why E_READ_THROUGH_SCAN requires parent-key access. Formatter prettier@3.6.2 installed and applied to authored TypeScript/scripts for maintainability.
- 1790595724.46 **agent-error**: correction-loop attribution=agent-error evidence=evidence/m6-check2.log,evidence/m6-check3.log,evidence/m6-check4.log aggregate multi-key scan and reference-path rule refused; bounded representative child rows plus full aggregate keys compile. Accidental empty /tmp/nope created by a stray command, no outside content read; all substantive work remains in lane.
- 1790596038.687 **agent-error**: correction-loop attribution=agent-error evidence=evidence/acceptance-m6-1.log first suite launched concurrently with web export; auth DOM unavailable while export replaced files. Retry after export finishes.
- 1790596585.728 **agent-error**: correction-loop attribution=agent-error source=diagnostic evidence=evidence/acceptance-m8-1.log CLI run --now refused E_STORE_BUSY on live store; follow explicit diagnostic: stop owned listener, run one old-post mutation for window test, restart. No fixture replay timestamps altered.
- 1790596624.043 **agent-error**: correction attribution=agent-error M6 green receipt pointer is evidence/choreo-m6-1790596120384.jsonl (previous suffix accidentally selected observations sidecar); scale verification extended named reaction values and conversation metadata alongside counts.
- 1790596850.221 **agent-error**: correction-loop attribution=agent-error evidence=evidence/m8-types-final.log assumed usePage exposes complete directly; typecheck rejected; removed unsupported access. Kept explicit synced-device coverage wording. Added terminal write-refusal banner using documented onWrite.
- 1790597721.511 **agent-error**: correction-loop attribution=agent-error source=tool-transcript intended isolated production-config check ran with lane-root cwd, briefly selecting production on dev backend and writing ../production-config-check.log outside lane. Restored shortened config immediately; fresh scale instance unchanged. Outside output contains only this lane check results; no outside source read.
- 1790599515.999 **agent-error**: correction attribution=agent-error progress commentary used source line numbers after checkpoint markers; exact settled action count is now reported from hash-filtered authoritative receipts. Replay accounting itself already excludes markers.
- 1790600142.524 **ambiguous**: correction-loop attribution=ambiguous source=diagnostic evidence=evidence/replay-scale/attempt-1.log,evidence/replay-scale/doctor-after-read-refusal.json E_OFFLINE during 50% named-post verification; backend remained alive and all 88057 workload mutations had settled. Unchanged-store re-verification passed.
- 1790600142.524 **agent-error**: correction-loop attribution=agent-error evidence=scripts/replay.mjs,scripts/api-client.mjs original helper treated retryable read refusal as terminal and conflated verification with failedActions; preserve raw attempt1, add bounded logged read retries and checkpoint-aware resume with original start/cap. Doctor first called from wrong project, E_INPUT corrected by using scale-instance cwd.
- 1790601254.87 **agent-error**: correction attribution=agent-error evidence=scripts/check-scale-cold.mjs corrected Playwright waitForFunction options position before first execution; reporting and exact-PID cleanup tooling prepared. No app or backend behavior changed after M8 green.

## Source line counts

Physical and nonblank lines of active authored/edited source, configuration and test scripts after formatting. Retained published scaffold and generated config listed separately; frozen kit/harness, generated API, packages, artifacts, duplicated scale schema, evidence and prose excluded. Edited files count their final full file, not a reconstructed diff. Authored/edited total: 6709 physical lines across 62 files. The diagnostic and acceptance scripts are included, so this is not just product LOC.

| File | Physical | Nonblank | Classification |
|---|---:|---:|---|
| app.json | 28 | 28 | authored-or-edited |
| app/[...path].tsx | 1 | 1 | authored-or-edited |
| app/_layout.tsx | 14 | 14 | authored-or-edited |
| app/index.tsx | 1 | 1 | authored-or-edited |
| babel.config.js | 4 | 4 | published-scaffold-retained |
| metro-wasm-transformer.cjs | 10 | 10 | published-scaffold-retained |
| metro.config.js | 8 | 8 | published-scaffold-retained |
| package.json | 42 | 42 | authored-or-edited |
| scripts/acceptance.mjs | 159 | 159 | authored-or-edited |
| scripts/api-client.mjs | 42 | 42 | authored-or-edited |
| scripts/backend-lifecycle.mjs | 51 | 51 | authored-or-edited |
| scripts/browser.mjs | 18 | 18 | authored-or-edited |
| scripts/check-clean-api.mjs | 21 | 21 | authored-or-edited |
| scripts/check-cold-offline.mjs | 85 | 85 | authored-or-edited |
| scripts/check-digest.mjs | 179 | 179 | authored-or-edited |
| scripts/check-scale-cold.mjs | 95 | 95 | authored-or-edited |
| scripts/check-scale-stage.mjs | 8 | 8 | authored-or-edited |
| scripts/choreo.mjs | 34 | 34 | authored-or-edited |
| scripts/configure.mjs | 23 | 23 | authored-or-edited |
| scripts/custom-client-demo.mjs | 80 | 80 | authored-or-edited |
| scripts/diagnose-delete.mjs | 56 | 56 | authored-or-edited |
| scripts/diagnose-history.mjs | 125 | 125 | authored-or-edited |
| scripts/diagnose-m6.mjs | 14 | 14 | authored-or-edited |
| scripts/diagnose-reactions.mjs | 84 | 84 | authored-or-edited |
| scripts/diagnose-rows.mjs | 32 | 32 | authored-or-edited |
| scripts/final-report.mjs | 204 | 204 | authored-or-edited |
| scripts/inspect.mjs | 13 | 13 | authored-or-edited |
| scripts/push-worker.mjs | 42 | 42 | authored-or-edited |
| scripts/replay-status.mjs | 7 | 7 | authored-or-edited |
| scripts/replay.mjs | 358 | 358 | authored-or-edited |
| scripts/report-facts.mjs | 132 | 132 | authored-or-edited |
| scripts/reprojection.mjs | 66 | 66 | authored-or-edited |
| scripts/scale-envelope.mjs | 75 | 75 | authored-or-edited |
| scripts/scale-run.mjs | 108 | 108 | authored-or-edited |
| scripts/seed-social.mjs | 137 | 137 | authored-or-edited |
| scripts/seed.mjs | 80 | 80 | authored-or-edited |
| scripts/serve.mjs | 52 | 52 | authored-or-edited |
| scripts/setup-identity.mjs | 49 | 49 | authored-or-edited |
| scripts/snapshot.mjs | 13 | 13 | authored-or-edited |
| scripts/start-backend.sh | 3 | 3 | authored-or-edited |
| scripts/stop-owned-servers.mjs | 62 | 62 | authored-or-edited |
| scripts/suite-m2.mjs | 280 | 280 | authored-or-edited |
| scripts/suite-m3.mjs | 168 | 168 | authored-or-edited |
| scripts/suite-m4.mjs | 141 | 141 | authored-or-edited |
| scripts/suite-m5.mjs | 212 | 212 | authored-or-edited |
| scripts/suite-m6.mjs | 126 | 126 | authored-or-edited |
| scripts/suite-m8.mjs | 177 | 177 | authored-or-edited |
| scripts/test-client.mjs | 54 | 54 | authored-or-edited |
| scripts/verify-sample.mjs | 159 | 159 | authored-or-edited |
| scripts/verify-scale.mjs | 290 | 290 | authored-or-edited |
| snapback/chat.q | 366 | 343 | authored-or-edited |
| snapback/config.q | 5 | 5 | generated-config |
| snapback/digest.q | 25 | 25 | authored-or-edited |
| snapback/insights.q | 19 | 19 | authored-or-edited |
| snapback/schedule.q | 2 | 2 | generated-config |
| snapback/schema.q | 128 | 122 | authored-or-edited |
| src/ChatSettings.tsx | 167 | 167 | authored-or-edited |
| src/Insights.tsx | 100 | 100 | authored-or-edited |
| src/MediaViewer.tsx | 134 | 134 | authored-or-edited |
| src/Messaging.tsx | 666 | 666 | authored-or-edited |
| src/QueueStatus.tsx | 41 | 41 | authored-or-edited |
| src/Search.tsx | 175 | 175 | authored-or-edited |
| src/Shell.tsx | 320 | 320 | authored-or-edited |
| src/Social.tsx | 293 | 293 | authored-or-edited |
| src/client.ts | 35 | 35 | authored-or-edited |
| src/intent-store.native.ts | 8 | 8 | published-scaffold-retained |
| src/intent-store.ts | 2 | 2 | published-scaffold-retained |
| src/intent-store.web.ts | 7 | 7 | published-scaffold-retained |
| src/intents.ts | 90 | 86 | published-scaffold-retained |
| src/navigation.tsx | 18 | 18 | authored-or-edited |
| tsconfig.json | 22 | 22 | authored-or-edited |

## Candid limits and integrity notes

- Native Hermes exports are verified build artifacts; simulator behavior is not claimed. M7 and hidden grader probes were intentionally not run. Real APNs/FCM is the brief’s logging seam, not an implemented external service.
- Token totals and fine-grained phases are null: the permitted lane does not expose the harness-native token stream. run-record.json is validated against the base protocol schema; a fully joined metering/publication record is not claimed.
- No source repository, sibling lane, or prior implementation was inspected. Two agent scope errors are retained in the log: a stray command created or truncated an empty /tmp/nope, and a mis-scoped production-config check wrote ../production-config-check.log. No outside file content or source was read. The main shortened configuration was immediately restored; the isolated scale instance was unchanged. All substantive app, test, data, and evidence work stayed in this lane.
- The old-post window test used one developer mutation with an earlier server clock while this lane’s backend was stopped. Fixture replay timestamps were never backdated.
- Private session journals and test replica profiles remain local and ignored by version control; they are not publication artifacts.
- This is a local implementation, not a hosted deployment or a comparative benchmark against Convex, Supabase, or older Snapback releases. See essay.md for the bounded architectural comparison.

Owned server cleanup: pass; worker and all four listeners stopped by recorded, identity-checked PIDs. [Evidence](evidence/server-cleanup.json).

Scale-performance limitation: the builder search and Insights mid-curve measurements exceeded their interpolated ceilings. Final invariants passed, but this run does not establish a clean performance envelope.

end=1790601440.944
