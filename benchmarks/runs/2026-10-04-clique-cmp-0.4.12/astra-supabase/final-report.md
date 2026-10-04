# Clique full-run report

Lane: astra-clique-supabase-20260916. Model: gpt-6-astra; effort=medium. Backend: @supabase/supabase-js@2.112.4 with hosted Supabase Auth, Storage and PostgreSQL. One agent, no delegation. Linux x86_64; Node v24.13.1, npm 11.8.0; the observed Node version differed from the environment overlay and is preserved in evidence/environment.txt. No sibling lane or prior implementation was inspected.

M1, M2, M3, M4, M5, M6 and M8 achieved the supplied ENVIRONMENT.md web green bar: coverage-validated required suite plus required choreography. M7 is **not-run**, as requested. This does **not** claim native simulator success or a successful scale replay.

Run start: **1789562678**. Report written at: **1789568434.525**.

## Milestone clocks

All epochs are Unix seconds. Logged starts are raw run-log event timestamps, and first-green ends come from immutable choreography receipts. Some planning/transition work preceded the start-log write. The conservative continuous wall charges that gap from the preceding milestone's first green; it is provided rather than silently subtracting it. Scale has its own clock, overlaps this overall chronology, and is not an additional completion milestone. M8 post-green robustness work and final revalidation are recorded separately below.

| Milestone | Status | Logged start | First green/end | Raw wall s | Conservative continuous wall s |
|---|---|---:|---:|---:|---:|
| M1 | green | 1789562678 | 1789563189.598 | 511.598 | 511.598 |
| M2 | green | 1789563207 | 1789564497.115 | 1290.115 | 1307.517 |
| M3 | green | 1789564610 | 1789565082.883 | 472.883 | 585.768 |
| M4 | green | 1789565152 | 1789565453.325 | 301.325 | 370.442 |
| M5 | green | 1789565540 | 1789566414.82 | 874.820 | 961.495 |
| M6 | green | 1789566579 | 1789567088.462 | 509.462 | 673.642 |
| M8 | green | 1789567234 | 1789567771.936 | 537.936 | 683.474 |
| M7 | not-run | — | — | — | — |

No milestone exhausted the four-hour safety limit. The detailed raw/conservative starts, UTC first-green times and latest verification times are in `evidence/milestones.json`.

## Suites and choreography

| Milestone | Required suite assertions covered | Latest suite | First green receipt | Latest green receipt |
|---|---:|---|---|---|
| M1 | 7 | pass | evidence/choreo-m1.jsonl | evidence/choreo-m1.jsonl |
| M2 | 22 | pass | evidence/choreo-m2-1789564387696.jsonl | evidence/choreo-m2-1789564387696.jsonl |
| M3 | 7 | pass | evidence/choreo-m3-1789564974088.jsonl | evidence/choreo-m3-1789564974088.jsonl |
| M4 | 5 | pass | evidence/choreo-m4-1789565386638.jsonl | evidence/choreo-m4-1789565386638.jsonl |
| M5 | 6 | pass | evidence/choreo-m5-1789566053910.jsonl | evidence/choreo-m5-1789566053910.jsonl |
| M6 | 5 | pass | evidence/choreo-m6-1789567077510.jsonl | evidence/choreo-m6-1789567077510.jsonl |
| M8 | 6 | pass | evidence/choreo-m8-1789567736910.jsonl | evidence/choreo-m8-1789568140353.jsonl |

M8 latest full green: 2026-09-16T14:16:09.942Z. The earlier first green was followed by normal attachment queue hardening, Expo Crypto integration and web-server correction/revalidation. Coverage manifests are evidence/coverage-mN.json; unique suite receipts retain outcomes for the linked green runs. The initial M1 receipt uses its preserved canonical suite file. The M2 feed suite was rerun after pagination work; its latest result is a regression check, not a replacement first-green clock.

Choreography was copied into this lane and installed locally. CHOREO_BASE_URL was http://127.0.0.1:55300. Failed receipts remain present. The unchanged harness needed a missing sibling JSON-schema helper; the loader supplies AJV2020 validation for that exact import. No assertion was converted to a pass or silently skipped. Native assertions are separately unavailable/not-run under the environment ruling. M3+ uses an explicitly declared ABC-only choreography group so the all-recipient read assertion is not held open by an unrepresented fourth starter member; original starter state remains installed. UI compatibility adaptations are disclosed in evidence/media-compatibility.md.

## Native and additional artifacts

Each completed milestone has an iOS Hermes export under artifacts/mN-ios. Native simulator attempts are artifacts/native/m6-attempt.json and m8-attempt.json: xcrun simctl list devices failed ENOENT on Linux. M6-a01–a07 and M8-a17–a18 remain unavailable/not-run. A Hermes bundle and browser restart are not native proof.

