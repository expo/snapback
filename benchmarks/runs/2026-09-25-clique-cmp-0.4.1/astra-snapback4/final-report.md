# Clique final report

Lane astra-clique-snapback4-20260925 · model gpt-6-astra · effort medium.

All seven requested continuous-session milestones are green under the environment overlay: suite coverage plus required implemented browser choreography. M7 is not-run as instructed. Native simulator assertions are unavailable, not passed. Full replay invariants passed, but full-scale web cold sync failed the 30s deadline and did not finish in the separate 180s diagnostic observation.

start=1790309510

Report end epoch=1790318177; complete lane wall=8667s. Orientation is included. Per-phase token and wall splits are unavailable; no estimates are substituted. The full lane wall includes replay, verification and reporting, while milestone intervals and replay clocks below remain separate.

| Milestone | Start epoch | End boundary epoch | Wall seconds | First recorded green UTC | Status |
|---|---:|---:|---:|---|---|
| M1 | 1790309510 | 1790310051 | 541 | 2026-09-25T04:19:54.908Z | green |
| M2 | 1790310051 | 1790310950 | 899 | 2026-09-25T04:34:44.858Z | green |
| M3 | 1790310950 | 1790311524 | 574 | 2026-09-25T04:44:54.914Z | green |
| M4 | 1790311524 | 1790312905 | 1381 | 2026-09-25T05:07:11.168Z | green |
| M5 | 1790312905 | 1790313710 | 805 | 2026-09-25T05:21:28.029Z | green |
| M6 | 1790313710 | 1790314240 | 530 | 2026-09-25T05:27:38.087Z | green |
| M7 | — | — | — | — | not-run |
| M8 | 1790314240 | 1790316288 | 2048 | 2026-09-25T05:36:36.252Z | green |

M8 received an initial combined green receipt before additional cold-restart hardening. Its final product validation is 2026-09-25T06:04:32.353Z. M5 received a later passing suite after its original green; a post-M8 choreography regression repaired the suite-hash linkage. Original receipts and first-green times are retained. Boundary times include intervening evidence work rather than pretending every boundary was the first green instant.

| Milestone | Suite tests passed | Required suite assertions covered | Choreography passed / implemented | Required choreography | Skips |
|---|---:|---:|---:|---:|---:|
| M1 | 4 | 7 | 3/3 | 3 | 0 |
| M2 | 8 | 22 | 9/9 | 9 | 0 |
| M3 | 5 | 7 | 7/7 | 5 | 0 |
| M4 | 4 | 5 | 5/5 | 5 | 0 |
| M5 | 4 | 6 | 4/4 | 2 | 0 |
| M6 | 5 | 5 | 1/1 | 1 | 0 |
| M8 | 4 | 6 | 5/5 | 5 | 0 |

Coverage: [manifest](evidence/coverage-manifest.json). Raw suites and JSONL choreography receipts are retained in evidence/. [Custody inventory](evidence/milestone-evidence.json) verifies current suite hashes against each final segment-summary. Every implemented required check passes. M6/M8 external simulator slots explicitly say not-recorded in the frozen harness and are not required for web green. Separate actual witness attempts report E_WITNESS_PLATFORM; see native receipts. The original missing-harness-helper startup errors are retained; the AJV loader workaround changes no choreography assertions.

The package pins resolve to snapback4@0.4.1 and snapback4-expo@0.4.1; see [npm resolution](evidence/resolved-packages.json). The observed runtime is v24.13.1, despite the overlay naming another Node patch version; this discrepancy was logged. No Snapback source checkout or sibling implementation was inspected.

## Replay

Successful/final attempt: start=1790316567, end=1790317439, raw wall=872s, checkpoint verification/probe time excluded=156.561s, replay clock excluding that work=715.439s. Settled scale actions=167157. Invariant verification=true. Fresh instance: scale-instance, port 56102; all starter segments replayed through the same write/auth path before scale.log. Push and scheduled digest effects were suppressed by --replay. No development acceptance residue was used.

The earlier partial replay attempt is retained separately: start=1790316288, end=1790316556, wall=268s, settled=24777. It was deliberately stopped to correct my missing probe warm-ups/deadlines. Its first checkpoint data verification passed; its subsequent delivery-wait failure was caused by the stopped server. It is not claimed as a successful replay or hidden inside the final clock.

