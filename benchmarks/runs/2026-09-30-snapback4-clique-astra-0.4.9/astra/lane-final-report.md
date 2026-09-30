# Clique final report

Lane: astra-clique-snapback4-full-20260913. Model: gpt-6-astra, effort=medium. Local macOS arm64 Apple M5 Max. Backend: published snapback4 0.4.9; native arm: published snapback4-expo 0.4.9; optional host binary: snapback4-darwin-arm64 0.4.9. Exact registry URLs and lockfile integrities are in evidence/package-pins.json. Node 24.18.0, Expo 57.0.22, React Native 0.86.3, React 19.2.3, Playwright 1.62.1.

M1 → M2 → M3 → M4 → M5 → M6 → M8 reached the required green bar. M7 was not run, as explicitly instructed. No scope item was struck. The essay was written before this numeric tally. No cross-backend performance or native-simulator claim is made.

## Clocks

Raw lane start=1790737297; report end=1790749461; total wall=12164.000 seconds. Clocks can overlap: scale ran separately during final validation; do not sum them to reconstruct lane wall. The table preserves the first suite-plus-choreography green boundary. Later regression checks and artifacts are recorded separately in the log.

| Milestone | Status | Start epoch | First-green/end epoch | Wall seconds | First green UTC |
| --- | --- | --- | --- | --- | --- |
| M1 | green | 1790737297 | 1790737996.599 | 699.599 | 2026-09-30T03:13:16.599Z |
| M2 | green | 1790738055 | 1790739038.595 | 983.595 | 2026-09-30T03:30:38.595Z |
| M3 | green | 1790739069 | 1790740348.228 | 1279.228 | 2026-09-30T03:52:28.228Z |
| M4 | green | 1790740372 | 1790741971.144 | 1599.144 | 2026-09-30T04:19:31.144Z |
| M5 | green | 1790742055 | 1790742845.131 | 790.131 | 2026-09-30T04:34:05.131Z |
| M6 | green | 1790742890 | 1790743512.564 | 622.564 | 2026-09-30T04:45:12.564Z |
| M7 | not-run | — | — | — | — |
| M8 | green | 1790743610 | 1790745256.639 | 1646.639 | 2026-09-30T05:14:16.639Z |

M8 final app freeze=1790747543.879; elapsed from M8 start through final freeze=3933.879 seconds, including post-first-green regression repair/verification. This does not overwrite the neutral first-green receipt.


No four-hour milestone cap was exhausted. All token values and token charges are null: native Codex usage events were not exposed inside the permitted lane. No token estimates were made.

## Suite and choreography

| Milestone | Status | Suite | Choreography | Receipt |
| --- | --- | --- | --- | --- |
| M1 | green | 7 mapped; pass | 3/3 passed; 0 skipped | evidence/choreo-m1.jsonl |
| M2 | green | 22 mapped; pass | 9/9 passed; 0 skipped | evidence/choreo-m2.jsonl |
| M3 | green | 7 mapped; pass | 7/7 passed; 0 skipped | evidence/choreo-m3.jsonl |
| M4 | green | 5 mapped; pass | 5/5 passed; 0 skipped | evidence/choreo-m4.jsonl |
| M5 | green | 6 mapped; pass | 4/4 passed; 0 skipped | evidence/choreo-m5.jsonl |
| M6 | green | 5 mapped; pass | 1/1 passed; 0 skipped | evidence/choreo-m6.jsonl |
| M7 | not-run | — | — | — |
| M8 | green | 6 mapped; pass | 5/5 passed; 0 skipped | evidence/choreo-m8.jsonl |

Coverage: coverage-manifest.json. Each milestone has npm run acceptance -- --milestone mN. Starter segments m1, m2, m3 are installed through normal app writes by npm run seed -- --segment mN, idempotently per installed segment. The frozen instrument supplies no later starter segments. Failed attempts remain in evidence/. No required check was relabeled as a skip.

Additional proofs: evidence/digest-verification.json (closed-client schedule, restart, exact counts and empty next period); evidence/m8-restart-web.json (same-account edit/reaction, durable offline restart, ordered delivery and read receipts); evidence/cold-web.json (offline history, retained image and search); evidence/offline-actions.json (offline likes/reactions); evidence/sample-conformance.json and evidence/custom-client-demo.json. TypeScript validation: evidence/typecheck-final.log.

