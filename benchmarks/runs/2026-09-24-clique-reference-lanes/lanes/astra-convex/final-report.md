# Clique — final report

Lane: astra-clique-convex-ref-20260924. Model: gpt-6-astra, effort=medium. Backend package: **convex@1.46.0**, exact in package.json and package-lock.json. Anonymous local development only; no hosted project was used.

Run start=1790272700; end=1790281833.577; elapsed=9133.577 seconds. Initial instrument/orientation interval: 1790272700–1790272739 (39 seconds), included in the run clock. The qualitative [essay](essay.md) was written before this numeric tally.

## Milestone clocks and status

| Milestone | Start epoch | End epoch | Wall seconds | First green epoch | Status |
|---|---:|---:|---:|---:|---|
| M1 | 1790272739 | 1790273429 | 690.000 | 1790273429 | green |
| M2 | 1790273429 | 1790273859 | 430.000 | 1790273859 | green |
| M3 | 1790273859 | 1790274119 | 260.000 | 1790274119 | green |
| M4 | 1790274119 | 1790274361 | 242.000 | 1790274361 | green |
| M5 | 1790274361 | 1790275171 | 810.000 | 1790274850.843 | green |
| M6 | 1790275171 | 1790275980 | 809.000 | 1790275864.825 | green |
| M8 | 1790275980 | 1790281833.577 | 5853.577 | 1790276522.543 | green |
| M7 | — | — | — | — | not-run (explicitly excluded) |

Milestone end boundaries are the recorded handoffs; first-green times use the earliest preserved passing segment summary where available, otherwise the first recorded green handoff in run-log.md (a conservative observed-completion timestamp, not a reconstructed receipt). M8 includes later review, correction, verification, and report work after its first green. The separate replay clock overlaps M8: do not add the two elapsed times as though they were sequential. No scope was struck by the environment. No four-hour milestone cap was silently extended.

## Suites and choreography

| Milestone | Suite | Assertion IDs covered | Choreography checks passed / implemented | Required checks |
|---|---|---:|---:|---:|
| M1 | [pass](evidence/m1-suite-1790279586104.json) | 7 | [3/3](evidence/m1-choreography.jsonl) | 3 |
| M2 | [pass](evidence/m2-suite-1790281205363.json) | 22 | [9/9](evidence/m2-choreography.jsonl) | 9 |
| M3 | [pass](evidence/m3-suite-1790280071179.json) | 7 | [7/7](evidence/m3-choreography.jsonl) | 5 |
| M4 | [pass](evidence/m4-suite-1790281229808.json) | 5 | [5/5](evidence/m4-choreography.jsonl) | 5 |
| M5 | [pass](evidence/m5-suite-1790280572188.json) | 6 | [4/4](evidence/m5-choreography.jsonl) | 2 |
| M6 | [pass](evidence/m6-suite-1790281246560.json) | 5 | [1/1](evidence/m6-choreography.jsonl) | 1 |
| M8 | [pass](evidence/m8-suite-1790281252681.json) | 6 | [5/5](evidence/m8-choreography.jsonl) | 5 |

Each suite emits an assertion-ID coverage manifest; the immutable receipt named above contains it. Choreography ran from the copied instrument with CHOREO_BASE_URL=http://127.0.0.1:49600. The frozen harness was not edited. Its fixtures adapter points to this lane, and its expiry wait uses the shortened configuration's real server interval. No implemented choreography check is relabeled as an instrument skip. The final receipts report zero skips. Native-artifact checks absent from the browser harness were not run in a simulator and are not claimed as passed.

Additional evidence: [digest and restart](evidence/digest-proof.json), [durable offline browser restart and search](evidence/offline-restart-proof.json), [older history and people pagination](evidence/history-people-proof.json), [pending offline toggles](evidence/offline-toggles-proof.json), [server video validation](evidence/video-validation-proof.json), [custom-client demo](evidence/custom-client-demo.json), [sample replay conformance](evidence/sample-50-conformance.json), and [resume conformance](evidence/sample-resume-proof.json). Starter segments m1, m2, and m3 are installed through authenticated application writes and were rerun idempotently by the suites.

