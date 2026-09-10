# Clique — final report

Lane `astra-clique-snapback2`; model `gpt-6-astra`, effort `medium`, published backend `snapback2@0.0.20` only.

Run start=1788960687; report end=1788973918; elapsed=13231 seconds. Orientation is included. No sibling/source checkout or prior run was used.

## Milestones

| Milestone | Status | Start epoch | End / first recorded green | Wall seconds | Suite | Choreography |
|---|---|---:|---:|---:|---:|---:|
| M1 | green | 1788960729 | 1788961227 | 498 | 7 passing | 3/3 passing |
| M2 | green | 1788961227 | 1788961835 | 608 | 22 passing | 9/9 passing |
| M3 | green | 1788961835 | 1788962691 | 856 | 7 passing | 7/7 passing |
| M4 | green | 1788962691 | 1788963136 | 445 | 5 passing | 5/5 passing |
| M5 | green | 1788963136 | 1788967064 | 3928 | 6 passing | 4/4 passing |
| M6 | green | 1788967064 | 1788970099 | 3035 | 5 passing | 1/1 passing |
| M8 | green | 1788970099 | 1788972311 | 2212 | 6 passing | 5/5 passing |
| M7 | not-run | — | — | — | Separate session excluded | — |

First-green values above are the explicit run-log milestone declarations, not reconstructed earlier component-pass times. Exact retained suite/choreography paths, timestamps and bound receipts are in milestone-status (raw lane: `lanes/astra-snapback2/evidence/milestone-status.json`). Coverage is in coverage-manifest.json (raw lane: `lanes/astra-snapback2/coverage-manifest.json`). There were no final required web choreography skips.

## Scale replay

Attempted against fresh `scale-instance`, seeded through all three public starter segments; M1 idempotence checked. Original dev state remains in root `.snapback`. Posture: local Snapback dev binary, Hermes engine. Push/digests disabled by that project’s pinned replay flag.
Raw clock: `[{"attempt": 1, "startedAt": "2026-09-09T16:45:31.318Z", "finishedAt": "2026-09-09T17:07:34.177Z", "startEpoch": 1788972331.318, "endEpoch": 1788973654.177, "settledPrefix": 167157, "continuationOf": null, "disposition": "completed"}]`.
Replay-only wall=1042.251s; excluded verification/probe wall=280.608s. Cap=14400s (user safety limit; pilot calibration unavailable).
Settled prefix=167157/167157; invariant verification pass=True. Failed actions: `[]`.
Replay clock (raw lane: `lanes/astra-snapback2/evidence/scale-replay-clock.json`), settle/invariant receipt (raw lane: `lanes/astra-snapback2/evidence/scale-replay-receipt.json`), and per-action `evidence/scale-settles.jsonl` preserve the attempt. Corpus counts are receipt accounting; independent verification uses named fixtures and a disclosed deterministic sample, not the hidden grader seed.

### 10% measurements

| Probe | p95 ms | Within 3× | Mid-curve |
|---|---:|---|---|
| page1 | 4.54929200001061 | — | — |
| page50 | 5.3643340000126045 | True | — |
| following500 | 12.61874999999418 | True | — |
| following5 | 5.262625000003027 | — | — |
| celebrityFollowing | 5.75229100001161 | True | — |
| globalSearch | 2.997000000003027 | — | — |
| insights | 2.072667000000365 | — | — |
| trending | 2.926666999992449 | — | — |

Full samples and errors: receipt (raw lane: `lanes/astra-snapback2/evidence/scale-probes-10pct.json`).
### full measurements

| Probe | p95 ms | Within 3× | Mid-curve |
|---|---:|---|---|
| page1 | 5.1585830000003625 | — | — |
| page50 | 4.742541999999958 | True | — |
| following500 | 12.388375000000451 | True | — |
| following5 | 5.09375 | — | — |
| celebrityFollowing | 5.0382079999999405 | True | — |
| globalSearch | 2.983249999999316 | True | True |
| insights | 3.3473749999993743 | True | True |
| trending | 3.4033330000002024 | True | True |
| celebrityWrite | 8.492707999999766 | True | — |
| fiveFollowerWrite | 8.494541999998546 | — | — |
| groupSendRender | groupSendRender timeout | — | — |

Cold browser sync: `{"pass": false, "error": "locator.waitFor: Timeout 30000ms exceeded.\nCall log:\n\u001b[2m  - waiting for getByTestId('clique-sync-state').filter({ hasText: 'Messages synced' }) to be visible\u001b[22m\n", "wallMs": 30231.683750000004}`. Heap samples remain in the probe receipt.
Full samples and errors: receipt (raw lane: `lanes/astra-snapback2/evidence/scale-probes-full.json`).
### 50% measurements

| Probe | p95 ms | Within 3× | Mid-curve |
|---|---:|---|---|
| page1 | 6.4959159999853 | — | — |
| page50 | 4.890499999979511 | True | — |
| following500 | 11.814541000057943 | True | — |
| following5 | 5.011875000083819 | — | — |
| celebrityFollowing | 5.050500000012107 | True | — |
| globalSearch | 2.91862500004936 | — | — |
| insights | 2.0364579999586567 | — | — |
| trending | 2.934375000069849 | — | — |