## Native artifacts

| Milestone | Hermes export | Bundles |
| --- | --- | --- |
| M1 | artifacts/m1-ios-verified | 2 |
| M2 | artifacts/m2-ios-current | 2 |
| M3 | artifacts/m3-ios-current | 2 |
| M4 | artifacts/m4-ios-verified | 2 |
| M5 | artifacts/m5-ios | 2 |
| M6 | artifacts/m6-ios | 2 |
| M8 | artifacts/m8-ios-release | 2 |

Hash and byte inventory: evidence/native-artifacts.json. Every milestone export targets 49360. The separate scale web build targets 49362. These are Hermes bundle exports, not installed simulator execution proofs.

## Scale replay

Clean attempt start=1790745210.692; end=1790749333.782; wall=4123.090 seconds; checkpoint verification/probe pauses=12.284 seconds; replay settled epoch=1790748861.158; time through settlement=3650.466 seconds (includes checkpoint pauses); full clock includes final verification recovery. Verification=true. Settled actions=167243, including 167157 hash-pinned scale actions plus the starter segments. See evidence/scale-result.json and evidence/scale-verify-{10pct,50pct,final}.json. Verification covers every manifest entity count, per-user follow/chat counts, per-chat message counts, group membership counts, named probe fixtures and final named entities. The busy chat is paged to exhaustion and checked for unique IDs. Effects and schedules were suppressed by the published replay flag.

Two final verification reads returned retryable E_OFFLINE/ECONNRESET after settlement. A third fresh-client verification passed on the unchanged corpus without triggering a read retry; no fixture action was reissued. The root cause remains unproven. Failed verification evidence is preserved in evidence/scale-verification-*.json and logs.

The first attempt is retained under scale-attempt1/ and evidence/scale-attempt1/. It began 1790744532.748, ended 1790745104.78, wall 572.032 seconds. The 10% checkpoint rejected seven foreign test messages after an alternate Metro export contaminated the main client's backend URL. It is a failed authoring/build-isolation attempt, not a conforming performance corpus. The clean run began on new storage; it did not resume or sanitize the contaminated state.

Builder-authored sequential probe measurements are in evidence/scale-probes-*.json, with 3 warmups and 20 samples. These are not the hidden rotated grading probes and carry no official O5 score. The cold acquisition and celebrity-write measurements are separate artifacts; the write probe uses a quiescent backup so it cannot alter the verified replay corpus. See evidence/scale-performance-summary.json. No calibrated absolute replay cap was supplied by the instrument.

## Correction loops

Protocol-curated loops: 18; agent-error=16, snapback4-defect=0, environment=0, ambiguous=2. First-pass compiler/tool mistakes are logged separately and not counted as loops. Repeated attempts at the same lifetime bug are one loop, with iterations described.

