# Clique — final report

Lane: astra-clique-snapback4-full-20260913. Model: gpt-6-astra, effort=medium. All requested milestones are green; M7 was intentionally not run. This is not an O5 performance pass: measured full-corpus cold login-to-feed was about 55 seconds, above the brief's 30-second probe timeout. All work stayed in this lane, using the published package/documentation surface and the supplied instrument. No sub-agents or other implementations were used.

Start=1789665313; end=1789673319; total elapsed=8006 seconds. The separate replay overlapped later authoring, so phase walls are not additive. Essay was written before this quantitative tally.

## Milestone clocks

Epochs are Unix seconds. Start/end are timestamped authoring/review boundaries in run-log.md; first-green is the exact original green choreography summary timestamp. Later regression receipts are retained separately. M1 includes initial orientation.

| Milestone | Status | Start | End | Wall seconds | First-green epoch |
|---|---|---:|---:|---:|---:|
| M1 | green | 1789665313 | 1789665913 | 600 | 1789665839.385 |
| M2 | green | 1789665913 | 1789666412 | 499 | 1789666329.775 |
| M3 | green | 1789666412 | 1789667091 | 679 | 1789667068.68 |
| M4 | green | 1789667091 | 1789667335 | 244 | 1789667277.099 |
| M5 | green | 1789667335 | 1789667744 | 409 | 1789667712.273 |
| M6 | green | 1789667744 | 1789668146 | 402 | 1789668031.36 |
| M8 | green | 1789668197 | 1789673280 | 5083 | 1789668677.058 |
| M7 | not-run | — | — | — | — |

M1's original duplicate-handle test exercised editing; an explicit onboarding duplicate-handle check was subsequently added and passed in evidence/m1-suite-strengthened.json, with a fresh passing choreography receipt. The original green time is an observed instrument receipt, not a claim that this later coverage strengthening happened earlier. M6's later sample verification compares the complete final fixture intents. M8 review extended past its initial green to cover cold media, pagination and confirmed receipt watermarks; its final end includes that extension.

## Verification and native artifacts

| Milestone | Suite | Choreography | iOS Hermes export |
|---|---|---|---|
| M1 | pass — evidence/m1-suite.json | pass — evidence/m1-choreo.jsonl | artifacts/m1-ios |
| M2 | pass — evidence/m2-suite.json | pass — evidence/m2-choreo.jsonl | artifacts/m2-ios |
| M3 | pass — evidence/m3-suite.json | pass — evidence/m3-choreo.jsonl | artifacts/m3-ios |
| M4 | pass — evidence/m4-suite.json | pass — evidence/m4-choreo.jsonl | artifacts/m4-ios |
| M5 | pass — evidence/m5-suite.json | pass — evidence/m5-choreo.jsonl | artifacts/m5-ios |
| M6 | pass — evidence/m6-suite.json | pass — evidence/m6-choreo.jsonl | artifacts/m6-ios |
| M8 | pass — evidence/m8-suite.json | pass — evidence/m8-choreo.jsonl | artifacts/m8-ios |

Every suite-required assertion is mapped in coverage.json and the individual suite receipts. Native bundle hashes and sizes are in evidence/native-artifacts.json. No simulator proof is claimed or required by this run's user instruction. Additional passing proofs: evidence/m5-unattended-expiry.log; evidence/m8-digest-proof.json; evidence/m8-offline-restart-proof.json; evidence/m8-offline-media-proof.json; evidence/delivery-pagination-proof.json; evidence/final-ui-proof.json; evidence/final-regression.json. The digest proof covers no connected clients, a mid-period restart, exact counts, unauthorized-chat exclusion, an inactive user and an empty next period.

## Scale replay

Cumulative clock start=1789668153.824; end=1789672461.107; wall=4307.283000230789 seconds. Final fresh-attempt start=1789670543.396; wall=1917.7110002040863 seconds; checkpoint verification/probe wall=11.469000000000001 seconds. The final fresh instance consumed all starter segments plus all 167,157 scale actions through real authentication and application writes, settling each before the next. Replay mode suppressed new notification effects and held schedules. Fixture SHA-256 was checked. Both checkpoints and final invariants passed; see evidence/scale-10pct-verification.json, evidence/scale-50pct-verification.json and evidence/scale-final-verification.json.

The earlier instance is retained as scale-attempt-m6. Its first interruption was a verifier error (scalar aggregate treated as an object), repaired without replaying settled actions. Its 50% check then correctly caught a missing self-repost in the older actor/post event key. That failed instance was preserved, and a fresh final-schema replay was used instead of applying an extra repair outside the fixture. Attempt clocks/errors are in evidence/scale-replay-attempt1.json and evidence/scale-replay-attempt2.json. Final result: evidence/scale-replay-result.json. After replay, a residency-only schema adoption bounded social-feed sync and added its audience index; no fixture writes were added, and the complete final invariants were reverified. Read-probe samples are diagnostic observations, not an independent O5 grade. Full-corpus Insights and Trending were additionally checked against independent SQL in evidence/scale-final-ui.json. Its earlier attempt timed out on an authentication error because Metro reused the main-backend URL in the scale export; evidence/scale-final-ui-attempt1.json and evidence/scale-browser-diagnosis-auth.json preserve that agent export mistake. Clearing the bundler cache and verifying the target URL corrected the deployment. A subsequent correctly targeted timeout exposed excessive residency; the bounded version rendered feed, Insights and chats successfully, with the cold latency disclosed below.

