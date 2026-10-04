Clique · astra-clique-convex-20260916

Built independently with gpt-6-astra, effort=medium, Convex exactly 1.45.0. M1 → M2 → M3 → M4 → M5 → M6 → M8 are green against their suites and configured required choreography. M7 is not-run by instruction. The default M3 four-recipient receipt check is retained as an instrument skip; the unchanged harness passes with its permitted three-person fixture adapter. Native simulator proofs are unavailable, not passed.

start=1789553270

The following are raw milestone boundary epochs. First-green values come from the original harness receipts; boundary end can be later because export/narrative work completed before starting the next milestone. Historical M1–M4 suite bytes were overwritten before immutable naming was introduced, so their original hash linkage cannot now be revalidated. The latest replacement proofs below are fully hash-linked.

| Milestone | Status | Start epoch | End epoch | Boundary wall seconds | Harness first-green epoch |
|---|---|---:|---:|---:|---:|
| M1 | green | 1789553270 | 1789554042 | 772 | 1789553944.278 |
| M2 | green | 1789554042 | 1789554898 | 856 | 1789554783.598 |
| M3 | green | 1789554898 | 1789555348 | 450 | 1789555259.094 |
| M4 | green | 1789555348 | 1789555675 | 327 | 1789555571.203 |
| M5 | green | 1789555675 | 1789556762 | 1087 | 1789556553.57 |
| M6 | green | 1789556762 | 1789557375 | 613 | 1789557240.861 |
| M8 | green | 1789557500 | 1789558220 | 720 | 1789557827.82 |
| M7 | not-run | — | — | — | — |

Total lane wall: 9376 seconds, ending 1789562646. M8 authoring overlapped the isolated scale replay; these intervals must not be added as disjoint wall time. Post-green work includes regression, browser-store hardening, same-name group routing, the Expo compatibility patch, formatting, and replay recovery. Total wall includes that work. Fine-grained authoring/diagnosis splits and token counts are null rather than estimated.

Latest suite and choreography evidence:

| Milestone | Suite | Choreography | Required assertions | Receipt |
|---|---|---|---:|---|
| M1 | pass | pass | 3 | [suite](artifacts/suite-m1-1789558269255.json), [JSONL](artifacts/choreo-m1.jsonl) |
| M2 | pass | pass | 9 | [suite](artifacts/suite-m2-1789558285654.json), [JSONL](artifacts/choreo-m2.jsonl) |
| M3 | pass | pass | 5 | [suite](artifacts/suite-m3-1789562322179.json), [JSONL](artifacts/choreo-m3.jsonl) |
| M4 | pass | pass | 5 | [suite](artifacts/suite-m4-1789558473805.json), [JSONL](artifacts/choreo-m4.jsonl) |
| M5 | pass | pass | 2 | [suite](artifacts/suite-m5-1789559397893.json), [JSONL](artifacts/choreo-m5.jsonl) |
| M6 | pass | pass | 1 | [suite](artifacts/suite-m6-1789562505496.json), [JSONL](artifacts/choreo-m6.jsonl) |
| M8 | pass | pass | 5 | [suite](artifacts/suite-m8-1789562519488.json), [JSONL](artifacts/choreo-m8.jsonl) |

[Coverage manifest](artifacts/coverage-manifest.json) maps every suite-required assertion in the continuous-session scope. [Full regression](artifacts/final-regression.json), [TypeScript check](artifacts/typecheck-release.log), and [Expo dependency check](artifacts/expo-dependency-check-final.log) are retained. The >24h Trending exclusion is a unit boundary test of the shared server ranking function, not a backdated database fixture or a day-long live test.

Scale replay: original start=1789557432; final end=1789560990; raw wall=3558s; checkpoint verification/probe time excluded=215.417s; charged replay interval=3342.583s; cap=14400s. Settled actions=167157/167157. Final manifest verification=pass. The replay used a fresh instance with exactly the starter segments, real signup, serial settle receipts, server-arrival ordering, and push/digest emission disabled.

The first 50% global-search probe timed out. Its failed clock and log are retained; an authorization-first index plan repaired the query. Resume reconstructed only acknowledged ID mappings from the receipt prefix and did not resubmit acknowledged actions. Original start and cap were retained. No O5 score is self-awarded. [Clock](artifacts/scale-clock.json), [failed attempt](artifacts/scale-clock-attempt-1.json), [settle receipts](artifacts/scale-settled.jsonl), [final invariant verification](artifacts/scale-verification-100.json).