- artifacts/m1-ios/_expo/static/js/ios/entry-9ec9e7cbaad796d1f8c08d25605fee60.hbc: 2671700 bytes; SHA-256 534d47a635b03ddabf5aee346cc492c337afb1b29122f5aa382e6b7b45315719.
- artifacts/m2-ios/_expo/static/js/ios/entry-a92b7005eee0ed8c4f3c816ae4d32ea3.hbc: 2714752 bytes; SHA-256 9014e20494187dd04670870032e2f7178f29513ddc16fc7d27f4a8fddcd82064.
- artifacts/m3-ios/_expo/static/js/ios/entry-ab411cd07fd74f39f42383d1b629221e.hbc: 2730260 bytes; SHA-256 254a5d6fb6c6bf0783ace297fa4977bdc0054410073bf58870ffc80e9b91924b.
- artifacts/m4-ios/_expo/static/js/ios/entry-079007ee976548fe4509e70ce8d3c9b8.hbc: 2761473 bytes; SHA-256 e121630e91c8feed1cde5ec991fd9a7278571f498ecfc8f64bbc37ecc2494354.
- artifacts/m5-ios/_expo/static/js/ios/entry-d2c1231cb681a5e4a70d6b3c34b4d195.hbc: 2797718 bytes; SHA-256 782aefbb1898240eea07f73d35d8e984da61e9359e5f0d1473743e11a9c3a87e.
- artifacts/m6-ios/_expo/static/js/ios/entry-64c0bc79374b50f1d8ffe26a8c6ab866.hbc: 2807821 bytes; SHA-256 0036e3840d5587687ab098d4ad7184e93de9139f8bb763d70acbae8879c7e173.
- artifacts/m8-ios/_expo/static/js/ios/entry-3310188e5726b2a938d42f83cc6d1b30.hbc: 2827995 bytes; SHA-256 132a141e145dbfcd5f1336a0c51dd233e176996d2fc188e85128137ca0c08086.

`evidence/native-artifacts.json` also records metadata and native-attempt hashes. `evidence/offline-restart-web.json` records a passing Chromium process restart with two pending texts plus a queued photo, durable history, ordered reconnect and read receipts. `evidence/digest-proof.json` records exact scheduled counts, unrelated-chat exclusion, zero-user suppression, restart idempotency and suppression in the next inactive period. These are additional web/server proofs. `evidence/types-final.log` records a passing TypeScript check.

## Scale replay — failed

Own clock: start=1789567147.217; end=1789567174.361; wall=27.144 seconds; excluded probes=0; charged=27.144 seconds. A 14,400-second safety limit was declared because the supplied instrument leaves the calibrated replay cap as a placeholder; this is not claimed as an official calibrated threshold.

A fresh clq916a_scale_ instance used separate tables, buckets and real namespaced Auth identities, with CLQ_REPLAY=1 disabling push and digest. The same thirteen-verb authenticated adapter first settled 30 starter actions. It then stopped on **mime type video/mp4 is not supported**, before any of the 167157 scale actions settled. The fresh public-bucket creation branch omitted video from its MIME allowlist, although the development bucket update branch accepted it. Attribution: **agent-error**. The source bootstrap was corrected later; the terminal failed execution was preserved, not relabeled or resumed against partially seeded state.

The adapter's fifty-action dev conformance run passed frozen syntax validation and lane-authored resulting-state checks, with one settlement receipt per action (evidence/sample-50-verification.json and sample-50-receipts.jsonl). That does not rescue this fresh-instance replay. Independent counts/maps compared against invariant-manifest-combined.json fail, as recorded in evidence/scale-verification-full.json. Neither checkpoint was reached, and no valid scale probes or degradation ratios exist. O5 is therefore not passed; no hidden-grader sample or performance score is claimed.

## Correction loops

Protocol-deduplicated loops: 18; attribution counts: {"agent-error":13,"environment":5}. Supabase defects established: 0. This is not a claim that the platform has no defects. First-pass syntax repairs are excluded from the loop total even where run-log wording called them a correction loop. Repeated ARIA compatibility fixes are one cause with three iterations; repeated Metro setup misses retain their individual receipts. The inventory and evidence pointers are in evidence/correction-loops.json.