## Pins, corrections and limitations

Resolved pins: snapback4=0.2.28; snapback4-expo=0.2.19; platform binary package=0.2.28. package-lock.json retains the dependency closure; setup-identity.json records binary/wrapper hashes.

Explicit correction episodes recorded in run-log.md: {"agent-error":23,"environment":1,"ambiguous":0,"snapback-defect":0}. Their descriptions and evidence pointers are preserved in run-record.json rather than collapsed into a single failure count. No demonstrated package defect or inability to express a required feature is claimed. The important app mistakes included route retention, media fixture paths, an offline dynamic import, late composer clearing, worker module mode, wire-ID mapping, aggregate scalar handling, self-repost identity, typed feed projection fields, and first-page-only delivery/group lookup.

Candid limits: this is a local development deployment; HTTPS hosting and real APNs/FCM are outside the brief. Social posts/events/source-feed residency is bounded to 5,000 rows and private/broadcast feeds to 1,000; other public rows still fully sync. The published feed recipe has explicit finite caps (evidence/m8-feed-recipe.txt). Measured full-corpus cold login-to-first-feed was 54,982 ms even after bounding social residency. This exceeds the published 30-second probe timeout and is an unresolved scale-performance gap; the independent rotated O5 grade was not run. The earlier correctly targeted unbounded browser attempt timed out at 120,000 ms. Native Hermes exports do not establish simulator or physical-device behavior. Formal grader outcomes, scores and native token accounting are not invented: this lane provides a base-schema-validated run-record.json, raw milestone/receipt evidence, and milestones.json; the complete composed metering/grading record requires the external driver and grader. Token totals are null because their harness-native source is not exposed inside the allowed lane. No frozen choreography checks were relabeled as passes.

Owned server cleanup is recorded in evidence/process-cleanup.json and run-log.md. Only recorded, verified owned PIDs were stopped.

## Hand-authored physical lines

Counts include whole authored/edited production, test, tooling and configuration files, including blank lines. Generated types/configs, copied recipe (except its four hand-edited residency/index lines) and UI/choreography, lockfile, build artifacts and duplicate instance copies are excluded. Shared UI is recorded separately in run-record.json.

| File | Lines |
|---|---:|
| app.json | 29 |
| app/_layout.tsx | 32 |
| app/chats.tsx | 1 |
| app/conversation/[handle]/index.tsx | 6 |
| app/conversation/[handle]/settings.tsx | 6 |
| app/conversation/group/[group]/index.tsx | 6 |
| app/conversation/group/[group]/settings.tsx | 6 |
| app/index.tsx | 31 |
| app/insights.tsx | 55 |
| app/new-chat.tsx | 1 |
| app/post/[id].tsx | 6 |
| app/profile/[handle].tsx | 6 |
| app/profile/edit.tsx | 4 |
| app/search.tsx | 90 |
| app/settings.tsx | 11 |
| choreo-adapter.json | 10 |
| package.json | 50 |
| scripts/acceptance-m2.mjs | 257 |
| scripts/acceptance-m3.mjs | 112 |
| scripts/acceptance-m4.mjs | 129 |
| scripts/acceptance-m5.mjs | 119 |
| scripts/acceptance-m6.mjs | 225 |
| scripts/acceptance-m8.mjs | 177 |
| scripts/acceptance.mjs | 174 |
| scripts/choreo.mjs | 28 |
| scripts/cleanup.mjs | 88 |
| scripts/configure.mjs | 25 |
| scripts/custom-client-demo.mjs | 89 |
| scripts/debug-inbox.mjs | 22 |
| scripts/debug-receipts.mjs | 66 |
| scripts/delivery-pagination-proof.mjs | 104 |
| scripts/digest-proof.mjs | 221 |
| scripts/expiry-proof.mjs | 66 |
| scripts/export-web.mjs | 42 |
| scripts/final-ui-proof.mjs | 121 |
| scripts/offline-media-proof.mjs | 134 |
| scripts/offline-proof.mjs | 107 |
| scripts/replay.mjs | 195 |
| scripts/report.mjs | 251 |
| scripts/run-scale.mjs | 79 |
| scripts/scale-browser-diagnose.mjs | 40 |
| scripts/scale-final-ui.mjs | 134 |
| scripts/seed.mjs | 142 |
| scripts/serve-web.mjs | 43 |
| scripts/setup.cjs | 42 |
| scripts/start-backend.sh | 5 |
| scripts/start-scale.sh | 5 |
| scripts/verify-sample.mjs | 158 |
| scripts/verify-scale.mjs | 281 |
| snapback/chat.q | 207 |
| snapback/custom.q | 5 |
| snapback/digest.q | 25 |
| snapback/feed-migration.q | 25 |
| snapback/insights.q | 59 |
| snapback/media.q | 39 |
| snapback/schema.q | 34 |
| snapback/search.q | 9 |
| snapback/server.mts | 30 |
| snapback/settings.q | 32 |
| snapback/social.q | 142 |
| src/chats.tsx | 638 |
| src/client.ts | 38 |
| src/device.ts | 2 |
| src/device.web.ts | 2 |
| src/player.tsx | 12 |
| src/player.web.tsx | 12 |
| src/posts.tsx | 253 |
| src/profile.tsx | 129 |
| src/session.tsx | 70 |
| tsconfig.json | 22 |
| snapback/feed.q | 4 |

Total: 5820 lines in 71 files. Detailed exclusions: line-counts.json.

end=1789673319