M8 and repaired-query-plan M6 diagnostics ran sequentially on exact verified checkpoint clones, after the authoritative replay stopped. Results are in `artifacts/final-scale-probes-{10,50,100}.json` and `artifacts/m8-scale-probes-{10,50,100}.json`; clone verification files prove the workloads. These are published diagnostics, not hidden rotated grader probes or cross-backend speed rankings. The later optional refresh nonce and browser inbox batch limit were added after these measurements; the measured query plans and default 100-row inbox path remain unchanged.

Published diagnostic gates (all samples retained; no favorable-run selection):

| Gate | Result | Measured ratio or middle / bound |
|---|---|---:|
| history-page-50/page-1 | pass | 0.728 / 3 |
| following-500/following-5 | pass | 1.388 / 3 |
| celebrity-write/comparison-write | pass | 1.204 / 3 |
| celebrity-follower/comparison-feed | pass | 0.812 / 3 |
| global-search-full/10% | pass | 0.893 / 3 |
| global-search-middle-below-growth-line | pass | 1.847ms / 1.986ms |
| insights-full/10% | pass | 0.929 / 3 |
| insights-middle-below-growth-line | pass | 1.227ms / 1.423ms |
| trending-full/10% | pass | 0.825 / 3 |
| trending-middle-below-growth-line | pass | 1.387ms / 1.508ms |

Strict diagnostic gate failures remain failures even when invariant verification and milestone functional suites pass. These are not hidden grader results. See [raw diagnostic gates](artifacts/diagnostic-gates.json).

Full-scale browser sync (additional functional proof, separate from isolated API timings): pass; 100 conversations, 10000 durable messages, 16018ms after login. [Browser proof](artifacts/scale-browser-proof.json). This is browser execution, not native execution.

[Final-schema invariant recheck](artifacts/release-scale-verification-100.json) confirms that M8 backfill, browser receipts and the final bounded inbox API preserve the original replay content. [Inbox limit proof](artifacts/inbox-limit-proof.json) checks the 1000-row bound and rejects an oversized request.

Every milestone produced an iOS Hermes `.hbc` export, with hashes in [native build manifest](artifacts/native-build-manifest.json). `xcrun simctl list devices` was attempted for M6 and M8 and was unavailable on Linux: [M6 attempt](artifacts/native-m6.json), [M8 attempt](artifacts/native-m8.json). [Persistent Chromium restart proof](artifacts/browser-media-restart.json) covers cached ordinary media, view-once exclusion, search, two durable pending messages, ordered flush, and read receipts; it is explicitly browser-only. [Digest proof](artifacts/digest-proof.json) covers scheduled closed-client emission, exact counts, authorization, quiet-period suppression, and a real backend restart.

[Refresh freshness proof](artifacts/refresh-proof.json) confirms a new server-time evaluation without changing totals. The final M8 suite and choreography passed after this correction and the Metro crawler exclusions; its Hermes export was regenerated.

Correction loops and attribution (the original raw evidence remains in run-log.md):

