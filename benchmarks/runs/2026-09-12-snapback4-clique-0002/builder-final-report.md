# Clique — astra-clique-snapback4

M1 → M2 → M3 → M4 → M5 → M6 → M8 reached the environment's authoring green bar. M7 was not run. This is not a production-readiness or hidden-grader claim: **universal server refusal of expired messages is not achieved**.

Model: gpt-6-astra; effort=medium; backend=snapback4-0.0.2. Cold independent build, no agents, no other implementation or source checkout inspected. The package's published declarations were inspected for the client contract; implementation source was not read.

## Clocks

start=1789222278

| Milestone | Status | Start epoch | Recorded boundary end | Boundary wall seconds | First-green epoch |
|---|---|---:|---:|---:|---:|
| M1 | green | 1789222278 | 1789223151.296 | 873.296 | 1789223151.296 |
| M2 | green | 1789223171 | 1789223694.937 | 523.937 | 1789223694.937 |
| M3 | green | 1789223718 | 1789225200.019 | 1482.019 | 1789225200.019 |
| M4 | green | 1789225305 | 1789225879.636 | 574.636 | 1789225879.636 |
| M5 | green | 1789225956 | 1789227308 | 1352.000 | 1789227275.745 |
| M6 | green | 1789227308 | 1789228291 | 983.000 | 1789227757.252 |
| M7 | not-run | — | — | — | — |
| M8 | green | 1789228291 | 1789229406 | 1115.000 | 1789228948.868 |

First-green times come from passing, suite-linked choreography summaries. Boundary walls include subsequent verification/artifact work and bookkeeping; they are not substituted for the receipt timestamps. M4 uses the explicitly corrected start. Last passing acceptance receipt: 1789229266.306; continuous elapsed to that receipt: 6988.306 seconds. Phase-exclusive efficiency and token totals are not estimated. Replay overlapped M6 authoring/verification and has separate clocks below. Raw records: [milestone-record.json](milestone-record.json), [run-log.md](run-log.md).

## Acceptance and choreography

| Milestone | Suite | Choreography | Evidence |
|---|---:|---:|---|
| M1 | 6 passed | 3 passed / 0 skipped | [suite](evidence/m1-suite.json), [choreography](evidence/m1-choreo.jsonl) |
| M2 | 11 passed | 7 passed / 2 skipped | [suite](evidence/m2-suite.json), [choreography](evidence/m2-choreo.jsonl) |
| M3 | 6 passed | 6 passed / 1 skipped | [suite](evidence/m3-suite.json), [choreography](evidence/m3-choreo.jsonl) |
| M4 | 4 passed | 3 passed / 2 skipped | [suite](evidence/m4-suite.json), [choreography](evidence/m4-choreo.jsonl) |
| M5 | 4 passed | 3 passed / 1 skipped | [suite](evidence/m5-suite.json), [choreography](evidence/m5-choreo.jsonl) |
| M6 | 3 passed | 1 passed / 0 skipped | [suite](evidence/m6-suite.json), [choreography](evidence/m6-choreo.jsonl) |
| M8 | 3 passed | 5 passed / 0 skipped | [suite](evidence/m8-suite.json), [choreography](evidence/m8-choreo.jsonl) |

M2 also passed a post-M8 regression suite and choreography after the analytics mutations changed. The [coverage manifest](coverage-manifest.json) maps every suite-required assertion to a test or an explicit environment strike. Failed attempts remain in evidence; no failed receipt was rewritten as green.

Struck assertion IDs: m1-a10, m1-a11, m2-a02, m2-a03, m4-a01, m4-a02, m4-a03, m4-a04, m4-a12, m5-a04, m5-a05, m5-a06, m6-a02, m6-a04, m6-a09, m8-a08, m8-a09, m8-a10, m8-a11, m8-a12. M5-a07 is partial: background struck, color tested. Non-media native proof was not required; it is recorded separately from the implemented browser behavior. M3's optional absent DM-avatar node remains the instrument's own skip. Copied-harness path/dependency repairs, media skips and the M4 text prerequisite are disclosed in [instrument-repairs.md](evidence/instrument-repairs.md); the original instrument was not edited.

## Native and offline artifacts

- M1: [Hermes bundle](artifacts/m1-ios/_expo/static/js/ios/entry-1ed73f443caa71dbb8ee98d6230fe985.hbc)
- M2: [Hermes bundle](artifacts/m2-ios/_expo/static/js/ios/entry-46f2a439a7cc5515e7905b78321ba044.hbc)
- M3: [Hermes bundle](artifacts/m3-ios/_expo/static/js/ios/entry-64bc2df8698a008eadfb4c825d508377.hbc)
- M4: [Hermes bundle](artifacts/m4-ios/_expo/static/js/ios/entry-8f9d0289d13a6a2ffc9bc27b4e0cdfb6.hbc)
- M5: [Hermes bundle](artifacts/m5-ios/_expo/static/js/ios/entry-d4ad5652d74b89e1f998ea71fbb4e2a1.hbc)
- M6: [Hermes bundle](artifacts/m6-ios/_expo/static/js/ios/entry-066407fefb9c38d77bc9ff0af4bf8eb3.hbc)
- M8: [Hermes bundle](artifacts/m8-ios/_expo/static/js/ios/entry-44ecd9ff20e71a5dcef6cb23cf308812.hbc)

