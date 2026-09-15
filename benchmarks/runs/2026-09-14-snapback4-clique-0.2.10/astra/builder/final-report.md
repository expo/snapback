# Clique final report

Lane **astra-clique-snapback4-full-20260913** · **gpt-6-astra**, effort **medium**. All seven requested authoring milestones are green. M7 was not run. The fresh scale corpus is verified; O5 is not claimed fully adjudicated.

Exact resolved pins: **snapback4@0.2.10**, **snapback4-expo@0.2.3** (deduplicated peer). [Resolved tree](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/resolved-package-pins.txt) · [Package/binary identity](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/setup-identity.json) · [Final binary hash](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/final-binary-sha256.txt). Backend authored in Quarry; Expo Router uses the published replica, React, and native arms. No Snapback source checkout, sibling lane, prior Clique/Coterie implementation, or prior benchmark diary was inspected.

## Clocks and milestone outcomes

Raw lane start=1789384513; report end=1789392512; total elapsed=7999s. Orientation is inside M1. Every recorded milestone wall is below the 14,400-second safety limit. Recorded boundaries include artifact verification and diary/logging time; first observed suite/browser green is separately shown and is not substituted for a later corrected completion. [Full final receipt summaries](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/milestones.json) and [Machine-readable details](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/final-report-data.json) retain the raw values.

| Milestone | Start epoch | First suite/browser green | Final choreography green | Recorded green boundary | Wall seconds | Status |
|---|---:|---:|---:|---:|---:|---|
| M1 | 1789384513 | 1789385148.624 | 1789385148.624 | 1789385172 | 659 | green |
| M2 | 1789385172 | 1789385723.914 | 1789385723.914 | 1789385774 | 602 | green |
| M3 | 1789385774 | 1789386460.668 | 1789386460.668 | 1789386487 | 713 | green |
| M4 | 1789386487 | 1789387042.145 | 1789387042.145 | 1789387065 | 578 | green |
| M5 | 1789387065 | 1789388057.553 | 1789388057.553 | 1789388094 | 1029 | green |
| M6 | 1789388094 | 1789388772.926 | 1789388772.926 | 1789388792 | 698 | green |
| M8 | 1789388792 | 1789390004.787 | 1789390571.742 | 1789390619 | 1827 | green |
| M7 | — | — | — | — | 0 | not-run: separate fresh session |

The final M8 boundary follows an additional arrival-order correction after an earlier passing browser run. Adapter/verifier follow-up corrections are explicitly logged during M8 and replay; the replay clock was not reset to hide its diagnosis interval. Native token usage and reliable orientation/authoring/verification/diagnosis splits are unavailable within the supplied lane. Counts remain null; no token estimate or efficiency claim is made.

## Acceptance and choreography

[Combined coverage manifest](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/coverage-manifest.json) maps every suite-required assertion in the requested milestones to a passing test. Frozen JSONL receipts, observation streams, failed attempts and frozen suite snapshots are retained under evidence/.

| Milestone | Suite cases passed | Required suite IDs covered | Choreography passed / implemented | Required choreography | Evidence |
|---|---:|---:|---:|---:|---|
| M1 | 6 | 7/7 | 3/3 | 3 | [suite](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m1-suite.json) · [JSONL](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m1-choreography.jsonl) |
| M2 | 10 | 22/22 | 9/9 | 9 | [suite](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m2-suite.json) · [JSONL](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m2-choreography.jsonl) |
| M3 | 5 | 7/7 | 6/6 | 5 | [suite](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m3-suite.json) · [JSONL](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m3-choreography.jsonl) |
| M4 | 6 | 5/5 | 5/5 | 5 | [suite](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m4-suite.json) · [JSONL](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m4-choreography.jsonl) |
| M5 | 7 | 6/6 | 4/4 | 2 | [suite](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m5-suite.json) · [JSONL](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m5-choreography.jsonl) |
| M6 | 5 | 5/5 | 1/1 | 1 | [suite](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m6-suite.json) · [JSONL](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m6-choreography.jsonl) |
| M8 | 4 | 6/6 | 5/5 | 5 | [suite](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m8-suite.json) · [JSONL](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m8-choreography.jsonl) |