- 1. agent-error: error attribution=agent-error correction-loop=1 evidence=.convex/local/default/dashboard.json; anonymous watch CLI automatically bound dashboard 6790 despite cloud/site flags. Stopped PID 2718082 immediately after discovering. Workaround use explicit backend process and --once deployments; no dashboard.
- 2. agent-error: correction-loop=2 attribution=agent-error evidence=artifacts/acceptance-m1.log,artifacts/m1-route.png; Expo Router does not resolve optional catchall root as authored; use index and catchall routes.
- 3. agent-error: correction-loop=3 attribution=agent-error evidence=artifacts/acceptance-m1-retry.log,node_modules/@convex-dev/auth/src/providers/Password.ts; built-in signUp accepts existing valid credentials; added explicit duplicate-email preflight while retaining transactional callback uniqueness.
- 4. agent-error: correction-loop=4 attribution=agent-error evidence=artifacts/acceptance-m1-final.log; editor rendered before initial profile state settled causing fill race; gate editor until hydration. Loop 3 second iteration provider options overwrite outer authorize; wrapped options.authorize.
- 5. environment: correction-loop=5 attribution=environment evidence=artifacts/choreo-m2.log,node_modules/react-native-web/dist/modules/createDOMProps/index.js; RN Web drops kit grouped accessibilityValue/accessibilityState props. Added generic web-only ARIA compatibility module through Metro, leaving frozen kit untouched.
- 6. agent-error: correction-loop=6 attribution=agent-error evidence=choreography/choreography.mjs toggleFollow and waitForFeedProjection; expose feed navigation tabs on secondary surfaces so follow-to-feed choreography can navigate.
- 7. agent-error: correction-loop=7 attribution=agent-error evidence=artifacts/choreo-m3-default.log; member removal lost when full navigation closes WebSocket before ack; use authenticated keepalive HTTP mutation for navigation-sensitive membership actions.
- 8. environment: correction-loop=8 attribution=environment evidence=artifacts/choreo-m5.log,ui/src/ChatSettingsForm.tsx,src/NativeCompat.tsx; RN Web Image places src on nested img while frozen observableState inspects root. Generic image compatibility exposes source as data-state without changing frozen kit. First-pass JSX settings-save brace corrected before completion claim.
- 9. agent-error: correction-loop=9 attribution=agent-error evidence=scripts/acceptance.mjs,scripts/choreo.mjs; mutable suite receipt path could invalidate an in-flight choreography linkage. Future suites get immutable timestamped receipts and each choreography snapshots suite-status; M5 will rerun against final immutable linkage.
- 10. agent-error: correction-loop=10 attribution=agent-error push test assumed original displayName after profile-edit choreography; compare current profile. evidence=artifacts/acceptance-m6.log,convex/push.ts
- 11. agent-error: correction-loop=11 attribution=agent-error kit pending receipt requires receiptPending prop; push suite overlapped connected Bob choreography; sequential rerun. evidence=artifacts/choreo-m6-1789557083056.jsonl,artifacts/acceptance-m6-final.log
- 12. agent-error: correction-loop=12 attribution=agent-error shortened digest interval needed UTC cron alignment; corrected to */2 UTC minute schedule. source=package source evidence=convex/crons.ts,artifacts/deploy-m8-anchor.log
- 13. agent-error: correction-loop=13 attribution=agent-error scale global search scanned unrelated conversations before permission filtering; use per-authorized-conversation posting indexes. Failed at 50% with system-operation timeout; cold repaired query returns 20 rows in 238ms. Fresh instance and prefix retained. evidence=artifacts/scale-clock-attempt-1.json,artifacts/scale-search-recovery.json,convex/search.ts
- 14. agent-error: correction-loop=14 attribution=agent-error source=package source: ConvexReactClient.query returns existing localQueryResult (node_modules/convex/src/react/client.ts:683), so refresh without writes can reuse old server-time result. Added ignored optional cache-key nonce for Insights/Trending, fresh on mount and refresh; business time remains server Date.now. evidence=src/Refresh.ts,convex/insights.ts
- 15. agent-error: correction-loop=15 attribution=agent-error: running Expo became unresponsive during large local DB backfills; two Metro processes used 2GB/1GB and sustained CPU while watching lane state. Added crawler exclusions for artifacts, backend/probe state, copied harness and caches. Stopped recorded Expo PIDs2758631,2969408 for restart; failed release retry retained. evidence=artifacts/refresh-m8-suite.log,metro.config.js
- 16. agent-error: correction-loop=16 attribution=agent-error source=diagnostic/package source: first scale browser attempt connected to main55201 despite scale wrapper env; WebSocket trace proves wrong bundled endpoint, InvalidAccountId. Isolated Metro cacheVersion by backend URL and disabled dotenv in scale wrapper (published @expo/env EXPO_NO_DOTENV). Stopped recorded scale-web PID2984191. evidence=artifacts/scale-browser-proof-attempt-1.json,artifacts/scale-browser-diagnostic.json,metro.config.js
- 17. agent-error: correction-loop=17 attribution=agent-error: full browser initial sync under concurrent primary backfill reached1800/10000 in30s despite headlessAPI15.8s. Added optional global inbox limit<=1000 for device bootstrap, preserved default100/chat public API, and skipped no-op receipt writes to avoid subscription invalidation. Persist-before-ACK unchanged. evidence=artifacts/scale-browser-proof-attempt-2.json,convex/chats.ts,src/Chats.tsx
- Additional recorded correction: 1789557423 scale-preflight retry attribution=agent-error PEM value starts with dashes; CLI requires -- delimiter. source=package source evidence=scripts/scale-setup.mjs,artifacts/scale-setup-retry.log
- Additional recorded correction: 1789558491 post-green durability hardening attribution=agent-error source=model knowledge browser localStorage quota is inappropriate for scale message cache; switched message persistence to IndexedDB and delivery ACK waits for transaction commit. evidence=src/durable.ts,src/store.ts,src/Chats.tsx
- Additional recorded correction: 1789558972 final compatibility correction attribution=agent-error Expo checker required react-native 0.83.10; installed exact expected patch, Convex remains 1.45.0. evidence=artifacts/expo-dependency-check.log,artifacts/expo-dependency-check-final.log
- Additional recorded correction: 1789559551 post-green review fix attribution=agent-error same-named groups had unique records but ambiguous name-only routes; deep links and cache keys now retain stable conversation keys. evidence=src/Chats.tsx,scripts/tests-m3.mjs
- Additional recorded correction: 1789560364 post-green diary timestamp annotation attribution=agent-error: early headings were drafting points; authoritative terminal boundaries remain artifacts/milestones.json. evidence=diary.md