## Independent scale replay

Start=1790276478.509; end=1790281760.351; wall=5281.842 seconds. Verification=pass. Settled actions=167243. The fresh instance is retained in scale-instance/, API49610 / HTTP49611 / dashboard49612, with REPLAY_MODE=1. Starter segments precede the frozen scale log. Documentary fixture timestamps were not used to backdate records.

- [10pct invariant verification](evidence/scale-10pct-verification.json): pass, 3183 checks.
- [50pct invariant verification](evidence/scale-50pct-verification.json): pass, 3183 checks.
- [final invariant verification](evidence/scale-final-verification.json): pass, 3187 checks.

| Final entity | Verified count |
|---|---:|
| users | 1008 |
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
| memberships | 2053 |
| messages | 100015 |
| textMessages | 99105 |
| mediaMessages | 910 |
| quotedReplies | 2736 |
| activeReactions | 2000 |
| disappearingSettingsEnabled | 0 |

[Additional scale probes](evidence/scale-extra-probes.json): 1008 users' maintained totals recomputed, 12 named media hashes matched. Warm page-50/page-1 history p95 ratio=0.561. Actual replay celebrity/five-follower post acknowledgement p95 ratio=1.598. The headless 100-chat list/history fetch took 639.899ms; RSS growth=-2899968 bytes. Its legacy responseBytes field is serialized JSON string length (UTF-16 code units), not measured network bytes. These timings are diagnostic, with the limitations below.

[Action receipts](evidence/scale-receipts.jsonl) preserve every settled action and the controlled resumes. The original clock includes interruption, adapter correction, token/session renewal, schema/index backfill, and validation time. Four controlled adapter/probe interruptions added resume/token renewal, removed a redundant text-post lookup, added mutation timing, and corrected the celebrity-follower probe to avoid a group it cannot read. Unconfirmed actions were retried with stable idempotency keys; confirmed receipt sequence numbers were not reset. Derived search indexes and obsolete trend timers were maintained during the run without rewriting fixture entities.

The checkpoint probe files contain direct authenticated API samples. They reuse a client and include warm query-cache behavior; they are **not** the hidden grader's browser-render, subscription, or clean-session latency measurements, and do not establish complete O5 conformance. The extra probes, when present, record page-50 history, a full-account headless fetch, actual replay post acknowledgements, maintained totals, and named media hashes. Raw timing and verification data are retained rather than presented as a cross-backend speed result.

## Native artifacts

These are actual Expo iOS Hermes bundle exports, not simulator proofs. M1–M5 have individual iOS exports; M6 and M8 include combined web/iOS output. The final application is artifacts/m8-final, while first-green M8 output remains artifacts/m8.

