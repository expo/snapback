# Clique final report

Lane astra-clique-snapback4-full-20260913 · gpt-6-astra · effort=medium.

All requested milestones are green. M7 is not-run as instructed. Exact resolved public package pins: snapback4@0.2.25, snapback4-expo@0.2.16. Node 24.18.0 was invoked explicitly because the initial shell resolved Node 25.9.0.

start=1789561689

Final end epoch=1789566557.517; total lane wall=4868.517 seconds, including orientation, replay, verification and reporting. Milestone end is its timestamped boundary; first-green is the earliest retained green segment receipt, which binds its passing suite.

| Milestone | Status | Start epoch | End epoch | Wall seconds | First retained green epoch | Suite | Choreography |
|---|---|---:|---:|---:|---:|---|---|
| M1 | green | 1789561708 | 1789562080 | 372 | 1789562063.791 | 7 assertions / 5 tests | 3/3 |
| M2 | green | 1789562080 | 1789562627 | 547 | 1789562615.414 | 22 assertions / 10 tests | 9/9 |
| M3 | green | 1789562627 | 1789563119 | 492 | 1789563089.89 | 7 assertions / 5 tests | 7/7 |
| M4 | green | 1789563119 | 1789563444 | 325 | 1789563385.735 | 5 assertions / 4 tests | 5/5 |
| M5 | green | 1789563444 | 1789564161 | 717 | 1789564112.996 | 6 assertions / 6 tests | 4/4 |
| M6 | green | 1789564161 | 1789564641 | 480 | 1789564443.291 | 5 assertions / 4 tests | 1/1 |
| M8 | green | 1789564641 | 1789565476 | 835 | 1789565373.581 | 6 assertions / 3 tests | 5/5 |
| M7 | not-run | — | — | — | — | Separate future session | — |

Coverage is in [coverage-manifest.json](coverage-manifest.json). Per-milestone suite reports, coverage and original JSONL choreography receipts are under evidence/. All implemented required browser checks pass. No structurally impossible browser check was relabeled or skipped. Simulator evidence remains not-recorded/supplemental under the environment's Hermes-export bar.

## Replay

Fresh scale-instance on port 49362, --replay. Real signup, real media upload, one settled action before the next. Start=1789565494.929; end=1789566406.513; wall including verification=911.584 seconds; probe/verification exclusion=33.589 seconds; execution wall=877.995 seconds. Operational replay safety ceiling: 14400 seconds; no calibrated scoring cap is invented. Settled=167157/167157; verification=passed. Fixture SHA-256=sha256:b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9. See [receipt](evidence/scale-replay/receipt.json), checkpoint verification files and per-action settle receipts.

The final independent audit matched 1008 users, 50228 posts, 100015 messages, 1002 conversations and 5921 follow edges, plus every manifest entity count, per-chat count, user follow/membership count, and named fixtures. The busy chat was fully paged through the API. Named messages, reactions, quotes and media bytes were checked. Both checkpoint prefixes passed before replay resumed. Cold initial sync at the final corpus took 8290.1 ms.

Read timings use 3 warm-ups plus 20 sequential samples per query; they are unscored diagnostics, not the hidden rotated probe set. Celebrity write-path and grader-secret probes were not self-scored.

## Native artifacts

- M1: [Hermes bundle](artifacts/m1-ios/_expo/static/js/ios/entry-315b6bb15e04fe7fe860f6009bbb9ccd.hbc)
- M2: [Hermes bundle](artifacts/m2-ios/_expo/static/js/ios/entry-e189a890f7cbb4dde898d4cff1e36011.hbc)
- M3: [Hermes bundle](artifacts/m3-ios/_expo/static/js/ios/entry-b80d202401a55cd9dbccc71a506233b0.hbc)
- M4: [Hermes bundle](artifacts/m4-ios/_expo/static/js/ios/entry-1d8eb330fc83f74de917ad9f7593d486.hbc)
- M5: [Hermes bundle](artifacts/m5-ios/_expo/static/js/ios/entry-4977405b79b39b5b74483bd927fb68b3.hbc)
- M6: [Hermes bundle](artifacts/m6-ios/_expo/static/js/ios/entry-dac6d5ac3ee1d0e36b1c6452046aeff2.hbc)
- M8: [Hermes bundle](artifacts/m8-ios/_expo/static/js/ios/entry-642a6c26906cb8c0fda522b889ac86c9.hbc)

## Corrections

Recorded correction events by attribution: {"agent-error":17,"environment":2,"ambiguous":0,"snapback4-defect":0}. This is the explicit event ledger, not an inferred token or efficiency score. Several events consolidate adjacent compile/type fixes. Exact chronology and evidence pointers are in run-log.md.