No confirmed Convex defect is claimed. The operation-budget timeout was an application query-plan error. The missing simulator and optional Linux DevTools failure are environment limitations.

Resolved direct package pins and backend binary:

| Package | Resolved version |
|---|---|
| @auth/core | 0.41.1 |
| @convex-dev/auth | 0.0.95 |
| @playwright/test | 1.58.2 |
| @react-native-async-storage/async-storage | 2.2.0 |
| @types/react | 19.2.18 |
| babel-preset-expo | 55.0.25 |
| convex | 1.45.0 |
| expo | 55.0.31 |
| expo-asset | 55.0.20 |
| expo-file-system | 55.0.26 |
| expo-image-picker | 55.0.24 |
| expo-router | 55.0.18 |
| expo-secure-store | 55.0.18 |
| expo-video | 55.0.21 |
| react | 19.2.0 |
| react-dom | 19.2.0 |
| react-native | 0.83.10 |
| react-native-safe-area-context | 5.6.2 |
| react-native-screens | 4.23.0 |
| react-native-web | 0.21.2 |
| typescript | 5.9.3 |
| convex-local-backend | precompiled-2026-09-11-157eb19 |

Node actually used: v24.13.1; Linux x64; CPU: AMD EPYC 9454 48-Core Processor. This differs from the environment overlay's Node 24.18.0 claim and is recorded rather than hidden. Choreography uses its own lockfile (Playwright 1.62.1); the app acceptance runner uses Playwright 1.58.2. Initial CLI setup accidentally bound its dashboard to 6790; that recorded process was stopped. Earlier npm installs used the default global tool cache; later cache use is lane-local. App code, backend state, proof artifacts, and all authored work are in this lane. No sibling lane or alternative implementation was inspected.

Hand-authored source/test/config lines: 7287 across 98 files. Physical lines include comments and blanks. Copied kit/harness/fixture files, generated bindings, dependencies, state, and build output are excluded; the authored JSON-schema shim is included. Narrative documents are separate.