| Bundle | Bytes | SHA-256 |
|---|---:|---|
| [artifacts/m1-ios/_expo/static/js/ios/entry-5169c7b00c3a75e4f483a015eb51ccb6.hbc](artifacts/m1-ios/_expo/static/js/ios/entry-5169c7b00c3a75e4f483a015eb51ccb6.hbc) | 2849769 | 97c93078fba4bca0198d7905a4c4cd28c53d5c3c4ac783e52516cc112436262e |
| [artifacts/m2-ios/_expo/static/js/ios/entry-3d23c272a5326056a914ab9140572b6f.hbc](artifacts/m2-ios/_expo/static/js/ios/entry-3d23c272a5326056a914ab9140572b6f.hbc) | 2860661 | f84d70994795e144a525732b9654d9f3e96a63d7c67842cc304fe30f3f121f11 |
| [artifacts/m3-ios/_expo/static/js/ios/entry-d05e464c49c0f6e337188502f1b06cb4.hbc](artifacts/m3-ios/_expo/static/js/ios/entry-d05e464c49c0f6e337188502f1b06cb4.hbc) | 2874248 | e3863a2d1eb30af6a5b70bdca851549c835b123bb9ff9f9b2a9a3fbca6ab3660 |
| [artifacts/m4-ios/_expo/static/js/ios/entry-2194af004c7c2cbe0c9aa7723c442f7f.hbc](artifacts/m4-ios/_expo/static/js/ios/entry-2194af004c7c2cbe0c9aa7723c442f7f.hbc) | 2892182 | 3b16bee2d516d1ff159090865f6c0b303bcd3cef6312de766c97da3b321246ae |
| [artifacts/m5-ios/_expo/static/js/ios/entry-3585dfe35561df2fb73e201d9fe3d51e.hbc](artifacts/m5-ios/_expo/static/js/ios/entry-3585dfe35561df2fb73e201d9fe3d51e.hbc) | 2910253 | 0b12979b96b46ee4500808dca82ba5ebeb2c5c243b9c62f9de60fba6f5011b6c |
| [artifacts/m6/_expo/static/js/ios/entry-714702a9cdc03cd310e55d6c5d4cea9f.hbc](artifacts/m6/_expo/static/js/ios/entry-714702a9cdc03cd310e55d6c5d4cea9f.hbc) | 2952429 | 5138ca6ca287c02077cab82a06d91343d3b11b0e751bd471cdae8312f2599577 |
| [artifacts/m8/_expo/static/js/ios/entry-c0c57ba618da4b11321426a97789b2c5.hbc](artifacts/m8/_expo/static/js/ios/entry-c0c57ba618da4b11321426a97789b2c5.hbc) | 2954833 | 52bb75b14d85d2bed50fba5a4cda325f57da54b193c74f1296b133d11c927350 |
| [artifacts/m8-final/_expo/static/js/ios/entry-efd03d3daf2e2e7db4593c8add65e4aa.hbc](artifacts/m8-final/_expo/static/js/ios/entry-efd03d3daf2e2e7db4593c8add65e4aa.hbc) | 2968146 | 05f39cf57f927afa9dadab83db0063452f48abe181c9ad8ad0340993aed8fe31 |

## Corrections and attribution

This table counts recorded correction/retry/error entries, not individual failed assertions or every command. Some entries group related iterations; the complete chronological evidence is [run-log.md](run-log.md). There is no demonstrated Convex product defect claim in this report. The runtime slowdown attribution remains ambiguous: observed application execution and transaction work were small relative to runtime wall time, and shared-host effects were not isolated.

