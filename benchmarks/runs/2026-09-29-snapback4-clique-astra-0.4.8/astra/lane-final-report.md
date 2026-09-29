# Clique — final report

lane id astra-clique-snapback4-full-20260913
model gpt-6-astra
effort=medium
backend=snapback4-0.4.8

Requested authoring milestones: **M1, M2, M3, M4, M5, M6, M8 green**. M7 was not attempted. Nothing was struck from product scope. No deployment is claimed.

## Clock and milestone evidence

Raw start=1790644711; authoring boundary=1790652558; report end=1790656758. Total elapsed 12047s; continuous authoring interval 7847s. M1 includes the 41 seconds before the explicit M1-start log entry, so orientation is not excluded. Each milestone had a 14,400-second safety cap; none exhausted it. First harness green is the final passing suite-linked choreography timestamp; the terminal boundary also includes the native export and boundary recording.

| Milestone | Status | Start epoch | End epoch | Wall seconds | First harness green epoch | Seconds to harness green |
|---|---|---:|---:|---:|---:|---:|
| M1 | green | 1790644711 | 1790645307 | 596 | 1790645263.376 | 552.376 |
| M2 | green | 1790645307 | 1790646926 | 1619 | 1790646837.538 | 1530.538 |
| M3 | green | 1790646926 | 1790648087 | 1161 | 1790648029.036 | 1103.036 |
| M4 | green | 1790648087 | 1790649457 | 1370 | 1790649381.161 | 1294.161 |
| M5 | green | 1790649457 | 1790650337 | 880 | 1790650317.537 | 860.537 |
| M6 | green | 1790650337 | 1790651522 | 1185 | 1790651479.372 | 1142.372 |
| M7 | not-run | — | — | 0 | — | — |
| M8 | green | 1790651522 | 1790652558 | 1036 | 1790652485.815 | 963.815 |

| Milestone | Suite | Choreography | iOS artifact |
|---|---|---|---|
| M1 | [6 tests pass, no missing coverage](evidence/m1-suite.json) | [3/3 implemented pass; 3 required](evidence/m1-choreo.jsonl) | [Hermes export](artifacts/m1-ios/metadata.json) |
| M2 | [11 tests pass, no missing coverage](evidence/m2-suite.json) | [9/9 implemented pass; 9 required](evidence/m2-choreo.jsonl) | [Hermes export](artifacts/m2-ios/metadata.json) |
| M3 | [5 tests pass, no missing coverage](evidence/m3-suite.json) | [6/6 implemented pass; 5 required](evidence/m3-choreo.jsonl) | [Hermes export](artifacts/m3-ios/metadata.json) |
| M4 | [7 tests pass, no missing coverage](evidence/m4-suite.json) | [5/5 implemented pass; 5 required](evidence/m4-choreo.jsonl) | [Hermes export](artifacts/m4-ios/metadata.json) |
| M5 | [7 tests pass, no missing coverage](evidence/m5-suite.json) | [4/4 implemented pass; 2 required](evidence/m5-choreo.jsonl) | [Hermes export](artifacts/m5-ios/metadata.json) |
| M6 | [4 tests pass, no missing coverage](evidence/m6-suite.json) | [1/1 implemented pass; 1 required](evidence/m6-choreo.jsonl) | [Hermes export](artifacts/m6-ios/metadata.json) |
| M8 | [5 tests pass, no missing coverage](evidence/m8-suite.json) | [5/5 implemented pass; 5 required](evidence/m8-choreo.jsonl) | [Hermes export](artifacts/m8-ios/metadata.json) |

All suite receipt hashes still match the hashes embedded in their final choreography summaries. Coverage is mapped in [coverage-manifest.json](coverage-manifest.json) and passes the frozen validator ([proof](evidence/coverage-validation.json)). The original flat mapping was complete but lacked the registered wrapper; that format correction and external validation happened during final review, not at the original milestone timestamps. Native artifacts contain Hermes bytecode; simulator and physical-device behavior were not tested and are not claimed. The environment explicitly required bundle exports instead.

Exact instrument skip retained for M3 `sender-avatar-identity-when-rendered`: “The kit does not render sender avatars in the default 1:1 layout; identity is checked only when the app opts into that node.” This optional check had passed in earlier attempts; it remains a skip in the final receipt. No required choreography check was relabeled or omitted.