| Cause | Attribution | Iterations | Evidence |
|---|---|---:|---|
| Confirmed test signup path after hosted email-confirmation behavior | agent-error | 1 | evidence/seed-m1.log |
| Unsupported optional catch-all route replaced with index plus catch-all | agent-error | 1 | evidence/diagnose.png |
| Authenticated existing fixture identities needed lane-local profiles | agent-error | 1 | evidence/seed-m1-retry2.log |
| Copied required metering/observability siblings | environment | 1 | evidence/choreo-m1.log |
| Frozen snapshot omitted JSON schema helper; narrow AJV loader supplied | environment | 1 | scripts/instrument-loader.mjs |
| RN Web omitted semantic values, background state, and toggle selection; equivalent ARIA added to vendor kit | environment | 3 | evidence/media-compatibility.md |
| Host lacked ffprobe; installed package-local validator binary | environment | 1 | evidence/ffprobe-install.log |
| Harness required decoded video attachment image preview; extracted a real frame | agent-error | 1 | choreography/choreography.mjs |
| Feed tabs missing from profile navigation surface | agent-error | 1 | evidence/choreo-m2-nav.log |
| Stack retained duplicate hidden DOM contract IDs; switched to Slot | agent-error | 1 | scripts/diagnose-nav.mjs |
| Tab switch displayed stale prior-scope rows before fetch settled | agent-error | 1 | evidence/choreo-m2-nav.log |
| Suite incorrectly excluded own legitimate reposts | agent-error | 1 | evidence/acceptance-m2-slot.log |
| Repeated text matched an older message and raced the seed snapshot | agent-error | 1 | evidence/acceptance-m3-final.log |
| Hyphenated sample email needed valid initial handle during existing-account login | agent-error | 1 | evidence/suite-m6-1789566829358.json |
| Pending receipt needed kit receiptPending instead of receipt enum | agent-error | 1 | evidence/offline-diagnosis.log |
| Fresh bucket MIME creation differed from update path; terminal replay failure preserved | agent-error | 1 | evidence/scale-result.json |
| Existing Metro module graph did not resolve newly installed Expo Crypto until restart | environment | 2 | evidence/expo.log |
| Restart in CI mode disabled file watching; extended media test ran stale code | agent-error | 3 | evidence/expo-restart2.log |

## Resolved package pins

Exact root dependency resolutions (full tree closure is package-lock.json):

- @react-native-async-storage/async-storage: 2.2.0
- @supabase/supabase-js: 2.112.4
- @types/react: 19.2.18
- dotenv: 17.4.2
- expo-constants: 55.0.17
- expo-crypto: 55.0.19
- expo-file-system: 55.0.26
- expo-image-picker: 55.0.24
- expo-linking: 55.0.17
- expo-router: 55.0.18
- expo-status-bar: 55.0.6
- expo-video: 55.0.21
- expo: 55.0.31
- express: 5.2.1
- ffprobe-static: 3.1.0
- multer: 2.4.0
- pg: 8.23.0
- react-dom: 19.2.0
- react-native-safe-area-context: 5.6.2
- react-native-screens: 4.23.0
- react-native-web: 0.21.2
- react-native: 0.83.10
- react: 19.2.0
- typescript: 5.9.3

## Hand-authored physical line counts

Physical source lines; blank-inclusive and nonblank, dense formatting not expanded. Excludes generated lockfiles/builds, instrument copies, vendor UI, run narrative/evidence. Config JSON copied from fixture is marked separately. Total inventory lines: 914. Fixture-copied config files are shown but are not original code; subtract their 32 lines for an authored-only count. Vendor UI modifications are disclosed separately and the vendor's full source is not counted as authored. Narrative reports/diary/essay and generated package-lock are excluded.