| Epoch | Attribution | Recorded entry |
|---:|---|---|
| 1790272938 | agent-error | 1790272938  ·  error/workaround  ·  source: diagnostic, package source  ·  attribution: agent-error  ·  evidence: .convex/local/default/dashboard.json; CLI started unexpected hardcoded dashboard 6790; stopped PIDs 51598,51610,54807 immediately; remap listener to 49603 via scripts/lane-home.cjs; backend remained 49601/49602 |
| 1790272938 | agent-error | 1790272938  ·  errors  ·  attribution: agent-error  ·  source: diagnostic  ·  evidence: zsh glob rejected route filename; retry quoted; Expo install --fix self-update module miss; verify resolved packages on next invocation |
| 1790273006 | agent-error | 1790273006  ·  retry  ·  source: diagnostic  ·  attribution: agent-error  ·  evidence: scripts/configure-auth.mjs; CLI PEM positional argument needs --; discarded failed key and regenerated; explicit Node 24.18.0 because ambient node was 25.9.0 |
| 1790273111 | agent-error | 1790273111  ·  correction loop  ·  attribution: agent-error  ·  source: diagnostic  ·  evidence: acceptance signup route unmatched; optional catch-all unsupported; explicit index plus catch-all route |
| 1790273217 | agent-error | 1790273217  ·  correction loop  ·  source: diagnostic, package source  ·  attribution: agent-error  ·  evidence: evidence/m1-suite.json duplicate-email-visible; auth Password signup existing same secret accepts; added explicit precheck |
| 1790273284 | agent-error | 1790273284  ·  correction iteration  ·  source: package source, diagnostic  ·  attribution: agent-error  ·  evidence: convex/auth.ts; Password profile callback synchronous; move precheck into authorize wrapper; malformed promise error echoed synthetic test credential, not production data |
| 1790273325 | agent-error | 1790273325  ·  correction iteration  ·  source: package source  ·  attribution: agent-error  ·  evidence: ConvexCredentials.ts options overrides top-level authorize; wrapper moved to provider options |
| 1790273627 | agent-error | 1790273627  ·  correction loop  ·  source: diagnostic  ·  attribution: agent-error  ·  evidence: M2 choreography default fixture path outside copied tree; evidence/adapter.json supplies lane fixtures directory |
| 1790273676 | agent-error | 1790273676  ·  correction loop  ·  source: fixture, diagnostic  ·  attribution: agent-error  ·  evidence: choreography openGlobalFeed only clicks tabs even on profile/thread; added route-level feed tab navigation |
| 1790273716 | environment | 1790273716  ·  retry  ·  attribution: environment  ·  source: diagnostic  ·  evidence: browser still served old profile shell after source edit; restart Metro with clear cache |
| 1790274014 | agent-error | 1790274014  ·  server PID=36064 port=49600; M3 suite correction  ·  source: diagnostic  ·  attribution: agent-error  ·  evidence: quote jump test matched earlier identical fixture message; scope to new unique source |
| 1790274576 | agent-error | 1790274576  ·  correction loop  ·  source: model knowledge, package source  ·  attribution: agent-error  ·  evidence: .cache/search-design.txt; bounded relevance candidates do not establish complete chronological search |
| 1790274650 | not-explicitly-tagged | 1790274650  ·  M5 search correction verified  ·  source: diagnostic  ·  evidence: convex/searchIndex.ts, evidence/m5-suite.json; postings backfilled for 51 existing messages; chronological index replaces bounded relevance sort |
| 1790274742 | agent-error | 1790274742  ·  evidence correction  ·  attribution: agent-error  ·  source: diagnostic  ·  evidence: scripts/acceptance.mjs, scripts/choreo.mjs; make suite receipts and choreography attempts immutable; early retries had overwritten previous JSONL paths, structured miss output retained only in harness transcript |
| 1790274819 | not-explicitly-tagged | 1790274819  ·  M5 final suite rerun after search indexing/pagination correction  ·  source: diagnostic  ·  evidence: evidence/suite-status.json immutable suite receipt |
| 1790275808 | agent-error | 1790275808  ·  M6 scale design correction  ·  source: model knowledge  ·  attribution: agent-error  ·  evidence: convex/feeds.ts; per-author Following merge cost grew with 500 follows; materialize feed projections asynchronously with constant post-ack fanout scheduling |
| 1790276377 | agent-error, initial scale CLI path corrected before process started | 1790276377  ·  M8 implementation and scale preparation  ·  source: fixture, model knowledge  ·  evidence: convex/metrics.ts, convex/digest.ts, scripts/tests-m8.mjs; retry attribution: agent-error, initial scale CLI path corrected before process started |
| 1790276501 | agent-error | 1790276501  ·  M8 suite correction loop  ·  attribution: agent-error  ·  source: diagnostic  ·  evidence: evidence/m8-suite-console.log; wrong sm-feed selector replaced with kit sm-feed-tabs |
| 1790276585 | agent-error | 1790276585  ·  digest proof retry  ·  attribution: agent-error  ·  source: diagnostic  ·  evidence: evidence/digest-proof-console.log; test handle exceeded 20 characters, shortened test identity |
| 1790276720 | agent-error | 1790276720  ·  search completeness correction  ·  attribution: agent-error  ·  source: model knowledge  ·  evidence: convex/ephemeral.ts; multi-prefix queries now scan indexed streams until 21 matching results, not 21 first-prefix candidates; same patch applied before scale checkpoint10% |
| 1790276993 | agent-error | 1790276993  ·  post video trust-boundary correction  ·  attribution: agent-error  ·  source: model knowledge, diagnostic  ·  evidence: convex/media.ts validateVideo and validatedVideo schema; post duration was client-only, now server-certified before mutation; development backend first, scale mirror after active replay so its loaded adapter remains compatible |
| 1790277085 | agent-error | 1790277085  ·  same-name group route correction  ·  attribution: agent-error  ·  source: model knowledge, diagnostic  ·  evidence: components/Chat.tsx, convex/chat.ts; use stable group IDs in navigation, retain authorized name resolver for fixture routes; duplicate keys recheck authorization |
| 1790277376 | agent-error | 1790277376  ·  final regression correction  ·  attribution: agent-error  ·  source: diagnostic, fixture  ·  evidence: evidence/final-m4-choreo.log; async video fetch exposed harness root-video locator race, stable wrapper fixes; cold offline Search now loads durable profile cache and scopes/group results correctly |
| 1790277633 | agent-error | 1790277633  ·  scale adapter efficiency correction; controlled stop PID39948  ·  attribution: agent-error  ·  source: diagnostic  ·  evidence: scripts/replay.mjs; text post mutation already checks key transactionally, removed redundant per-text byKey round trip; media precheck retained; original scale clock continues |
| 1790277805 | agent-error | 1790277805  ·  scale measurement correction; controlled stop PID5026  ·  attribution: agent-error  ·  source: fixture, diagnostic  ·  evidence: scripts/client.mjs records actual post mutation acknowledgement durations; supplemental deep paging, full-account fetch, aggregate/media verification added; original scale clock continues |
| 1790278107 | agent-error | 1790278107  ·  prefix index correction  ·  attribution: agent-error  ·  source: model knowledge, diagnostic  ·  evidence: convex/searchIndex.ts and convex/ephemeral.ts; replace whole-word dictionary expansion with ordered 1/2/3-character prefix indexes; online batched backfill changes only derived index records, not fixture entities |
| 1790278155 | agent-error | 1790278155  ·  prefix backfill retry  ·  attribution: agent-error  ·  source: diagnostic  ·  evidence: scripts/backfill-prefixes.mjs; scale deployment still building new indexes when first internal mutation was requested; wait for deployment completion |
| 1790278384 | agent-error | 1790278384  ·  people-search contract correction  ·  attribution: agent-error  ·  source: fixture  ·  evidence: instrument/social-messenger.md search paragraph; people results now NFC word-prefix, newest-first, cursor-paginated rather than first50 natural-order matches |
| 1790278545 | agent-error | 1790278545  ·  history completeness and durable capacity correction  ·  attribution: agent-error  ·  source: fixture, model knowledge  ·  evidence: components/Chat.tsx adds live older history pages; lib/storage.ts puts large web history snapshots in IndexedDB instead of quota-limited localStorage; native remains AsyncStorage |
| 1790279474 | ambiguous | 1790279474  ·  scheduler design correction  ·  attribution: ambiguous  ·  source: diagnostic, model knowledge  ·  evidence: evidence/scale-post-cost-diagnostic.json; post user execution3–5ms versus runtime310–364ms, only7 docs read6 written, noOCC; replace per-post 24h timers with indexed periodic retirement, retain exact query-time boundary; test effect before attributing cause |
| 1790279679 | agent-error | 1790279679  ·  people pagination integration correction  ·  attribution: agent-error  ·  source: diagnostic  ·  evidence: evidence/final-m3-choreo.log; paginated people API truncated settings member picker, add explicit full-picker mode while preserving paginated search |
| 1790279971 | agent-error | 1790279971  ·  membership navigation race correction  ·  attribution: agent-error  ·  source: diagnostic  ·  evidence: evidence/final-m3-choreo.log and server membership remained admin with no leftAt; immediate navigation cancelled unacknowledged removal; persist membership intents in same ordered queue as following chat sends |
| 1790280065 | agent-error | 1790280065  ·  M3 retry fixture cleanup  ·  attribution: agent-error  ·  source: diagnostic  ·  evidence: evidence/final-m3-choreo.log; earlier failed removal left Dave active/admin in starter group, causing subsequent receipt and picker precondition failures; removed only this failed-test membership through public API before retry |
| 1790280168 | agent-error | 1790280168  ·  attachment preparation race correction  ·  attribution: agent-error  ·  source: diagnostic  ·  evidence: evidence/final-m4-suite.log; submit could run before async video picker metadata resolved; disable composer send during picker preparation for posts and messages |
| 1790280377 | agent-error | 1790280377  ·  probe authorization correction before checkpoint50; controlled stop PID31413  ·  attribution: agent-error  ·  source: fixture  ·  evidence: scripts/verify-scale.mjs; celebrity-follower u0901 is not a g0001 member, so its probe measures feeds/aggregates/search and does not request unauthorized group history; no product permission change; original scale clock continues |
| 1790280519 | agent-error | 1790280519  ·  word boundary correction  ·  attribution: agent-error  ·  source: fixture  ·  evidence: instrument/social-messenger.md specifies punctuation boundaries; removed underscore from token characters in server and offline matcher; all replay fixture message texts verified underscore-free, no fixture index backfill required |
| 1790280988 | agent-error | 1790280988  ·  offline set-state correction  ·  attribution: agent-error  ·  source: model knowledge, fixture  ·  evidence: components/Social.tsx and components/Chat.tsx; derive pending like/repost/reaction state from durable intents, so repeated offline taps toggle against pending state; show current chat expiry setting |
| 1790281184 | agent-error | 1790281184  ·  offline toggle proof selector retry  ·  attribution: agent-error  ·  source: fixture, diagnostic  ·  evidence: evidence/offline-toggles-console.log; FeedCard exposes aria-pressed, corrected the proof from aria-selected |
| 1790281791.359 | not-explicitly-tagged | 1790281791.359  ·  M8 final green; scale final verification and extra probes pass  ·  source: diagnostic  ·  evidence: evidence/scale-result.json (start=1790276478.509 end=1790281760.351), evidence/scale-final-verification.json (3187 checks), evidence/scale-extra-probes.json (1008 maintained totals, 12 media hashes); original replay clock retained across all corrections |