No simulator proof is claimed. Supplemental web proofs cover [cold history/search](evidence/m6-cold-offline.json), [offline likes/reactions](evidence/m6-offline-intents.json), and [durable restart plus same-account edits/reactions](evidence/m8-restart-queue.json).

## Scale replay

The successful attempt used a fresh instance on port 49202, seeded through the real auth/mutation paths with all starter segments. Push emission was disabled for replay users. Every action settled before the next; media actions have explicit strike receipts.

- Failed verifier attempt: start=1789227903.839, end=1789227937.484, wall=33.645s. Stopped at 24777 actions because my verifier used wrong follow-field names; entity totals already matched. Instance and receipts retained.
- Successful attempt: start=1789227997.219, end=1789228209.927, wall=212.708s; excluded checkpoint/probe wall=3.306s; replay wall=209.402s.
- 167157/167157 actions accounted for; zero failed actions. The 10%, 50% and final invariant checks passed.
- Final state: 1,008 users, 50,228 posts, 99,105 text messages, 1,002 conversations, 5,921 follow edges. The environment removes 910 media messages and two media-dependent reactions; 1,998 reactions remain.

[Replay receipt](evidence/scale-replay-receipt.json), [final invariant verification](evidence/scale-verify-final.json), [full-corpus analytics probe](evidence/m8-scale-analytics.json). Verification independently enumerated actual tables and checked named content and relationship counts against the manifest with explicit media adjustments. Hidden grader samples and the full O5 performance decision procedure were not run. Insights/Trending checkpoint growth ratios are not claimed because those operations were added after the M6 replay.

## Corrections and remaining gaps

Explicitly labeled correction-loop log events: 25; attribution counts: agent-error=13, snapback4-defect=8, ambiguous=3, environment=1. These count log events, not unique product defects. First-pass failures and standalone retries remain in the log. [Per-event attribution and evidence](correction-loops.json).

- **Expiry security:** guardedMessage refuses expired content, but ordinary history/raw sync may expose it before purge. Exact refusal and reproduction: [security gap](evidence/m5-expiry-security-gap.json).
- Search scans synced rows; no indexed word search or full historical search guarantee. Replica history is bounded to 500 rows per chat; online history pages beyond it.
- Retained-history archive handles visible removal behavior and expiry, but post-removal tombstone propagation is unproven.
- Push uses a transactional outbox and polling sink; abrupt disconnect detection has a 15-second lease and no real provider integration.
- Inbox is capped at 200 conversations; existing-store analytics backfill handles at most 1,000 likes per post per invocation. The installed fixture is within those bounds.
- Native behavior, hidden trust probes, and full performance growth grading remain unverified. The base protocol record is validated; the external harness must attach native token/phase metadata for a composed efficiency record.
- The essay's Convex/Supabase comparisons are architectural judgments. No evidenced Snapback 2 runtime comparison was available, and none was fabricated.

Resolved package workarounds include schema caching for offline bootstrap, separate settings subscription identity, raw pending metadata, serialized local writes, online receipt/typing operations, and explicit sync indexes. See [platform-gaps.md](platform-gaps.md), [essay.md](essay.md), and [diary.md](diary.md). Experience judgments were recorded after the essay and before tallying in [experience-scores.json](experience-scores.json); no weighted total or outcome score is claimed.

## Exact package pins

- @types/react: 19.3.0
- expo: 57.0.22
- expo-constants: 57.0.18
- expo-linking: 57.0.10
- expo-router: 57.0.21
- expo-secure-store: 57.0.4
- expo-sqlite: 57.0.3
- expo-status-bar: 57.0.1
- react: 19.2.3
- react-dom: 19.2.3
- react-native: 0.86.3
- react-native-safe-area-context: 5.7.0
- react-native-screens: 4.26.2
- react-native-web: 0.21.2
- snapback4: 0.0.2
- typescript: 6.0.3
- snapback4-darwin-arm64: 0.0.2
- playwright (choreography): 1.62.1
- ajv (choreography): 8.20.0

Expo used Node 24.18.0 by absolute path; the default shell Node was 25.9.0. npm 11.12.0. Lockfiles retain the full dependency closure.

## Hand-authored lines by file

Physical source/test/config lines, including blanks; generated API/types, bundles, dependencies, copied UI/harness source and replay-instance copies excluded. Diagnostic and reporting scripts are included. Copied harness edits are separately retained as a diff. Prose artifacts are excluded from this code metric. Many files use compact formatting, so physical LOC is not a maintainability measure.