| File | Lines |
|---|---:|
| .gitignore | 18 |
| .npmrc | 1 |
| app.json | 1 |
| app/[...path].tsx | 1 |
| app/_layout.tsx | 16 |
| app/index.tsx | 1 |
| babel.config.js | 24 |
| convex/accounts.ts | 10 |
| convex/audit.ts | 25 |
| convex/auth.config.ts | 3 |
| convex/auth.ts | 77 |
| convex/chatConfig.ts | 79 |
| convex/chats.ts | 600 |
| convex/crons.ts | 9 |
| convex/digest.ts | 121 |
| convex/http.ts | 39 |
| convex/insights.ts | 95 |
| convex/lib.ts | 13 |
| convex/media.ts | 89 |
| convex/messageActions.ts | 146 |
| convex/metrics.ts | 46 |
| convex/profiles.ts | 131 |
| convex/push.ts | 65 |
| convex/schema.ts | 178 |
| convex/search.ts | 126 |
| convex/searchIndex.ts | 39 |
| convex/social.ts | 304 |
| convex/trendingRules.ts | 9 |
| convex/windows.ts | 4 |
| harness/lib/json-schema.mjs | 4 |
| metro.config.js | 22 |
| package.json | 1 |
| scripts/acceptance.mjs | 161 |
| scripts/auth-keys.mjs | 8 |
| scripts/backend.mjs | 29 |
| scripts/backfill-m8.mjs | 15 |
| scripts/bootstrap.mjs | 47 |
| scripts/boundary.mjs | 18 |
| scripts/browser-media-restart.mjs | 2 |
| scripts/checkpoint-snapshots.mjs | 36 |
| scripts/choreo-fixture.mjs | 26 |
| scripts/choreo.mjs | 48 |
| scripts/cleanup.mjs | 3 |
| scripts/client.mjs | 38 |
| scripts/configure-auth.mjs | 23 |
| scripts/custom-client-demo.mjs | 79 |
| scripts/deploy-target.mjs | 1 |
| scripts/deploy.mjs | 17 |
| scripts/digest-proof.mjs | 133 |
| scripts/env.mjs | 16 |
| scripts/final-regression.mjs | 43 |
| scripts/final-report.mjs | 24 |
| scripts/host-sample.mjs | 12 |
| scripts/local-home.cjs | 2 |
| scripts/m8-scale-probes.mjs | 162 |
| scripts/main-web.mjs | 1 |
| scripts/native-attempt.mjs | 34 |
| scripts/port-guard.cjs | 37 |
| scripts/post-scale.mjs | 3 |
| scripts/refresh-proof.mjs | 16 |
| scripts/replay-adapter.mjs | 207 |
| scripts/run-function.mjs | 16 |
| scripts/scale-backend.mjs | 28 |
| scripts/scale-browser-diagnostic.mjs | 1 |
| scripts/scale-browser-proof.mjs | 1 |
| scripts/scale-probes.mjs | 80 |
| scripts/scale-run.mjs | 88 |
| scripts/scale-setup.mjs | 68 |
| scripts/scale-web.mjs | 1 |
| scripts/seed.mjs | 115 |
| scripts/setup-identity.mjs | 47 |
| scripts/summarize-probes.mjs | 1 |
| scripts/tests-m2.mjs | 194 |
| scripts/tests-m3.mjs | 112 |
| scripts/tests-m4.mjs | 107 |
| scripts/tests-m5.mjs | 95 |
| scripts/tests-m6.mjs | 114 |
| scripts/tests-m8.mjs | 150 |
| scripts/verify-release-scale.mjs | 1 |
| scripts/verify-scale.mjs | 250 |
| scripts/web-offline-proof.mjs | 62 |
| src/App.tsx | 357 |
| src/CacheSync.tsx | 25 |
| src/Chats.tsx | 639 |
| src/Feed.tsx | 344 |
| src/Insights.tsx | 42 |
| src/Media.tsx | 25 |
| src/Message.tsx | 186 |
| src/NativeCompat.tsx | 47 |
| src/Offline.tsx | 124 |
| src/Refresh.ts | 8 |
| src/Search.tsx | 136 |
| src/Upload.tsx | 75 |
| src/durable.ts | 47 |
| src/mediaCache.ts | 39 |
| src/store.ts | 90 |
| src/transport.ts | 33 |
| tsconfig.json | 1 |

Candid gaps and limits:

- Native simulator execution remains unavailable; Hermes and browser proofs cannot establish iOS runtime behavior.
- M7 and independent hidden grading are intentionally not performed. The base protocol JSON validates; a completed composed grading record needs the external grading and metering custody data.
- The original M3 default-fixture failure is an exact instrument skip, not silently passed. The configured three-member run is separate evidence.
- Early suite receipt overwrites prevent rechecking the original M1–M4 hash linkage; final immutable replacement receipts validate.
- The first scale search timeout remains part of the record even though the repaired replay completes. Additional browser attempts failed first on a wrong endpoint, then at 1800 and 8000 messages within 30 seconds. The repaired browser bootstrap persists all 10000 messages in 16.0 seconds; those failed attempts remain under artifacts/scale-browser-proof-attempt-*.json. Diagnostic latency does not establish cross-backend superiority.
- New attachment uploads require connectivity. Durable queued writes cover text, already-uploaded attachments, likes, and reactions. Permanently rejected intents remain visible with an error.
- Presence uses leases; notification emission can lag disconnection by a short grace period. Push is a logged provider seam, as specified, not APNs/FCM delivery.
- Search expands the prefix vocabulary; unusually broad prefixes can cost more than the published diagnostic tokens.
- No harness-native token totals or precise compaction-event stream were exposed in the authorized workspace; those values remain null.

The qualitative [essay](essay.md) was written before the final tally; [builder scores](builder-scores.json) record subjective dimensions and holistic judgment without a weighted overall. [README](README.md) documents startup, seeds, proofs, and API access. Server cleanup is recorded in [process cleanup](artifacts/process-cleanup.json).

end=1789562646