1. **environment** — error/workaround source=diagnostic attribution=environment evidence=lib/json-schema.mjs; copied harness lacked ../../lib/json-schema.mjs; supplied AJV2020 validator with no browser assertion changes. PATH Node 25.9 differs from overlay, using explicit Node24.18.0. Copied read-only dirs required u+w before npm install. (lib/json-schema.mjs)
2. **agent-error** — knowledge lookup source=package README/guide attribution=agent-error evidence=evidence/guide-feeds.txt,evidence/m2-check.txt; feedRepost expects feedPosts ref, corrected bridge to resolve source event. (evidence/guide-feeds.txt,evidence/m2-check.txt)
3. **agent-error** — correction-loop source=diagnostic attribution=agent-error evidence=evidence/m2-acceptance.log; successful web export still crashed at Image.resolveAssetSource on RN Web; use Expo Asset for shared poster URI. (evidence/m2-acceptance.log)
4. **agent-error** — correction-loop source=diagnostic attribution=agent-error evidence=evidence/m2-choreo.log; harness expects feed tabs reachable from profiles; moved tab navigation into persistent app shell. (evidence/m2-choreo.log)
5. **agent-error** — verification error source=diagnostic attribution=agent-error evidence=evidence/m2-choreo.log; acceptance pagination writes ran concurrently with choreography and displaced retained live-post witness from first page; rerun choreography alone after suite settles. No application change for this test interference. (evidence/m2-choreo.log)
6. **agent-error** — correction-loop source=diagnostic attribution=agent-error evidence=evidence/m3-receipt-debug2.log; delivered state failed because reload followed by offline blocked lazy web-device JS chunk and returned sign-in error; static platform-specific web client removes startup chunk fetch. (evidence/m3-receipt-debug2.log)
7. **agent-error** — correction-loop source=diagnostic attribution=agent-error evidence=evidence/m4-acceptance.log; suite read server before predicted media write settled; added bounded authoritative query settlement. Backend row and asset valid. (evidence/m4-acceptance.log)
8. **agent-error** — correction-loop source=diagnostic attribution=agent-error evidence=evidence/m4-choreo.log; recipient bubble preceded asset URL and harness chose viewer fallback before inline video mounted; mount inline video from message kind immediately while asset loads. (evidence/m4-choreo.log)
9. **agent-error** — M5 correction agent-error JSX callback delimiters; fixed and typecheck passed evidence/m5-typecheck.txt (run-log.md)
10. **agent-error** — M6 correction-loop source=diagnostic attribution=agent-error evidence=evidence/m6-check.txt; Quarry helper needs typed parameter and point predicate must compare a scalar. Corrected; check passed. (evidence/m6-check.txt)
11. **agent-error** — M6 correction-loop source=package README/guide attribution=agent-error evidence=snapback/worker.mjs; effect names are global notify, not module-qualified chat.notify. Corrected handler and stopped owned worker 2016 for supervised restart. (snapback/worker.mjs)
12. **agent-error** — M6 correction-loop source=diagnostic attribution=agent-error evidence=evidence/sample-replay/result.json; replay of media uploaded fresh bytes with same write id. Persisted upload and settled-action ledgers; repeat now passes. Worker replacement PID 20411 recorded. (evidence/sample-replay/result.json)
13. **agent-error** — M8 correction-loop source=diagnostic attribution=agent-error evidence=evidence/m8-check.txt; schedule required digest.daily qualification; fixed. UI Read union includes loading; narrowed denied branch and typecheck passed. (evidence/m8-check.txt)
14. **agent-error** — M8 correction-loop source=fixture attribution=agent-error evidence=evidence/m8-choreo-first-failure.log; home page lacked chat rows required for unread-state choreography; added recent-chats strip. (evidence/m8-choreo-first-failure.log)
15. **agent-error** — M8 correction-loop source=fixture attribution=agent-error evidence=evidence/m3-regression-first-failure.log; member picker empty search sorted only its first page, hiding Dave. Restored registration-order allPeople list for empty query; indexed search remains for typed queries. (evidence/m3-regression-first-failure.log)
16. **agent-error** — correction source=diagnostic attribution=agent-error evidence=evidence/m8-boundary.json; boundary shell used scale workdir, so moved its diary/log append to lane root and reran boundary there. (evidence/m8-boundary.json)
17. **agent-error** — recording correction source=diagnostic attribution=agent-error evidence=scripts/choreo.mjs,evidence/milestones.json; repeated choreography used same receipt path. Added archival for future reruns. Final first-green times explicitly mean earliest retained proof; no earlier M8 timestamp invented. (scripts/choreo.mjs,evidence/milestones.json)
18. **agent-error** — reporting correction source=diagnostic attribution=agent-error evidence=evidence/scale-doctor.txt; root-relative receipt inspection ran in scale workdir and refused ENOENT; reran in root, no data mutation. (evidence/scale-doctor.txt)
19. **environment** — recording correction source=diagnostic attribution=environment evidence=lib/json-schema.mjs,evidence/run-record-validation.json; supplied shared validator now checks date-time strings as well as structure instead of allowing AJV unknown-format warnings. (lib/json-schema.mjs,evidence/run-record-validation.json)