Exact optional instrument skip: M3 **sender-avatar-identity-when-rendered** — “The kit does not render sender avatars in the default 1:1 layout; identity is checked only when the app opts into that node.” Required=false. Group/profile/feed avatars are implemented. No required check was relabeled as a skip.

Harness adaptations: the frozen snapshot lacked ../../lib/json-schema.mjs. [A Node loader](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/instrument-loader.mjs) supplies that dependency using the pinned complete AJV schema validator; the copied harness checks were not edited. Fixture paths use its supported adapter. M8’s read-state check navigates directly to CHOREO_BASE_URL expecting chat rows, so M8 receives http://127.0.0.1:49341/chats; earlier segments use the app root. The suite receipt bytes are frozen per invocation for hash custody.

Additional proofs: [durable web restart/media/reaction](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m8-durable-web.json), [concurrent arrival and partial reads](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m8-arrival-order-fixed.json), [scheduled digest and restart](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m8-digest-proof.json), [50-action conformance](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m8-adapter-conformance-final.txt). Starter segments M1, M2 and M3 were installed through real auth/upload/mutation paths and tested for idempotence; npm run seed -- --segment mN is provided for those three segments.

## Native and web artifacts

Every requested milestone produced an iOS Hermes bundle with snapback4-expo@0.2.3. These are build artifacts, not simulator proofs. The user did not require simulator proofs. [Hashes and byte sizes](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/native-artifacts.json) records all seven bundles.

- M1: [Hermes bundle](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/artifacts/m1-ios/_expo/static/js/ios/entry-5dea20a10bfad286e03395dfc6ba3305.hbc) (2618541 bytes).
- M2: [Hermes bundle](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/artifacts/m2-ios/_expo/static/js/ios/entry-7847c0d9edca17ca31f608f27838b121.hbc) (2642056 bytes).
- M3: [Hermes bundle](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/artifacts/m3-ios/_expo/static/js/ios/entry-dcecff1947bb8931032ac30ca4fe4588.hbc) (2672868 bytes).
- M4: [Hermes bundle](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/artifacts/m4-ios/_expo/static/js/ios/entry-5f12f510284a0bbfe93ae8862de0aa09.hbc) (2680605 bytes).
- M5: [Hermes bundle](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/artifacts/m5-ios/_expo/static/js/ios/entry-23a22ed04351074573ad8557f65f24c3.hbc) (2689836 bytes).
- M6: [Hermes bundle](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/artifacts/m6-ios/_expo/static/js/ios/entry-8a01232cb4edfadc2502b2a3b1a0694d.hbc) (2689856 bytes).
- M8: [Hermes bundle](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/artifacts/m8-ios/_expo/static/js/ios/entry-93829003bc4bfbf769c7ba6bf5c54bde.hbc) (2695458 bytes).

Final web export: [artifacts/web](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/artifacts/web). Reproduction and configuration: [README](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/README.md) and [custom-client API](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/API.md).

## Scale replay

The instance at scale-instance/ was fresh, used port 49342, and pinned replayMode() to true. It contains all starter segments followed by the exact hashed scale.log; media was uploaded through the real asset path. Each action waited for authoritative success before the next.

- Original start epoch: **1789390639.473**.
- Last action epoch: **1789391474.176**.
- Verification/probe completion epoch: **1789391788.709**.
- Gross own-clock wall: **1149.236 s**.
- Excluded checkpoint verification/probe wall: **208.378 s**.
- Recorded replay wall after those exclusions: **940.858 s** (includes final verification/probes and the verifier correction interval; conservative).
- Settled: **86 starter + 167,157 scale = 167,243** actions; **1,008 real registrations**.
- Both 10% and 50% checkpoints and the final combined manifest verified. One verifier-only reply-type mapping error paused at 10%; [the first failure](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/scale-clock-attempt1.json) is retained. Resume verified every skipped action against its prior receipt hash and preserved the original clock.