| File | Lines |
|---|---:|
| [.gitignore](.gitignore) | 6 |
| [app.json](app.json) | 1 |
| [app/[...path].tsx](app/[...path].tsx) | 1 |
| [app/_layout.tsx](app/_layout.tsx) | 1 |
| [app/index.tsx](app/index.tsx) | 1 |
| [choreography-adapter.json](choreography-adapter.json) | 1 |
| [choreography/json-schema-local.mjs](choreography/json-schema-local.mjs) | 3 |
| [package.json](package.json) | 39 |
| [scripts/acceptance-m2.mjs](scripts/acceptance-m2.mjs) | 22 |
| [scripts/acceptance-m3.mjs](scripts/acceptance-m3.mjs) | 11 |
| [scripts/acceptance-m4.mjs](scripts/acceptance-m4.mjs) | 13 |
| [scripts/acceptance-m5.mjs](scripts/acceptance-m5.mjs) | 8 |
| [scripts/acceptance-m6.mjs](scripts/acceptance-m6.mjs) | 6 |
| [scripts/acceptance-m8.mjs](scripts/acceptance-m8.mjs) | 6 |
| [scripts/acceptance.mjs](scripts/acceptance.mjs) | 24 |
| [scripts/backfill-insights.mjs](scripts/backfill-insights.mjs) | 1 |
| [scripts/choreo.mjs](scripts/choreo.mjs) | 6 |
| [scripts/cold-offline-probe.mjs](scripts/cold-offline-probe.mjs) | 2 |
| [scripts/color-probe-first.mjs](scripts/color-probe-first.mjs) | 2 |
| [scripts/color-probe-route.mjs](scripts/color-probe-route.mjs) | 2 |
| [scripts/color-probe.mjs](scripts/color-probe.mjs) | 2 |
| [scripts/custom-client-demo.mjs](scripts/custom-client-demo.mjs) | 6 |
| [scripts/dual-offline-probe.mjs](scripts/dual-offline-probe.mjs) | 1 |
| [scripts/expiry-probe.mjs](scripts/expiry-probe.mjs) | 1 |
| [scripts/live-probe.mjs](scripts/live-probe.mjs) | 4 |
| [scripts/m5-diagnostic.mjs](scripts/m5-diagnostic.mjs) | 1 |
| [scripts/m8-scale-analytics-probe.mjs](scripts/m8-scale-analytics-probe.mjs) | 1 |
| [scripts/member-probe.mjs](scripts/member-probe.mjs) | 3 |
| [scripts/offline-intents-probe.mjs](scripts/offline-intents-probe.mjs) | 1 |
| [scripts/offline-probe.mjs](scripts/offline-probe.mjs) | 1 |
| [scripts/push-provider.mjs](scripts/push-provider.mjs) | 1 |
| [scripts/quote-probe.mjs](scripts/quote-probe.mjs) | 4 |
| [scripts/replay-adapter.mjs](scripts/replay-adapter.mjs) | 24 |
| [scripts/report.mjs](scripts/report.mjs) | 12 |
| [scripts/restart-queue-probe.mjs](scripts/restart-queue-probe.mjs) | 3 |
| [scripts/scale-replay.mjs](scripts/scale-replay.mjs) | 5 |
| [scripts/seed.mjs](scripts/seed.mjs) | 21 |
| [scripts/shutdown.mjs](scripts/shutdown.mjs) | 1 |
| [scripts/smoke.mjs](scripts/smoke.mjs) | 2 |
| [scripts/start-backend.mjs](scripts/start-backend.mjs) | 4 |
| [scripts/start-scale.mjs](scripts/start-scale.mjs) | 1 |
| [scripts/start-web.mjs](scripts/start-web.mjs) | 3 |
| [scripts/validate-record.mjs](scripts/validate-record.mjs) | 1 |
| [scripts/verify-scale.mjs](scripts/verify-scale.mjs) | 8 |
| [scripts/window-probe.mjs](scripts/window-probe.mjs) | 8 |
| [scripts/windows.mjs](scripts/windows.mjs) | 5 |
| [scripts/wire.mjs](scripts/wire.mjs) | 3 |
| [snapback/schema.q](snapback/schema.q) | 572 |
| [src/Analytics.tsx](src/Analytics.tsx) | 4 |
| [src/App.tsx](src/App.tsx) | 40 |
| [src/Messaging.tsx](src/Messaging.tsx) | 52 |
| [src/Search.tsx](src/Search.tsx) | 15 |
| [src/Social.tsx](src/Social.tsx) | 18 |
| [src/client.ts](src/client.ts) | 24 |
| [src/retainedHistory.ts](src/retainedHistory.ts) | 11 |
| [src/schemaCache.ts](src/schemaCache.ts) | 5 |
| [tsconfig.json](tsconfig.json) | 18 |

Total: 1042 lines across 57 files. Frozen shared UI: 3671 source lines, excluded from the authored total. [Machine-readable count](hand-authored-loc.json).

## Handoff

See [README.md](README.md) for startup, per-milestone acceptance, starter seeding and choreography commands; [API.md](API.md) for third-party clients. Servers are stopped at handoff by exact recorded PID; [shutdown evidence](evidence/shutdown.json). Source and retained instances stay in this lane. An observed listener on 49219 (PID 2619) was absent from this lane’s launch records and was left untouched.

end=1789230003