Full samples and errors: receipt (raw lane: `lanes/astra-snapback2/evidence/scale-probes-50pct.json`).

Cold-sync repeat: strict fresh-storage batch (raw lane: `lanes/astra-snapback2/evidence/scale-cold-browser.json`) failed its first warm-up at the 30-second total deadline. No measured k=20 p95 exists. **Overall browser scale safety failed** (cold sync and group send/render), despite invariant success and passing backend degradation ratios. The repeat has its own post-replay timestamps and 30.162 seconds of wall time, outside the recorded replay attempt.

## Native artifacts

All seven milestone Hermes exports exist; exact paths are in milestone-status. M6 and M8 simulator proofs both **failed** separately from web green. Signed Release builds, XCTest result bundles, screenshots, and partial videos are retained. No passing native JSONL was fabricated.
M6 native record (raw lane: `lanes/astra-snapback2/artifacts/m6-native/m6-ios-run.json`); M8 native record (raw lane: `lanes/astra-snapback2/artifacts/m8-native/m8-ios-run.json`).

## Corrections and package pins

74 timestamped correction/error/retry/workaround events retained, including mixed-attribution events. Counts by recorded classification: `{'agent-error': 45, 'environment': 7, 'ambiguous': 21, 'snapback2-defect': 1}`. This counts logged evidence events, not an invented one-to-one measure of individual bugs.
Every event with attribution and evidence (raw lane: `lanes/astra-snapback2/evidence/correction-loops.json`). Snapback-specific claims are confined to captured diagnostics; unresolved native and transport behavior remains ambiguous.

Exact direct resolutions include Snapback `0.0.20`, host binary `0.0.20`, Expo `54.0.37`, React `19.1.0`, React Native `0.81.5`. All resolved top-level pins (raw lane: `lanes/astra-snapback2/evidence/resolved-pins.json`); full transitive closure in package-lock.json; binary hashes in setup-identity.json.

## Hand-authored lines

1620 physical authored lines across 121 source/test/tool files. Generated and inherited code excluded; diagnostic scripts included. Per-file counts and counting rule: hand-authored-lines.json (raw lane: `lanes/astra-snapback2/evidence/hand-authored-lines.json`).