[Final clock and verification](evidence/scale-clock.json) contains checkpoint prefix hashes, exact counts and the final verification result. Actual application-table counts and all declared per-user/per-chat/per-group maps were checked, as were named profiles/posts/messages, recipient rosters, celebrity fixtures, and busy-chat full pagination. Registration count uses acknowledged real signup sessions because internal identity SQL is intentionally inaccessible. Builder deterministic samples are additional evidence, not the undisclosed grader sample. Diagnostic probes use three warm-ups, 20 sequential requests and 30s deadlines; results are in scale-10pct-probes.json, scale-50pct-probes.json and scale-full-probes.json. No O5 score or calibrated ceiling claim is made. Host-load observations are retained in the replay console.

Post-replay fresh-browser cold-sync proof (separate from invariant correctness): pass=false, acquisition=not completed, total diagnostic wall including screenshot/teardown=210.431s; evidence/scale-cold-start.json. This is web evidence, not native proof.

## Verified full corpus

| Entity | Actual count |
|---|---:|
| profiles | 1008 |
| followEdges | 5921 |
| posts | 50228 |
| topLevelPosts | 48224 |
| replies | 2004 |
| activeLikes | 5008 |
| activeReposts | 1004 |
| conversations | 1002 |
| dms | 901 |
| groups | 101 |
| memberships | 2054 |
| messages | 100015 |
| textMessages | 99105 |
| mediaMessages | 910 |
| quotedReplies | 2736 |
| activeReactions | 2000 |
| disappearingSettingsEnabled | 0 |
| users | 1008 |

Builder-only API diagnostics, p95 milliseconds (three warm-ups, 20 samples):

| Probe | 10% | 50% | Full |
|---|---:|---:|---:|
| following:u0005 | 3.587 | 2.734 | 2.384 |
| following:u0500 | 4.032 | 2.954 | 2.335 |
| following:u0901 | 2.966 | 3.174 | 2.983 |
| history:page1 | 13.301 | 11.963 | 11.535 |
| history:page50 | 13.658 | 12.496 | 12.484 |
| search:chat | 12.359 | 11.938 | 11.484 |
| search:grouped | 4.114 | 3.148 | 1.663 |
| insights | 1.041 | 1.029 | 1.388 |
| trending | 1.918 | 1.340 | 1.603 |

No hidden probe equivalence or score is implied.

## Build and native evidence

- M1: [Hermes bundle](artifacts/m1-ios/_expo/static/js/ios/entry-09a444c1d45e1e5fb11da81105da119a.hbc), 2959632 bytes.
- M2: [Hermes bundle](artifacts/m2-ios/_expo/static/js/ios/entry-65c48a2474f871eb5722210bd079a686.hbc), 2974980 bytes.
- M3: [Hermes bundle](artifacts/m3-ios/_expo/static/js/ios/entry-252eadc2d416d8e99a6601babc0ac225.hbc), 3007967 bytes.
- M4: [Hermes bundle](artifacts/m4-ios/_expo/static/js/ios/entry-c6c451a6f6c086e28031c9ea6baf5ec9.hbc), 3024231 bytes.
- M5: [Hermes bundle](artifacts/m5-ios/_expo/static/js/ios/entry-b9df77916475ec609ba9e52da6c83a9a.hbc), 3033909 bytes.
- M6: [Hermes bundle](artifacts/m6-ios/_expo/static/js/ios/entry-e03055fcf615c4ca28c21c64a0a97153.hbc), 3033937 bytes.
- M8: [Hermes bundle](artifacts/m8-ios/_expo/static/js/ios/entry-ba44aed2890610829569f9ab52375f0d.hbc), 3180739 bytes.

Hashes are in [native-artifacts.json](evidence/native-artifacts.json). Both native witness attempts returned exactly: `E_WITNESS_PLATFORM: witness ios requires macOS with Xcode and an installed iOS simulator`. M6 assertions m6-a01 through m6-a07 and M8 assertions m8-a17/m8-a18 are not-run. No simulator recording, screenshot or native-runtime pass is claimed.

Additional actual proofs: [cold offline web](evidence/m8-web-offline-proof.json), [scheduled digest across restart](evidence/m8-digest-proof.json), [expiry API](evidence/m5-expiry-api.json), [warm offline expiry/search](evidence/m5-expiry-offline.json), and M6 custom-client/sample replay receipts. Normal cached media, once-media exclusion, admitted pending sends across reload, and queued like/reaction settlement passed in the additional browser proof.