## Replay and scale

[Clock](evidence/scale-clock.json): start=1790652559; end=1790655248; total wall=2689.063s; replay wall excluding checkpoints=2563.5080000000003s; excluded checkpoint wall=125.555s. Separate conservative builder cap=14,400s because no numeric replay cap was supplied. Settled actions=167243. Full invariant verification=true. 

Fresh durable backend at port 49363, seeded through the three starter logs, then the hash-pinned scale log (b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9). Replay mode suppresses new push effects and holds schedules. [Settle receipts](evidence/scale-settles.jsonl) account for each action. The adapter also passed the fixture's 50-action validator and 32 stored-state checks ([sample proof](evidence/sample-50-verification.json)).

Supplemental correct-account curve: start=1790655288; end=1790656719; wall=1430.819s; verification=true. [Separate prefix clock](evidence/scale-prefix-clock.json). The running primary driver had cached its earlier probe selection; a fresh instance was replayed through 10% and 50%, both verified, to measure the required u0500 Insights query. [Corrected full-account/write metrics](evidence/scale-full-supplemental-probes.json) were collected after the primary full invariant check. Original metrics remain intact; these are supplemental builder measurements, not a hidden-grader curve.

Builder scale checks: 9/11 pass. The following limits failed and remain failures: global-message-search midpoint at/below endpoint line; insights-u0500 midpoint at/below endpoint line. These results do not override the hidden-grader qualification limits.

Full browser cold sync=12927.476ms; logical held data=4034629 bytes; WASM heap=54525952 bytes. These are different residency measures and are not process RSS.

| Builder check | Result | Measured value |
|---|---|---|
| deep history page 50 / page 1 | pass | 1.087× (limit 3×) |
| 500-follow feed / 5-follow feed | pass | 0.843× (limit 3×) |
| celebrity-follower feed / 5-follow feed | pass | 0.782× (limit 3×) |
| celebrity post acknowledgment / small-author acknowledgment | pass | 0.808× (limit 3×) |
| global-message-search full / 10% | pass | 0.930× (limit 3×) |
| global-message-search midpoint at/below endpoint line | fail | 21.523ms vs line 17.277ms |
| insights-u0500 full / 10% | pass | 2.380× (limit 3×) |
| insights-u0500 midpoint at/below endpoint line | fail | 6.566ms vs line 6.391ms |
| trending full / 10% | pass | 0.776× (limit 3×) |
| trending midpoint at/below endpoint line | pass | 6.547ms vs line 7.797ms |
| full cold-sync under 30 seconds and 100 memberships available offline | pass | 12927.476ms |

- 10%: [invariant verification](evidence/scale-10%-verification.json)=true; [builder probes](evidence/scale-10%-probes.json)=false.
- 50%: [invariant verification](evidence/scale-50%-verification.json)=true; [builder probes](evidence/scale-50%-probes.json)=true.
- full: [invariant verification](evidence/scale-full-verification.json)=true; [builder probes](evidence/scale-full-probes.json)=true.

The builder verification seed is 20260928 and is explicitly not the unavailable hidden-grader seed. Verification compares all settle-accounted manifest maps and independently reads deterministic samples of every action class, the full busy-chat history, and named O5 fixtures. Probe requests use three warmups and twenty sequential measurements. The original and corrected full-only write-ack probes append 92 labeled posts after the invariant check; those additions are excluded from the corpus claim. Browser cold-sync evidence is separate from API query timings. See [scale assessment](evidence/scale-assessment.json) for degradation ratios and limits.

## Additional behavioral evidence

- [Server expiry](evidence/m5-suite.json): real shortened expiry with clients closed, asset refusal, persistent browser reopen, and offline search purge.
- [Digest](evidence/m8-digest-verification.json): real 120-second schedule, all test clients closed, backend restart, exact authorized counts, no quiet-user payload, no payload in the next inactive period.
- [Durable queue](evidence/m8-durable-queue.json): offline persistent-browser restart, pending messages retained, exactly-once ordered flush, read receipts.
- [Custom client](evidence/custom-client-demo.json) and [API contract](API.md): auth, conversation paging, history paging, send, polling receive, media lifecycle.

Final review also corrected quote navigation across multiple history pages ([46-message proof](evidence/quote-deep-verification.json)) and separated Metro caches by backend. The original M8 export is retained at `artifacts/m8-ios-first-green`; `artifacts/m8-ios` includes the final navigation correction. These late fixes are disclosed separately from the original milestone clocks.