## Scope, limits and gaps

- No requested milestone was dropped; M7 was intentionally excluded. No demonstrated Snapback 4 capability gap remained in the implemented scope.
- The frozen harness lacked its shared JSON-schema module. The lane supplied real AJV2020 validation through lib/json-schema.mjs; browser assertions were unchanged. This is an environment workaround, not an instrument skip.
- The custom API demo and 50-action replay pass. The frozen action-schema validator checked syntax; authored independent API checks checked resulting state. No unavailable secret grader result is claimed.
- Native artifacts are Hermes exports, not simulator/device runtime proofs or signed store packages. Expo Go uses an online fallback; the installed native module is needed for native offline behavior.
- Push is a durable logged provider seam, as scoped, without APNs/FCM delivery. The app is a local loopback development deployment, not an Internet production rollout.
- Public rows and full acquired chat history favor offline completeness over minimal acquisition. The recorded cold-sync measurements expose that cost; unbounded production growth would need explicit residency policy.
- Global online search is available as membership-batched API search; the app's global message screen searches its held replica and labels incomplete results.
- Some earlier choreography reruns overwrote their original JSONL path. Archived milestone summaries preserve earlier M2–M6 boundaries; M8’s first-green column is the earliest retained passing receipt, not a reconstruction of its earlier passing run. The runner now archives receipts before reruns.
- Token totals and fine-grained wall phase splits are null rather than reconstructed. The surrounding Codex harness owns token accounting.
- Source uses many compact physical lines; LOC is not a semantic complexity estimate. Generated types, copied UI/harness/fixtures, exports and dependency sources are excluded.

## Hand-authored source/test lines

Total 876 physical lines across 55 files. Includes blank lines, without pretty-print expansion. Configuration/docs are not counted as source; generated feed recipe contributes only its one manually changed bound.

| File | Lines |
|---|---:|
| app/_layout.tsx | 1 |
| app/chats.tsx | 1 |
| app/conversation/[handle].tsx | 1 |
| app/conversation/group/[group]/index.tsx | 1 |
| app/conversation/group/[group]/settings.tsx | 1 |
| app/conversation/id/[id]/index.tsx | 1 |
| app/conversation/id/[id]/settings.tsx | 1 |
| app/index.tsx | 11 |
| app/insights.tsx | 2 |
| app/new-chat.tsx | 1 |
| app/post/[id].tsx | 2 |
| app/profile/[handle].tsx | 9 |
| app/profile/edit.tsx | 5 |
| app/search.tsx | 2 |
| app/settings.tsx | 4 |
| lib/json-schema.mjs | 4 |
| public/sw.js | 4 |
| scripts/acceptance-m2.mjs | 21 |
| scripts/acceptance-m3.mjs | 11 |
| scripts/acceptance-m4.mjs | 10 |
| scripts/acceptance-m5.mjs | 10 |
| scripts/acceptance-m6.mjs | 7 |
| scripts/acceptance-m8.mjs | 7 |
| scripts/acceptance.mjs | 27 |
| scripts/boundary.mjs | 3 |
| scripts/build.mjs | 2 |
| scripts/choreo.mjs | 6 |
| scripts/configure.mjs | 3 |
| scripts/custom-client-demo.mjs | 8 |
| scripts/debug-receipts.mjs | 4 |
| scripts/digest-proof.mjs | 7 |
| scripts/offline-proof.mjs | 2 |
| scripts/replay.mjs | 22 |
| scripts/report.mjs | 8 |
| scripts/scale-run.mjs | 6 |
| scripts/seed.mjs | 30 |
| scripts/serve-web.mjs | 3 |
| scripts/setup.mjs | 4 |
| scripts/verify-scale.mjs | 16 |
| snapback/chat.q | 241 |
| snapback/digest.q | 51 |
| snapback/feed.q | 1 |
| snapback/insights.q | 50 |
| snapback/reactions.q | 25 |
| snapback/schema.q | 32 |
| snapback/social.q | 108 |
| snapback/worker.mjs | 6 |
| src/chat.tsx | 20 |
| src/client.ts | 24 |
| src/client.web.ts | 7 |
| src/shell.tsx | 22 |
| src/social.tsx | 15 |
| src/trending.tsx | 2 |
| src/Video.tsx | 2 |
| src/Video.web.tsx | 2 |

[Diary](diary.md) · [Essay](essay.md) · [API](API.md) · [Run record](run-record.json)

All recorded lane server PIDs were stopped after verification; see evidence/process-cleanup.json.

end=1789566557.517