## Corrections and limitations

Recorded correction loops: 25; attribution totals: {"snapback-defect":0,"agent-error":18,"environment":4,"ambiguous":3}. This is a grouped, evidence-backed ledger: repeated attempts at one root cause count once, and first-pass syntax/type refusals before a completion claim do not count. It is not a transcript-derived semantic-action meter. Full descriptions and evidence pointers: [correction-loops.json](evidence/correction-loops.json).

1. **agent-error** — Optimistic onboarding data unmounted the profile form before a duplicate-handle refusal could render. Stable edit navigation fixed it. Evidence: evidence/m1-acceptance.log.
2. **environment** — Metro in CI did not watch edits, leaving a stale browser build; switched to exported web assets. Evidence: evidence/web.log.
3. **environment** — Frozen choreography imported a JSON-schema helper absent from the supplied snapshot. An explicit loader supplies AJV validation without modifying assertions. Evidence: evidence/m1-choreo-console.log.
4. **agent-error** — Pagination listened to window scrolling while the interface scrolled a React Native container; added an intersection sentinel. Evidence: evidence/m2-acceptance.log.
5. **environment** — React Native Web omitted kit observable values/selected states and placed image sources on descendants. Model-driven neutral attributes supplied the declared semantics. Iterations at M2 and M5. Evidence: src/Semantics.tsx; evidence/m2-choreo-console.log; evidence/m5-choreo-console.log; evidence/m5-choreo-console-2.log.
6. **agent-error** — Feed navigation was absent on profile routes, contrary to the interaction path; made navigation persistent. Evidence: evidence/m2-choreo-console.log.
7. **agent-error** — Ran a mutating suite concurrently with choreography, contaminating its fixture state; discarded the run and repeated sequentially. Evidence: evidence/m2-choreo-console-2.log.
8. **ambiguous** — usePage stalled at the first page despite a valid server continuation. Replaced its integration with an observed first page plus explicit client.query accumulation. No exact platform diagnostic established a defect. Evidence: src/usePaged.ts; evidence/m2-acceptance-7.log.
9. **ambiguous** — Durable queued typing did not satisfy observed expiry timing; throttled ephemeral online requests and server expiry resolved the behavior. Evidence: evidence/m3-choreo-console.log.
10. **agent-error** — Membership write was lost across hard navigation. Authenticated keepalive requests settled the same authorized operation before leaving. Evidence: src/online.ts; evidence/m3-choreo-console.log.
11. **agent-error** — Completion of an earlier send cleared a later draft or attachment. Snapshot/clear at dispatch and conditional restoration fixed the race. Evidence: evidence/m4-acceptance-2.log.
12. **agent-error** — Asynchronous root video selection was unstable for the frozen media observer. A stable viewer container with a video child made actual loaded media observable. Evidence: src/Video.tsx; evidence/m4-choreo-console-3.log.
13. **ambiguous** — A committed video missed one browser render deadline; an independent fresh browser rendered a live text promptly. Cause of that isolated timing miss was not conclusively established. Evidence: evidence/m4-render-probe.log.
14. **agent-error** — Transient query states discarded valid rows and unmounted interactive bubbles. Retained valid results, fixed held-query selection, and reduced the initial page with continuation. Evidence: src/usePaged.ts; evidence/m4-acceptance-7.log.
15. **agent-error** — Replay retry recognized the wrong duplicate-account diagnostic. Exact E_AUTH duplicate-account message now selects login. Evidence: evidence/m6-sample-retry.log.
16. **agent-error** — Replay retry uploaded new asset IDs under already-used mutation IDs. E_ID_REUSED correctly refused changed arguments; existing matching media references are reused. Evidence: evidence/m6-sample-retry-2.log.
17. **agent-error** — A semantic like bridge compared false with false and reported selected. Selection now follows the model boolean. Evidence: evidence/m8-choreo-console.log.
18. **agent-error** — Handle-based DM resolution depended on an online operation after reload. A local held membership lookup plus retained resolved ID supports cold offline entry. Evidence: evidence/m8-web-offline-proof-attempt2.json.
19. **agent-error** — Pending sends became invisible outside a latest-time page under induced server/device clock skew. Persistent presentation references keep actual admitted intents visible. Evidence: evidence/m8-web-offline-proof-attempt6.json; src/outbox.ts.
20. **agent-error** — SDK mutation IDs were UUIDs rather than mintId values, correctly refused as E_WRITE_ID. Failed references also appeared pending. Admission, failure and recovery now follow the actual SDK journal. Multiple retained retries belong to this single root-cause loop. Evidence: evidence/m8-write-id-why.txt; evidence/m8-web-offline-console-8.log; evidence/m8-web-offline-console-14.log.
21. **agent-error** — Cold media test disconnected on element visibility rather than decoded bytes; waiting for naturalWidth made cache verification valid. Evidence: evidence/m8-web-offline-console-15.log; evidence/m8-web-offline-proof.json.
22. **agent-error** — Temporary asynchronous response logging threw after browser shutdown and prevented final proof persistence; removed the diagnostic listener and repeated. Evidence: evidence/m8-web-offline-console-16.log; evidence/m8-web-offline-console-17.log.
23. **agent-error** — Scale probe runner omitted the contract warm-ups and deadlines. Stopped the partial attempt, retained its successful first-checkpoint state verification, and restarted a fresh instance with three warm-ups and 30-second deadlines. Evidence: evidence/scale-attempt1/scale-clock.json; scripts/verify-scale.mjs.
24. **environment** — Expo reused the previous inlined backend URL despite a new export-time environment value. A clean-cache export fixes the separate scale browser build; build scripts now clear the cache explicitly. Evidence: evidence/scale-cold-start-attempt1.json; evidence/scale-export-web-2.log.
25. **agent-error** — An additional passing M5 suite overwrote the receipt bytes hashed by its green choreography. Kept original green evidence and reran choreography against the retained passing suite. Evidence: evidence/m5-choreography-first-green.jsonl; evidence/m5-choreo-custody-regression.log.