[Clock and resume history](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/scale-clock.json) · [all settle receipts](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/scale-settle-receipts.jsonl) · [10% verification](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/scale-verification-10pct.json) · [50% verification](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/scale-verification-50pct.json) · [extended final verification](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/scale-verification-final-extended.json).

Final exact state: **1,008 users/profiles; 5,921 follows; 50,228 posts (48,224 originals, 2,004 replies); 5,008 likes; 1,004 reposts; 1,002 conversations; 2,053 memberships; 100,015 messages (99,105 text, 910 media); 2,736 quoted replies; 2,000 reactions**. Full per-user/per-chat counts and the named O5 fixtures match. Busy-group history was fully paged through the authenticated API. Extended final checks verify named media bytes, reactions, conversation identities/rosters and counts; view-once bytes were not consumed by verification. The secret grader-selected sample remains external.

## Performance evidence and limits

Local published dev binary; sequential probes, 3 warmups then 20 measured samples, 30-second timeout. Write probes used disposable clones, preserving the canonical corpus. Numbers are diagnostic, not a cross-backend ranking.

| Probe | 10% p95 ms | 50% p95 ms | Full p95 ms |
|---|---:|---:|---:|
| Busy chat page 1 | 4.793 | 4.698 | 4.602 |
| Busy chat page 50 | not enough pages | 5.066 | 5.589 |
| Following: 500 follows | 6.908 | 7.463 | 5.888 |
| Following: 5 follows | 2.814 | 3.062 | 3.132 |
| Celebrity follower read | 2.635 | 3.093 | 3.686 |
| Celebrity post write | 3.684 | 3.472 | 4.670 |
| Five-follower post write | 4.182 | 3.723 | 6.007 |
| Busy group send | 3.855 | 2.626 | 6.844 |
| Insights | 2.363 | 1.944 | 1.950 |
| Trending | 2.306 | 2.312 | 2.345 |
| Fresh browser: 100 chats | 1675.830 | 7681.316 | 13559.437 |

Full ratios: deep history **1.21×**; 500/5-follow feed **1.88×**; celebrity/baseline write **0.78×**; celebrity-follower/baseline read **1.18×**. Insights and Trending full/10% ratios are **0.83×** and **1.02×**; their midpoint checks are within the specified line. No recorded probe timed out or errored. Full wire snapshot: 21334 rows, 22885600 bytes, 261.348 ms; browser hydration is separately measured above. A full memory-growth profile was not captured.

**Global search curve is not established.** The direct HTTP query returned complete:false and no rows, consistent with N_NEVER_COMPLETE on its unpinned authorization scan. Its retained HTTP timings must not be scored as successful search. [The actual replica path](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/full-replica-search.json) returns 50 results, complete=true and a next cursor at the full corpus (Node diagnostic p95 2.918 ms), but no corrected three-size replica-search curve is claimed. O5 and hidden grading remain unadjudicated. [Raw ratios and caveats](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/performance-summary.json).

## Corrections and candid gaps

[Timestamped correction/error/workaround events](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/correction-events.json) retains 35 logged entries: environment=5, agent-error=25, ambiguous=1, snapback-defect=4. Entries include iterations and provisional diagnoses; these are not counts of distinct bugs. Three distinct published-platform issues were observed:

- Delivered-history retention plus a message horizon dropped retained history; removing that horizon fixed it. Full chat history therefore increases cold-sync work. [Evidence](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m3-retention-confirmed.txt).
- Presence guidance and prediction classification disagree. Notification candidates dispatch through a service-only Quarry mutation; presence eligibility is evaluated at dispatch, not the original commit. [Diagnostic](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/check-m6-retry.txt).
- Reaction upsert was eligible but produced no local predicted row; explicit insert/update branches fixed the durable offline path. [Diagnostic](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m8-reaction-diagnostic.jsonl) and [passing proof](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/m8-durable-web.json).

Other limitations: new media uploads require connectivity; Following merges at most 1,000 followed lanes; the named-group shortcut scans 100 memberships (ID-based inbox navigation is paged); digest work scans historical messages and accumulated period rows and needs operational attention at larger sustained workloads. Delivery is a logged provider seam, not APNs/FCM. Native runtime/simulator and hardened public deployment are not claimed. Old-post time-window acceptance uses only the published dev seed door; fixture replay never uses that door.

My own errors included form initialization/argument leakage, RN rendering/selector assumptions, migration backfill assumptions, receipt settlement timing, and timestamp/UUID ordering. The arrival-clock fix is an application correction. A single accidental empty /tmp/unused-empty file was created and immediately removed during M2; this is explicitly logged. No external project content was inspected. Some preliminary read-only diagnostics inspected this lane’s own SQLite storage; the retained scale verifier uses the published SQL inspection surface.

Record custody: [the base run record](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/run-record.json) validates against instrument/schema/run-record.schema.json. The current composed social-messenger record is **not complete**: it requires external driver/native-metering and grading-session fields that this builder did not receive. [Exact validation result](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/run-record-validation.json) is retained; no grader session or native token stream was fabricated. This limitation precludes an efficiency-scorecard claim.

## Hand-authored lines

6028 physical source/test/config lines in 73 files after formatting. Generated API/config, copied UI/instrument/harness/scaffold/fixtures, dependency lockfile, dependencies, binary assets, evidence and generated reports are excluded. Narrative files are separately listed in [the counting manifest](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/hand-authored-lines.json).