## Token and protocol evidence

Token accounting uses the explicit unavailable posture: input/output/cache/reasoning totals, milestone phases, token caps, and token charges are null. The native per-turn usage stream was not exposed inside the authorized lane. No estimate is substituted. [token-accounting.json](evidence/token-accounting.json) records the stable reason. A driver-stamped immutable first-product-edit receipt was also unavailable; this report and its inventory are narrative/diagnostic evidence, not a claimed canonical efficiency or metering attestation.

## Resolved package pins

Package-lock SHA-256: 244f0c0a113250a73100ca5afdd46205ad5ff169624e5dcec83983175839ff57. Full transitive closure is in package-lock.json; installed top-level resolutions follow. The Convex SDK/CLI package remains exactly 1.46.0. Its local backend binary is the CLI-selected precompiled-2026-09-21-0cf49cb build.

| Package | Resolved version |
|---|---|
| @auth/core | 0.41.3 |
| @convex-dev/auth | 0.0.95 |
| @expo/metro-runtime | 57.0.16 |
| @react-native-async-storage/async-storage | 2.2.0 |
| @types/react | 19.3.0 |
| convex | 1.46.0 |
| expo | 57.0.25 |
| expo-constants | 57.0.19 |
| expo-file-system | 57.0.7 |
| expo-image-picker | 57.0.20 |
| expo-linking | 57.0.11 |
| expo-router | 57.0.23 |
| expo-status-bar | 57.0.1 |
| expo-video | 57.0.5 |
| react | 19.2.3 |
| react-dom | 19.2.3 |
| react-native | 0.86.3 |
| react-native-safe-area-context | 5.7.0 |
| react-native-screens | 4.26.2 |
| react-native-web | 0.21.2 |
| typescript | 6.0.3 |