| # | Attribution | Correction | Evidence |
| --- | --- | --- | --- |
| 1 | agent-error | M1 route shape did not serve root after initial export; added explicit index route. | evidence/acceptance-m1-retry.log |
| 2 | agent-error | M1 edit form captured empty pre-acquisition profile values; delayed mounting until the profile answer. | evidence/acceptance-m1-r4.log |
| 3 | agent-error | M1 duplicate-handle proof initially covered editing only; strengthened onboarding coverage. | evidence/acceptance-m1-final.log |
| 4 | agent-error | M2 follow flow could not reach feed tabs from a profile; moved tabs into navigation. | evidence/choreo-m2-console.log |
| 5 | agent-error | M2 unstable/duplicate navigation: removed the global acquisition guard and replaced retained Stack screens with Slot. Two iterations of one route-lifetime correction. | evidence/choreo-m2-console-r2.log |
| 6 | agent-error | M2 tab changes preserved old scroll offsets and prevented pagination events; keyed scroll surface by tab. | evidence/acceptance-m2-r5.log |
| 7 | ambiguous | M3 harness navigation timeout after six passed checks; static export mitigated it, but root cause was not established. | evidence/choreo-m3-console.log |
| 8 | agent-error | M3 quoted message body rendered before its excerpt; made online quoted presentation atomic. | evidence/choreo-m3-console-r2.log |
| 9 | agent-error | M3 quote test assumed old seed content remained on the newest page; created an isolated fresh group. | evidence/acceptance-m3-r3.log |
| 10 | agent-error | M4 video root mounting raced descendant lookup; supplied a stable viewer wrapper around the actual player. | evidence/choreo-m4-console-r1.log |
| 11 | agent-error | M4 row-local media/reaction state vanished when history withdrew. Several scroll/event hypotheses were rejected; lifted interaction ownership above rows. Concurrent export was a confound, not a proven platform defect. | evidence/probe-m4-trace.log |
| 12 | agent-error | M4 previous reaction completion closed a newly reopened menu; close synchronously before awaiting settlement. | evidence/probe-reaction.log |
| 13 | agent-error | M8 old-post test used local run against an owned live store; E_STORE_BUSY correctly refused. Used isolated server and documented clock advance. | evidence/acceptance-m8-r1.log |
| 14 | agent-error | M8 Insights retained a one-shot loading answer; switched to reactive query subscription. | evidence/choreo-m8-console-r2.log |
| 15 | agent-error | M8 excessive subscriptions caused transient history withdrawals during reconnect; paged decorations and active-screen feed subscriptions passed repeated choreography. | evidence/probe-dual.log; evidence/choreo-m8-console-r6.log; evidence/choreo-m8-console-final.log |
| 16 | agent-error | Alternate scale web export polluted Metro environment transform cache; main web targeted scale database. Invariants caught seven foreign messages. Preserved failed attempt, cleared cache, pinned URLs and restarted fresh. | evidence/scale-attempt1/scale-result.json; evidence/build-url-verification.json |
| 17 | agent-error | Post-green M4 regression hid actions on pending sender rows. The public choreography fallback selected an older global Edit control. Keep actions available after custody so dependent edits/deletes queue in order. Worker mode was reverted; batching was restored after a controlled revert reproduced M8 convergence failure. | evidence/choreo-m4-final-regression-console.log; evidence/probe-live-edit.log; choreography/choreography.mjs:1174 |
| 18 | ambiguous | Two final scale verification reads returned retryable E_OFFLINE/ECONNRESET after all fixture actions settled. A third fresh-client verification passed without a read retry; no actions reissued and no corpus changes. Root transport cause unproven. | evidence/scale-verification-first-failure.json; evidence/scale-verification-recovery.log; evidence/scale-verification-recovery-2.log; evidence/scale-result.json |

## Hand-authored lines

Physical nonempty-ending source/config/test file lines, including blank interior lines; generated config.q, generated API, frozen UI, scaffold, dependencies and artifacts excluded. Compact source formatting makes this a ceremony measure only.