Candid gaps:

- Apple simulator/Xcode were unavailable. Native cold start, force quit, multi-device behavior and media were not executed on iOS. Hermes compilation cannot establish them.
- Independent hidden probes, the grader's seeded sample, calibrated performance ceilings, and external adjudication remain for the grader. Builder diagnostics do not establish an O5 band. Celebrity write-path and native receipt-render scale probes are not claimed.
- Harness-native per-turn tokens, driver-stamped first-edit/orientation custody and complete phase attribution were not exposed. Tokens/caps/charges are null, with reason native-usage-stream-not-exposed. The base run record validates; the driver/grader-completed social-messenger extension does not yet validate and is explicitly pending. No efficiency result is claimed.
- M7 was intentionally not attempted.
- The provider seam logs durable push/digest requests; it is not an APNs/FCM deployment. The backend runs in local development mode. Production transport, operational deployment and native delivery need deployment-specific work.
- The current grading configuration uses the supplied shortened windows/digest period. The config generator can restore production windows and 08:00 UTC scheduling.
- Full-scale web cold sync exceeded the 30s deadline. The populated declared replica contains 171330 rows/35901571 compact JSON payload bytes. An isolated bounded-source experiment produced E_TIMELINE_SHAPE: posts must be explicitly public, fully synced, non-expiring application data. This documents a limitation of the chosen materialized Following path, not proof that every alternative feed architecture is impossible. See evidence/scale-residency-measurement.txt and evidence/scale-horizon-refusal.txt. The separate 180s observation also timed out and remains a failure; 30s remained the pass criterion. Public content uses broad replica residency, while message residency is bounded. Held searches explicitly report device-limited coverage. Deeper retained page arrays are snapshots until refreshed; this implementation does not claim exhaustive UI race coverage outside the retained tests.
- No confirmed Snapback defect was established. Unresolved pagination/typing/render timing attributions remain ambiguous rather than being converted into platform defects.
- Source formatting is compact; physical LOC is a ceremony metric, not a maintainability or productivity claim.

## Hand-authored source inventory

846 physical lines (839 nonblank), 68 files, 168823 bytes. Shared frozen UI: 3595 lines, excluded. Generated types/config/schedule, copied harness/fixtures, dependencies, bundles and prose are excluded. Adapted client scaffold is counted as a whole source file; package.json/app.json are separately identified as hand-edited configuration. Exact counting rule and bytes: [loc.json](evidence/loc.json).