## Corrections and attribution

agent-error: 39; environment: 3; ambiguous: 4; snapback-defect: 0. These are logged correction/diagnostic entries, not a reconstructed semantic-action efficiency score. [run-record.json](run-record.json) preserves each entry and evidence pointer; [run-log.md](run-log.md) preserves raw timestamps, lookups, retries, and PID ownership.

Most corrections were application or test mistakes: transient query state owning routes/composers, incomplete state displayed as false, optimistic visibility mistaken for server settlement, and fixture setup assumptions. Repeated unexplained EMPTY_READ diagnostics and asynchronous small-feed behavior are recorded as ambiguous rather than assigned to a platform defect without a reproducer. Late replay-adapter hardening after M6 green is explicitly charged to M8.

## Packages and line counts

Exact application pins remain `snapback4@0.4.8` and `snapback4-expo@0.4.8`, installed from public npm. [Resolved package entries and integrity hashes](evidence/resolved-package-pins.json) include the platform binary. Expo is 57.0.22, React 19.2.3, React Native 0.86.3. No source build or Snapback repository was used.

Hand-authored or modified source/test/config lines: 7346 across 91 files. Physical lines=7697; unchanged starter/generated lines excluded=351. Physical source/test/config lines; exact unchanged lines matching same-path CLI starter excluded using SequenceMatcher. Frozen kit/harness, dependencies, generated API, exports, stores, and documentation excluded. Modified/adapted lines count as authored. This is a ceremony proxy, not a complexity metric.