| File | Lines |
|---|---:|
| [app.json](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/app.json) | 1 |
| [app/_layout.tsx](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/app/_layout.tsx) | 10 |
| [app/chats.tsx](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/app/chats.tsx) | 23 |
| [app/conversation/[...path].tsx](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/app/conversation/[...path].tsx) | 48 |
| [app/index.tsx](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/app/index.tsx) | 81 |
| [app/insights.tsx](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/app/insights.tsx) | 69 |
| [app/new-chat.tsx](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/app/new-chat.tsx) | 77 |
| [app/post/[id].tsx](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/app/post/[id].tsx) | 30 |
| [app/profile/[handle].tsx](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/app/profile/[handle].tsx) | 65 |
| [app/profile/edit.tsx](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/app/profile/edit.tsx) | 80 |
| [app/search.tsx](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/app/search.tsx) | 102 |
| [app/settings.tsx](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/app/settings.tsx) | 13 |
| [babel.config.js](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/babel.config.js) | 1 |
| [choreography-adapter.json](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/choreography-adapter.json) | 1 |
| [package.json](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/package.json) | 44 |
| [scripts/acceptance-m2.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/acceptance-m2.mjs) | 244 |
| [scripts/acceptance-m3.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/acceptance-m3.mjs) | 115 |
| [scripts/acceptance-m4.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/acceptance-m4.mjs) | 143 |
| [scripts/acceptance-m5.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/acceptance-m5.mjs) | 189 |
| [scripts/acceptance-m6.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/acceptance-m6.mjs) | 241 |
| [scripts/acceptance-m8.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/acceptance-m8.mjs) | 280 |
| [scripts/acceptance.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/acceptance.mjs) | 183 |
| [scripts/arrival-order-proof.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/arrival-order-proof.mjs) | 56 |
| [scripts/boundary.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/boundary.mjs) | 34 |
| [scripts/browser-smoke.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/browser-smoke.mjs) | 12 |
| [scripts/choreo.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/choreo.mjs) | 44 |
| [scripts/configure.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/configure.mjs) | 32 |
| [scripts/custom-client-demo.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/custom-client-demo.mjs) | 77 |
| [scripts/final-report.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/final-report.mjs) | 407 |
| [scripts/full-search-proof.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/full-search-proof.mjs) | 57 |
| [scripts/inspect-avatar.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/inspect-avatar.mjs) | 26 |
| [scripts/inspect-convo.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/inspect-convo.mjs) | 32 |
| [scripts/inspect.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/inspect.mjs) | 21 |
| [scripts/instrument-loader.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/instrument-loader.mjs) | 14 |
| [scripts/log.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/log.mjs) | 5 |
| [scripts/offline-durable.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/offline-durable.mjs) | 168 |
| [scripts/pack-evidence.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/pack-evidence.mjs) | 27 |
| [scripts/probe-clone.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/probe-clone.mjs) | 110 |
| [scripts/probe-cold-web.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/probe-cold-web.mjs) | 35 |
| [scripts/probe-scale.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/probe-scale.mjs) | 99 |
| [scripts/query-diagnostic.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/query-diagnostic.mjs) | 11 |
| [scripts/replay.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/replay.mjs) | 202 |
| [scripts/restart-backend.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/restart-backend.mjs) | 33 |
| [scripts/retention-metadata.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/retention-metadata.mjs) | 8 |
| [scripts/retention-probe.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/retention-probe.mjs) | 70 |
| [scripts/scale.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/scale.mjs) | 95 |
| [scripts/schema-validator.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/schema-validator.mjs) | 10 |
| [scripts/seed.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/seed.mjs) | 5 |
| [scripts/setup.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/setup.mjs) | 53 |
| [scripts/start-instance.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/start-instance.mjs) | 38 |
| [scripts/start.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/start.mjs) | 25 |
| [scripts/starter.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/starter.mjs) | 132 |
| [scripts/verify-scale.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/verify-scale.mjs) | 274 |
| [scripts/wire.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/scripts/wire.mjs) | 51 |
| [snapback/analytics.q](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/snapback/analytics.q) | 109 |
| [snapback/chat.q](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/snapback/chat.q) | 216 |
| [snapback/features.q](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/snapback/features.q) | 25 |
| [snapback/media.q](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/snapback/media.q) | 80 |
| [snapback/order.q](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/snapback/order.q) | 22 |
| [snapback/push.q](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/snapback/push.q) | 12 |
| [snapback/replay.q](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/snapback/replay.q) | 2 |
| [snapback/schema.q](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/snapback/schema.q) | 35 |
| [snapback/social.q](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/snapback/social.q) | 153 |
| [snapback/worker.mjs](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/snapback/worker.mjs) | 56 |
| [src/chat.tsx](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/src/chat.tsx) | 586 |
| [src/common.tsx](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/src/common.tsx) | 56 |
| [src/device.ts](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/src/device.ts) | 9 |
| [src/device.web.ts](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/src/device.web.ts) | 11 |
| [src/media.tsx](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/src/media.tsx) | 23 |
| [src/media.web.tsx](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/src/media.web.tsx) | 20 |
| [src/post.tsx](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/src/post.tsx) | 174 |
| [src/session.tsx](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/src/session.tsx) | 135 |
| [tsconfig.json](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/tsconfig.json) | 1 |

## Shutdown and retained state

[Every started server/worker PID](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/pids.jsonl) and [shutdown receipt](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/evidence/shutdown.json) are retained. Only recorded active task PIDs were stopped; no pattern kill was used. The fresh canonical scale database and its assets remain in scale-instance/.snapback4/ for later inspection or the separate M7 session. Development test residue is confined to the main .snapback4/ store. Probe clones are separately named.

[Milestone diary](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/diary.md) · [Essay written before the numerical tally](/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/essay.md)

end=1789392512