| File | Physical lines | Nonblank |
|---|---:|---:|
| app/[...path].tsx | 29 | 29 |
| app/_layout.tsx | 2 | 2 |
| app/index.tsx | 1 | 1 |
| client/Chat.tsx | 37 | 37 |
| client/Insights.tsx | 3 | 3 |
| client/Search.tsx | 7 | 7 |
| client/Social.tsx | 16 | 16 |
| client/assets.ts | 12 | 11 |
| client/cache.ts | 9 | 8 |
| client/config.ts | 1 | 1 |
| client/media.tsx | 5 | 5 |
| client/queue.ts | 11 | 11 |
| client/storage.ts | 5 | 5 |
| server/config.mjs | 2 | 2 |
| server/db.mjs | 4 | 4 |
| server/digest.mjs | 8 | 8 |
| server/digest.sql | 3 | 3 |
| server/env.mjs | 7 | 7 |
| server/ephemeral.mjs | 20 | 20 |
| server/index.mjs | 75 | 75 |
| server/insights.mjs | 2 | 2 |
| server/insights.sql | 58 | 58 |
| server/media-validation.mjs | 9 | 9 |
| server/message-actions.mjs | 8 | 8 |
| server/messaging.mjs | 38 | 38 |
| server/push.mjs | 3 | 3 |
| server/schema.sql | 65 | 65 |
| server/social.mjs | 20 | 20 |
| scripts/acceptance.mjs | 28 | 28 |
| scripts/boundary.mjs | 7 | 7 |
| scripts/choreo.mjs | 7 | 7 |
| scripts/cleanup.mjs | 15 | 15 |
| scripts/custom-client-demo.mjs | 6 | 6 |
| scripts/diagnose-feed.mjs | 1 | 1 |
| scripts/diagnose-media.mjs | 1 | 1 |
| scripts/diagnose-nav.mjs | 1 | 1 |
| scripts/diagnose-offline.mjs | 2 | 2 |
| scripts/diagnose.mjs | 3 | 3 |
| scripts/digest-proof.mjs | 5 | 5 |
| scripts/instrument-loader.mjs | 1 | 1 |
| scripts/json-schema.mjs | 2 | 2 |
| scripts/log.mjs | 2 | 2 |
| scripts/migrate-m8.mjs | 1 | 1 |
| scripts/migrate.mjs | 3 | 3 |
| scripts/offline-restart-proof.mjs | 5 | 5 |
| scripts/remove-orphan.mjs | 4 | 4 |
| scripts/replay-adapter.mjs | 21 | 21 |
| scripts/restart-api.mjs | 4 | 4 |
| scripts/restart-web.mjs | 3 | 3 |
| scripts/scale-replay.mjs | 7 | 7 |
| scripts/seed.mjs | 25 | 25 |
| scripts/suite-m2.mjs | 22 | 22 |
| scripts/suite-m3.mjs | 11 | 11 |
| scripts/suite-m4.mjs | 7 | 7 |
| scripts/suite-m5.mjs | 8 | 8 |
| scripts/suite-m6.mjs | 10 | 10 |
| scripts/suite-m8.mjs | 6 | 6 |
| scripts/test-client.mjs | 6 | 6 |
| scripts/verify-scale.mjs | 9 | 9 |
| config/digest.json | 8 | 8 |
| config/windows.json | 24 | 24 |
| package.json | 42 | 42 |
| app.json | 18 | 18 |
| tsconfig.json | 4 | 4 |
| README.md | 26 | 15 |
| API.md | 57 | 38 |
| .gitignore | 7 | 6 |
| scripts/report.mjs | 35 | 35 |

## Gaps and limits

- The full scale corpus was not replayed; fresh-instance setup failed before the scale log. No performance envelope is established.
- No iOS simulator behavior was verified. Native modules, media playback, durable storage and offline restart remain unproven on Apple hardware.
- The service uses polling, not Supabase Realtime subscriptions. No Realtime channels were created. Polling load and long-history behavior have no validated scale guarantee.
- The API and scheduled workers run as local Node processes against hosted services. There is no managed service deployment, durable external scheduler or APNs/FCM delivery; only the requested logged push seam.
- The client synchronizes the latest 200 messages per active chat, with explicit history paging for older messages. Profile post rendering still has a 100-post server cap. Feed paging uses 20-entry cursors.
- Normal media can be queued durably; view-once attachments require an online upload so their bytes are not written into the durable queue. Received view-once bytes are transient.
- Database TLS certificate verification is relaxed for this hosted environment. Production deployment should provide a verified CA and a device-reachable API address. Signup uses administratively confirmed test email identities, not an end-user verification flow.
- Source is compact and several screens/server modules are dense. This is production-shaped functional code, not a completed production operations/security review.
- Native, hidden-grader, and scale assertions are not inferred from web green receipts. The sample state verifier is lane-authored; the supplied fixture validator checks the frozen action grammar, not an independent hidden state sample.
- Token usage is null: no harness-native token accounting was exposed. No estimate is substituted.

## Cleanup

The report is written before cleanup, as requested. The cleanup script will stop only recorded lane server PIDs, remove every prefixed bucket/object and application database object, and delete only Auth accounts carrying this lane's creation marker. Existing fixture Auth identities not created by this lane are preserved. The result will be appended with evidence/cleanup.json.

Cleanup completed: **pass**. Own stopped server PIDs: 3162716, 3173009, 3193024. Removed 4 prefixed buckets, 42 tables, 2 functions, 2 storage policies, and 16 newly created Auth users. Dependent indexes, constraints, triggers and owned sequences were dropped with their tables; remaining prefixed relations, functions, policies and buckets are all empty, and remaining lane-marked Auth users are zero. No Realtime channels were created. Existing unmarked fixture Auth identities were preserved. Ports 55300, 55301 and 55302 have no listeners. See evidence/cleanup.json and evidence/ports-after-cleanup.txt.

The initial cleanup attempt returned bucket-not-empty after emptyBucket; evidence/cleanup-attempt1.json preserves it. Explicit SDK object removal completed the retry. This adds one post-report cleanup correction loop (ambiguous) to the 18 milestone loops; 19 total including cleanup. No resource cleanup failure remains.

M8 final required revalidation ended at 1789568169.942; elapsed from its logged start through that revalidation: 935.942 seconds. Final M2 pagination regression also passed against the current watched client (evidence/regression-m2-current.log). Credential scan of native build artifacts passed without exposing values (evidence/bundle-secret-scan.json). Total elapsed run wall through cleanup/report completion: 5854 seconds.

end=1789568532