| File | Authored/modified lines | Physical lines |
|---|---:|---:|
| app/_layout.tsx | 86 | 91 |
| app/chat/[id]/index.tsx | 7 | 7 |
| app/chat/[id]/settings.tsx | 7 | 7 |
| app/chats.tsx | 1 | 1 |
| app/conversation/[handle].tsx | 7 | 7 |
| app/conversation/group/[group]/index.tsx | 7 | 7 |
| app/conversation/group/[group]/settings.tsx | 7 | 7 |
| app/index.tsx | 27 | 27 |
| app/insights.tsx | 1 | 1 |
| app/new-chat.tsx | 1 | 1 |
| app/post/[id].tsx | 7 | 7 |
| app/profile/[handle].tsx | 12 | 12 |
| app/profile/edit.tsx | 10 | 10 |
| app/search.tsx | 1 | 1 |
| app/settings.tsx | 14 | 14 |
| app.json | 6 | 23 |
| babel.config.js | 0 | 4 |
| config/active.json | 0 | 24 |
| config/digest.production.json | 8 | 8 |
| config/digest.shortened.json | 8 | 8 |
| config/windows.production.json | 24 | 24 |
| config/windows.shortened.json | 24 | 24 |
| metro-wasm-transformer.cjs | 0 | 10 |
| metro.config.js | 10 | 15 |
| package.json | 10 | 42 |
| scripts/acceptance-m2.mjs | 293 | 293 |
| scripts/acceptance-m3.mjs | 177 | 177 |
| scripts/acceptance-m4.mjs | 180 | 180 |
| scripts/acceptance-m5.mjs | 245 | 245 |
| scripts/acceptance-m6.mjs | 112 | 112 |
| scripts/acceptance-m8.mjs | 149 | 149 |
| scripts/acceptance.mjs | 150 | 150 |
| scripts/check-frozen.mjs | 2 | 2 |
| scripts/check-production.mjs | 2 | 2 |
| scripts/choreo.mjs | 36 | 36 |
| scripts/configure.mjs | 19 | 19 |
| scripts/coverage.mjs | 3 | 3 |
| scripts/custom-client-demo.mjs | 106 | 106 |
| scripts/debug-delete.mjs | 33 | 33 |
| scripts/debug-follow.mjs | 55 | 55 |
| scripts/debug-group.mjs | 26 | 26 |
| scripts/debug-like.mjs | 40 | 40 |
| scripts/debug-m6.mjs | 21 | 21 |
| scripts/debug-media.mjs | 23 | 23 |
| scripts/debug-state.mjs | 22 | 22 |
| scripts/digest-probe.mjs | 164 | 164 |
| scripts/durable-offline-probe.mjs | 153 | 153 |
| scripts/finalize-report.mjs | 141 | 141 |
| scripts/full-extra-probes.mjs | 104 | 104 |
| scripts/inspect.mjs | 18 | 18 |
| scripts/line-counts.py | 21 | 21 |
| scripts/log.mjs | 5 | 5 |
| scripts/offline-probe.mjs | 56 | 56 |
| scripts/owned-server.mjs | 60 | 60 |
| scripts/post-replay.mjs | 35 | 35 |
| scripts/push-worker.mjs | 31 | 31 |
| scripts/quote-deep-probe.mjs | 112 | 112 |
| scripts/replay-adapter.mjs | 307 | 307 |
| scripts/replay-model.mjs | 158 | 158 |
| scripts/replay-prefix.mjs | 106 | 106 |
| scripts/replay-probes.mjs | 124 | 124 |
| scripts/replay-sample.mjs | 29 | 29 |
| scripts/replay-scale.mjs | 116 | 116 |
| scripts/replay-verify.mjs | 322 | 322 |
| scripts/report-data.mjs | 114 | 114 |
| scripts/scale-assessment.mjs | 99 | 99 |
| scripts/scale-browser-probe.mjs | 96 | 96 |
| scripts/scale-ui-verification.mjs | 109 | 109 |
| scripts/seed.mjs | 171 | 171 |
| scripts/serve.mjs | 41 | 41 |
| scripts/setup.mjs | 47 | 47 |
| scripts/start-scale-web.mjs | 20 | 20 |
| scripts/start-worker.mjs | 30 | 30 |
| scripts/stop-owned.mjs | 57 | 57 |
| scripts/trending-probe.mjs | 77 | 77 |
| scripts/validate-report.mjs | 29 | 29 |
| snapback/analytics.q | 39 | 39 |
| snapback/config.q | 0 | 9 |
| snapback/messaging.q | 323 | 323 |
| snapback/publicapi.q | 18 | 18 |
| snapback/schedule.q | 0 | 2 |
| snapback/schema.q | 21 | 30 |
| snapback/social.q | 102 | 102 |
| src/Chats.tsx | 923 | 927 |
| src/Expiry.ts | 13 | 13 |
| src/Feed.tsx | 345 | 348 |
| src/Insights.tsx | 55 | 55 |
| src/Media.tsx | 89 | 89 |
| src/MessageMedia.tsx | 57 | 57 |
| src/ProbeBridge.tsx | 22 | 22 |
| src/Profile.tsx | 142 | 144 |
| src/Search.tsx | 132 | 137 |
| src/SendJournal.tsx | 105 | 105 |
| src/client.ts | 24 | 31 |
| src/intent-store.native.ts | 0 | 8 |
| src/intent-store.ts | 0 | 2 |
| src/intent-store.web.ts | 0 | 7 |
| src/intents.ts | 1 | 64 |
| src/useOnceMedia.ts | 0 | 39 |
| src/useOnlineArm.ts | 0 | 28 |
| src/useTyping.ts | 4 | 53 |
| tsconfig.json | 0 | 17 |

## Limits and candid gaps

- No simulator proof, physical-device run, real push provider, or production deployment. The push seam is a logged idempotent worker as required.
- No hidden-grader run or hidden-seed verification. Builder scale results must not be presented as the grader’s O5 score.
- Post-milestone probe and coverage-format corrections are included in total run wall and the correction log, not retroactively hidden inside the original proof timestamps. No trustworthy session-local token stream or exact phase meter was exposed inside the allowed lane. Tokens and phase splits are null; no qualified token-efficiency claim is made. The base protocol record is validated; a fully graded composed benchmark record remains the orchestrator’s responsibility.
- Offline reads cover acquired history and label partial results. They do not promise a complete remote corpus while disconnected. `keep:true` is an explicit SDK presentation choice: a kept row can remain visible until an authorization re-read lands; expiry filtering and server asset refusal remain enforced.
- All required product features were implemented through the published surface. Exact operational refusals and unsuccessful intermediate attempts remain in the evidence; no old-release limitation was assumed. Scale-specific limits, if any, are stated in the assessment linked above.

The comparison essay was written before this tally: [essay.md](essay.md). Milestone reflections are in [diary.md](diary.md). Server processes were tracked by exact owned PID and stopped individually; shutdown evidence is in the run log.

end=1790656758