## Hand-authored file inventory

Physical and nonblank line counts below cover authored app/server/test/tooling files and narrative documents. Copied UI kit, choreography, fixture/schema/config packs, generated Convex bindings, dependencies, lockfiles, build outputs, backend state, and generated evidence are excluded. Formatting-expanded source is counted as delivered. This generated report is excluded from its own inventory.

| File | Physical lines | Nonblank lines |
|---|---:|---:|
| [API.md](API.md) | 39 | 27 |
| [README.md](README.md) | 37 | 23 |
| [app.json](app.json) | 21 | 21 |
| [app/[...route].tsx](app/[...route].tsx) | 308 | 308 |
| [app/_layout.tsx](app/_layout.tsx) | 23 | 23 |
| [app/index.tsx](app/index.tsx) | 1 | 1 |
| [components/Chat.tsx](components/Chat.tsx) | 686 | 686 |
| [components/Insights.tsx](components/Insights.tsx) | 28 | 28 |
| [components/Player.tsx](components/Player.tsx) | 27 | 27 |
| [components/RevocationSync.tsx](components/RevocationSync.tsx) | 34 | 34 |
| [components/Search.tsx](components/Search.tsx) | 137 | 136 |
| [components/Social.tsx](components/Social.tsx) | 281 | 280 |
| [convex/auth.config.ts](convex/auth.config.ts) | 3 | 3 |
| [convex/auth.ts](convex/auth.ts) | 28 | 28 |
| [convex/authChecks.ts](convex/authChecks.ts) | 10 | 10 |
| [convex/chat.ts](convex/chat.ts) | 464 | 464 |
| [convex/crons.ts](convex/crons.ts) | 11 | 11 |
| [convex/digest.ts](convex/digest.ts) | 108 | 108 |
| [convex/ephemeral.ts](convex/ephemeral.ts) | 237 | 237 |
| [convex/feeds.ts](convex/feeds.ts) | 81 | 81 |
| [convex/http.ts](convex/http.ts) | 7 | 7 |
| [convex/maintenance.ts](convex/maintenance.ts) | 25 | 25 |
| [convex/media.ts](convex/media.ts) | 293 | 291 |
| [convex/metrics.ts](convex/metrics.ts) | 173 | 171 |
| [convex/profiles.ts](convex/profiles.ts) | 115 | 115 |
| [convex/push.ts](convex/push.ts) | 91 | 91 |
| [convex/ranking.ts](convex/ranking.ts) | 4 | 4 |
| [convex/replay.ts](convex/replay.ts) | 10 | 10 |
| [convex/schema.ts](convex/schema.ts) | 174 | 174 |
| [convex/searchIndex.ts](convex/searchIndex.ts) | 58 | 57 |
| [convex/social.ts](convex/social.ts) | 338 | 338 |
| [diary.md](diary.md) | 49 | 30 |
| [essay.md](essay.md) | 29 | 15 |
| [lib/cache.ts](lib/cache.ts) | 45 | 45 |
| [lib/mediaCache.ts](lib/mediaCache.ts) | 54 | 54 |
| [lib/offline.tsx](lib/offline.tsx) | 100 | 100 |
| [lib/storage.ts](lib/storage.ts) | 78 | 78 |
| [package.json](package.json) | 36 | 36 |
| [public/sw.js](public/sw.js) | 44 | 44 |
| [run-log.md](run-log.md) | 108 | 107 |
| [scripts/acceptance.mjs](scripts/acceptance.mjs) | 155 | 155 |
| [scripts/backfill-prefixes.mjs](scripts/backfill-prefixes.mjs) | 23 | 23 |
| [scripts/choreo.mjs](scripts/choreo.mjs) | 84 | 84 |
| [scripts/client.mjs](scripts/client.mjs) | 46 | 46 |
| [scripts/configure-auth.mjs](scripts/configure-auth.mjs) | 26 | 26 |
| [scripts/custom-client-demo.mjs](scripts/custom-client-demo.mjs) | 70 | 70 |
| [scripts/digest-proof.mjs](scripts/digest-proof.mjs) | 142 | 142 |
| [scripts/final-regression.mjs](scripts/final-regression.mjs) | 19 | 19 |
| [scripts/final-report.mjs](scripts/final-report.mjs) | 206 | 206 |
| [scripts/history-people-proof.mjs](scripts/history-people-proof.mjs) | 94 | 94 |
| [scripts/lane-home.cjs](scripts/lane-home.cjs) | 16 | 16 |
| [scripts/log.mjs](scripts/log.mjs) | 5 | 5 |
| [scripts/offline-restart-proof.mjs](scripts/offline-restart-proof.mjs) | 105 | 105 |
| [scripts/offline-toggles-proof.mjs](scripts/offline-toggles-proof.mjs) | 3 | 3 |
| [scripts/replay.mjs](scripts/replay.mjs) | 302 | 302 |
| [scripts/retire-trend-timers.mjs](scripts/retire-trend-timers.mjs) | 31 | 31 |
| [scripts/run-scale.mjs](scripts/run-scale.mjs) | 49 | 49 |
| [scripts/scale-extra-probes.mjs](scripts/scale-extra-probes.mjs) | 204 | 204 |
| [scripts/seed.mjs](scripts/seed.mjs) | 106 | 106 |
| [scripts/serve-web.mjs](scripts/serve-web.mjs) | 37 | 37 |
| [scripts/tests-m2.mjs](scripts/tests-m2.mjs) | 168 | 168 |
| [scripts/tests-m3.mjs](scripts/tests-m3.mjs) | 114 | 114 |
| [scripts/tests-m4.mjs](scripts/tests-m4.mjs) | 77 | 77 |
| [scripts/tests-m5.mjs](scripts/tests-m5.mjs) | 96 | 95 |
| [scripts/tests-m6.mjs](scripts/tests-m6.mjs) | 96 | 96 |
| [scripts/tests-m8.mjs](scripts/tests-m8.mjs) | 118 | 118 |
| [scripts/verify-sample.mjs](scripts/verify-sample.mjs) | 134 | 134 |
| [scripts/verify-scale.mjs](scripts/verify-scale.mjs) | 290 | 290 |
| [scripts/video-validation-proof.mjs](scripts/video-validation-proof.mjs) | 56 | 56 |
| [tsconfig.json](tsconfig.json) | 1 | 1 |