| File | Physical lines | Nonblank |
|---|---:|---:|
| app/_layout.tsx | 5 | 5 |
| app/chat/[id]/index.tsx | 1 | 1 |
| app/chat/[id]/settings.tsx | 1 | 1 |
| app/chats.tsx | 1 | 1 |
| app/conversation/[handle].tsx | 1 | 1 |
| app/conversation/group/[group]/index.tsx | 1 | 1 |
| app/conversation/group/[group]/settings.tsx | 1 | 1 |
| app/index.tsx | 1 | 1 |
| app/insights.tsx | 1 | 1 |
| app/new-chat.tsx | 1 | 1 |
| app/post/[id].tsx | 1 | 1 |
| app/profile/[handle].tsx | 1 | 1 |
| app/profile/edit.tsx | 1 | 1 |
| app/search.tsx | 1 | 1 |
| app/settings.tsx | 1 | 1 |
| scripts/acceptance.mjs | 28 | 28 |
| scripts/api.mjs | 7 | 7 |
| scripts/boundary.mjs | 1 | 1 |
| scripts/choreo.mjs | 5 | 5 |
| scripts/cleanup.mjs | 7 | 7 |
| scripts/configure.mjs | 2 | 2 |
| scripts/correction-inventory.mjs | 29 | 29 |
| scripts/custom-client-demo.mjs | 3 | 3 |
| scripts/digest-proof.mjs | 18 | 18 |
| scripts/final-report.mjs | 20 | 20 |
| scripts/instrument-loader.mjs | 1 | 1 |
| scripts/instrument-schema.mjs | 2 | 2 |
| scripts/m2-tests.mjs | 14 | 14 |
| scripts/m3-tests.mjs | 10 | 10 |
| scripts/m4-tests.mjs | 6 | 6 |
| scripts/m5-tests.mjs | 6 | 6 |
| scripts/m6-tests.mjs | 11 | 11 |
| scripts/m8-tests.mjs | 8 | 8 |
| scripts/probe-expiry.mjs | 1 | 1 |
| scripts/probe-media.mjs | 1 | 1 |
| scripts/probe-render.mjs | 1 | 1 |
| scripts/probe-settings.mjs | 1 | 1 |
| scripts/push-worker.mjs | 4 | 4 |
| scripts/replay-adapter.mjs | 28 | 28 |
| scripts/report-inventory.mjs | 6 | 6 |
| scripts/scale-cold-start.mjs | 2 | 2 |
| scripts/scale-replay.mjs | 5 | 5 |
| scripts/seed.mjs | 21 | 21 |
| scripts/start-scale-web.mjs | 2 | 2 |
| scripts/start-scale.mjs | 4 | 4 |
| scripts/start-worker.mjs | 1 | 1 |
| scripts/start.mjs | 2 | 2 |
| scripts/verify-digest-proof.mjs | 1 | 1 |
| scripts/verify-scale.mjs | 25 | 25 |
| scripts/web-offline-proof.mjs | 8 | 8 |
| scripts/web-server.mjs | 3 | 3 |
| snapback/digest.q | 19 | 19 |
| snapback/insights.q | 19 | 19 |
| snapback/schema.q | 352 | 346 |
| src/Chat.tsx | 40 | 40 |
| src/Feed.tsx | 16 | 16 |
| src/Insights.tsx | 6 | 6 |
| src/Search.tsx | 3 | 3 |
| src/Semantics.tsx | 4 | 4 |
| src/Shell.tsx | 21 | 21 |
| src/Video.tsx | 3 | 3 |
| src/client.ts | 19 | 18 |
| src/online.ts | 5 | 5 |
| src/outbox.ts | 7 | 7 |
| src/outboxStore.ts | 2 | 2 |
| src/outboxStore.web.ts | 1 | 1 |
| src/pick.ts | 5 | 5 |
| src/usePaged.ts | 11 | 11 |

Hand-edited configuration (full file sizes, excluded from source total):

- package.json: 49 physical lines.
- app.json: 24 physical lines.
- .gitignore: 9 physical lines.

The experience essay was written after M8 and before this numerical tally: [essay.md](essay.md). Milestone observations: [diary.md](diary.md). Timestamped errors/lookups/retries/process inventory: [run-log.md](run-log.md). Cleanup only targets explicitly recorded PIDs whose current working directory is inside this lane; see evidence/process-cleanup.json.

end=1790318177