| File | Lines |
|---|---:|
| `app/index.tsx` | 1 |
| `app/_layout.tsx` | 7 |
| `app/[...path].tsx` | 1 |
| `src/Media.web.ts` | 1 |
| `src/Messaging.tsx` | 26 |
| `src/useReceiptWriter.ts` | 2 |
| `src/NetworkContext.ts` | 1 |
| `src/images.web.ts` | 3 |
| `src/Search.tsx` | 3 |
| `src/MediaInput.tsx` | 2 |
| `src/images.ts` | 3 |
| `src/Network.web.tsx` | 3 |
| `src/platform.ts` | 2 |
| `src/MediaInput.web.tsx` | 2 |
| `src/platform.web.ts` | 3 |
| `src/keys.ts` | 1 |
| `src/Clique.tsx` | 34 |
| `src/videoPoster.ts` | 1 |
| `src/Insights.tsx` | 16 |
| `src/Posts.tsx` | 24 |
| `src/Media.ts` | 1 |
| `src/Network.tsx` | 6 |
| `src/revocations.ts` | 1 |
| `snapback/api.q` | 5 |
| `snapback/runtime.q` | 1 |
| `snapback/access.q` | 9 |
| `snapback/insights.q` | 17 |
| `snapback/groups.q` | 97 |
| `snapback/insightsBackfill.q` | 13 |
| `snapback/profiles.q` | 31 |
| `snapback/notifications.q` | 7 |
| `snapback/feeds.q` | 25 |
| `snapback/messages.q` | 170 |
| `snapback/digests.q` | 54 |
| `snapback/posts.q` | 53 |
| `snapback/follows.q` | 21 |
| `snapback/delivery.ts` | 5 |
| `snapback/schema.q` | 333 |
| `scripts/offline-engagement.mjs` | 2 |
| `scripts/scale-cold-probe.ts` | 2 |
| `scripts/debug-m5-carol.mjs` | 1 |
| `scripts/setup.mjs` | 5 |
| `scripts/finalize-report.py` | 50 |
| `scripts/debug-token.ts` | 1 |
| `scripts/debug-m8-live.mjs` | 5 |
| `scripts/scale-sample-verify.ts` | 7 |
| `scripts/debug-once.mjs` | 2 |
| `scripts/acceptance-m4.ts` | 3 |
| `scripts/debug-expired-server.ts` | 1 |
| `scripts/native-proof-edit.py` | 16 |
| `scripts/native-target.rb` | 12 |
| `scripts/debug-m5-flow.mjs` | 1 |
| `scripts/fixture-observer.mjs` | 4 |
| `scripts/cleanup-sample-uploads.ts` | 1 |
| `scripts/debug-signup.mjs` | 1 |
| `scripts/gateway.mjs` | 2 |
| `scripts/m8-live-effects.ts` | 3 |
| `scripts/debug-feed.mjs` | 1 |
| `scripts/debug-navrace.mjs` | 1 |
| `scripts/seed.ts` | 4 |
| `scripts/scale-verification-continuation.ts` | 2 |
| `scripts/replay-sample.ts` | 3 |
| `scripts/acceptance-m5.ts` | 6 |
| `scripts/debug-transport.ts` | 1 |
| `scripts/audit-scale.ts` | 4 |
| `scripts/acceptance-m2.ts` | 15 |
| `scripts/debug-m4.ts` | 1 |
| `scripts/choreo.mjs` | 1 |
| `scripts/scale-replay.ts` | 5 |
| `scripts/configure-digest.ts` | 1 |
| `scripts/debug-once-long.mjs` | 2 |
| `scripts/debug-send.mjs` | 2 |
| `scripts/debug-expiry-flow.mjs` | 1 |
| `scripts/m2-schema.py` | 41 |
| `scripts/acceptance-m6.ts` | 3 |
| `scripts/digest-proof.ts` | 23 |
| `scripts/custom-client-demo.mjs` | 4 |
| `scripts/m5-rewrite.py` | 16 |
| `scripts/debug-once-open.mjs` | 2 |
| `scripts/debug-insights.mjs` | 1 |
| `scripts/debug-m5-toggle.mjs` | 1 |
| `scripts/debug-membership.ts` | 1 |
| `scripts/acceptance.ts` | 28 |
| `scripts/debug-direct.ts` | 1 |
| `scripts/debug-m5-flow2.mjs` | 1 |
| `scripts/acceptance-m3.ts` | 6 |
| `scripts/native-m8-control.ts` | 19 |
| `scripts/debug-m5.mjs` | 1 |
| `scripts/debug-boot.mjs` | 1 |
| `scripts/debug-m5-click.mjs` | 1 |
| `scripts/clique-api.mjs` | 17 |
| `scripts/acceptance-m8.ts` | 22 |
| `scripts/debug-background.mjs` | 1 |
| `scripts/debug-consumed.ts` | 1 |
| `scripts/replay-adapter.ts` | 55 |
| `scripts/offline-reaction.mjs` | 2 |
| `scripts/debug-media.mjs` | 1 |
| `scripts/native-control.ts` | 8 |
| `scripts/configure.ts` | 1 |
| `scripts/scale-verify.ts` | 29 |
| `scripts/debug-sync.mjs` | 2 |
| `scripts/m3-schema.py` | 19 |
| `scripts/push-provider.mjs` | 1 |
| `scripts/scale-extra-probes.ts` | 16 |
| `scripts/m8-schema.py` | 74 |
| `scripts/inspect.mjs` | 1 |
| `scripts/debug-message-media.mjs` | 1 |
| `scripts/instrument-loader.mjs` | 1 |
| `scripts/stop-owned.py` | 18 |
| `lib/json-schema.mjs` | 3 |
| `ios/CliqueUITests/CliqueUITests.swift` | 20 |
| `ui/src/ReactionPicker.tsx` | 1 |
| `ui/src/PollDisplay.tsx` | 3 |
| `ui/src/ReceiptTicks.tsx` | 1 |
| `ui/src/FeedCard.tsx` | 4 |
| `ui/src/ChatSettingsForm.tsx` | 7 |
| `ui/src/FeedTabs.tsx` | 1 |
| `ui/src/ChatListRow.tsx` | 1 |
| `ui/src/MessageBubble.tsx` | 2 |
| `ui/src/Avatar.tsx` | 2 |
| `ui/src/Composer.tsx` | 1 |

## Gaps and limits

- Native M6/M8 complete proofs did not pass; native parity is unproven.
- Full-envelope cold browser sync and group send/render exceeded 30 seconds. Fresh cold-sync heap peaked at 485,345,672 bytes; no cold k=20 p95 is claimed. This is unresolved application/offline integration, not a proven package defect.
- Following lookup is bounded at 500 follows; global message search at 100 memberships. Scale degradation predicates are reported above without turning a failure into a pass.
- Digest work scans messages in resumable chunks; maintained counters require a backfill on older rows.
- Opaque custom-client sessions support logout revocation, but a numeric public token TTL was not available.
- Durable resume exposed a captured conditional-envelope refusal; retry is visible. See platform gaps (raw lane: `lanes/astra-snapback2/docs/platform-gaps.md`).
- The frozen choreography omitted a schema helper; a narrow AJV loader redirect preserved its schemas and assertions. Copied UI ARIA fixes mirror native values.
- No deployment or native release-store submission is claimed. No M7 session was run.
- Token and fine-grained phase metering unavailable to this agent; recorded null rather than estimated.

All owned servers stopped; no listeners remain on50100–50119. Exact PID and simulator cleanup: server-cleanup.json (raw lane: `lanes/astra-snapback2/evidence/server-cleanup.json`).

Diary (raw lane: `lanes/astra-snapback2/diary.md`), comparison essay (raw lane: `lanes/astra-snapback2/essay.md`), machine run record (raw lane: `lanes/astra-snapback2/run-record.json`), and run log (raw lane: `lanes/astra-snapback2/run-log.md`).

end=1788973918