Totals: 7268 physical / 7200 nonblank lines across 70 authored files. File hashes, package pins, bundle hashes, and raw milestone data are also in [final-inventory.json](evidence/final-inventory.json).

## Candid limits and deviations

- No iOS simulator behavior is claimed. Native export success and the browser restart proof are different evidence. Real APNs/FCM delivery and M7 were outside this run's requested execution.
- The older-than-24-hour Trending suite assertion uses the same production time predicate with an old synthetic timestamp; this run did not wait 24 hours or backdate live product records to create an integration fixture.
- Independent scale invariant verification and named media/counter checks are not the hidden grader's random spot sample or complete performance audit. See the diagnostic caveat above.
- People search uses a server-side profile scan before slicing a cursor page; the supplied envelope is supported, but this is not a claim of unbounded account-directory scale. Extremely broad multi-term searches remain subject to Convex's per-query work limits.
- An early anonymous CLI invocation unexpectedly opened its hardcoded dashboard on port6790. It was immediately stopped and recorded. All subsequent listeners were remapped into 49600–49619. This was a setup deviation, not concealed as compliant behavior.
- Early retries overwrote some original attempt files before immutable receipts were introduced. Preserved first-green summaries remain, but every early failure is not reconstructible from JSONL alone. M2's old suite linkage was repaired with a complete final suite/choreography rerun; final immutable receipts are retained.
- The local development deployment contains test-created content in addition to starter data. The separate scale instance is the one checked against exact fixture counts. Neither is a shared hosted project.

Server shutdown evidence is in run-log.md. Only explicitly recorded owned PIDs were terminated. To restart and inspect the app, follow [README.md](README.md); third-party access is documented in [API.md](API.md).

end=1790281833.577