| File | Physical lines |
| --- | --- |
| app.json | 24 |
| app/[...path].tsx | 1 |
| app/_layout.tsx | 5 |
| app/index.tsx | 1 |
| babel.config.js | 4 |
| metro-wasm-transformer.cjs | 10 |
| metro.config.js | 10 |
| package.json | 49 |
| scripts/acceptance-m2.mjs | 26 |
| scripts/acceptance-m3.mjs | 10 |
| scripts/acceptance-m4.mjs | 9 |
| scripts/acceptance-m5.mjs | 9 |
| scripts/acceptance-m6.mjs | 5 |
| scripts/acceptance-m8.mjs | 6 |
| scripts/acceptance.mjs | 31 |
| scripts/after-scale.mjs | 2 |
| scripts/artifact-inventory.mjs | 15 |
| scripts/audit-processes.mjs | 4 |
| scripts/boundary.mjs | 2 |
| scripts/build-record.mjs | 5 |
| scripts/choreo.mjs | 5 |
| scripts/cleanup.mjs | 10 |
| scripts/configure.mjs | 15 |
| scripts/coverage.mjs | 3 |
| scripts/custom-client-demo.mjs | 3 |
| scripts/demo-clean.mjs | 2 |
| scripts/final-report.mjs | 13 |
| scripts/probe-dual.mjs | 2 |
| scripts/probe-edit.mjs | 1 |
| scripts/probe-live-edit.mjs | 2 |
| scripts/probe-m4-live.mjs | 2 |
| scripts/probe-m4.mjs | 2 |
| scripts/probe-navigation.mjs | 1 |
| scripts/probe-new-edit.mjs | 1 |
| scripts/probe-reaction.mjs | 1 |
| scripts/probe-scroll.mjs | 1 |
| scripts/probe-signup.mjs | 1 |
| scripts/probe.mjs | 1 |
| scripts/replay.mjs | 29 |
| scripts/resume-scale-verification.mjs | 2 |
| scripts/scale-cold.mjs | 2 |
| scripts/scale-performance-summary.mjs | 1 |
| scripts/scale-run.mjs | 3 |
| scripts/scale-verify.mjs | 8 |
| scripts/scale-write-probe.mjs | 2 |
| scripts/seed.mjs | 27 |
| scripts/serve-web.mjs | 3 |
| scripts/test-server.mjs | 2 |
| scripts/test-support.mjs | 7 |
| scripts/validate-record.mjs | 1 |
| scripts/verify-cold-web.mjs | 2 |
| scripts/verify-digest.mjs | 3 |
| scripts/verify-m5-group-once.mjs | 2 |
| scripts/verify-m8-restart.mjs | 2 |
| scripts/verify-offline-actions.mjs | 2 |
| scripts/verify-old-trending.mjs | 2 |
| scripts/verify-sample.mjs | 9 |
| scripts/verify-scale-spots.mjs | 2 |
| snapback/schema.q | 474 |
| snapback/workers/push.mjs | 3 |
| src/ChatSettings.tsx | 5 |
| src/Chats.tsx | 29 |
| src/Insights.tsx | 4 |
| src/Message.tsx | 29 |
| src/Posts.tsx | 24 |
| src/Search.tsx | 6 |
| src/Shell.tsx | 36 |
| src/Video.native.tsx | 3 |
| src/Video.tsx | 2 |
| src/client.ts | 36 |
| src/poster.native.ts | 3 |
| src/poster.ts | 1 |
| tsconfig.json | 17 |

Source/config/test total: 1077 lines across 73 files. This compact formatting is not a complexity or productivity comparison. Documentation lines are recorded separately below; generated final report and generated records are excluded.

| Hand-authored document | Lines |
| --- | --- |
| README.md | 36 |
| API.md | 68 |
| CONFIGURATION.md | 7 |
| essay.md | 29 |
| diary.md | 34 |
| run-log.md | 181 |

## Measured scale qualifications

Builder performance checks overall pass=false. Failed checks: message-search-midcurve, insights-midcurve, trending-midcurve. Final growth/depth/follow-count ratios passed; three midpoint interpolation checks missed. The much faster final probes compared with earlier checkpoints make co-load a possible confounder, not a proven cause. No favorable rerun replaced these observations. Cold acquisition times (ms): 1115.1, 4656.8, 3645.1, 3934.0, 4495.9. Logical retained data about 3.93 MB; reported WASM heap 28.57 MB. All 100 conversations remained available after offline restart. Celebrity-write p95 ratio: 1.418×. Additional reaction identity and media-byte checks: evidence/scale-spots-extra.json.


## Gaps and qualifications

- No required backend capability was found inexpressible in the published package during authoring. Compiler notes about search coverage and sync horizons remain intentional; the UI labels incomplete searches. They are not a claim of whole-corpus offline coverage.
- The full publication record is not valid yet: the supplied session has no driver-stamped prelaunch orientation custody and no external grader session. run-record.json is a builder-stage record; evidence/run-record-validation.json lists the exact schema failures. A prelaunch artifact and a grading session were not fabricated. Efficiency scorecard eligibility is false.
- Native token accounting, exact compaction timestamps and complete driver observation streams are unavailable. Wall clocks, receipts, package pins and authored files are retained; unavailable quantities are null/non-claimed.
- M7 and real APNs/FCM delivery were explicitly out of this session. Native proof is the requested Hermes export, not simulator validation. Push provider files demonstrate the seam.
- Builder probe ratios and cold sync results are reported candidly, including any ceiling miss; suite/choreography green does not imply an official scale score. The host can have unrelated load.
- An empty /tmp/none file was accidentally created and immediately removed during M4. No outside content was read. This lane-boundary mistake is recorded in run-log.md. Forbidden sibling lanes and prior Snapback/Clique implementations were not inspected.
- All server processes started for the lane are recorded. Final cleanup signals only those verified owned PIDs; evidence/cleanup.json records the outcome.

end=1790749461
