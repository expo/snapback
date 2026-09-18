# Clique final report

Lane astra-clique-snapback4-full-20260913; gpt-6-astra, effort=medium.

M1, M2, M3, M4, M5, M6 and M8 are green. M7 is not-run by explicit instruction. Nothing was struck. All final suite hashes match their green choreography receipts. Each requested milestone has an iOS Hermes artifact.

## Clocks and statuses

Raw lane start=1789755596; end=1789762696; total wall=7100 seconds. M1 includes the 28 seconds before its explicit milestone-start log line. First-green epochs come directly from the original successful harness summaries. Boundary end is the timestamped run-log boundary, which can include further corrections after first green. Final verification can occur later for an evidence repair.

| Milestone | Status | Start epoch | First-green epoch | Boundary end epoch | To first green (s) | Boundary wall (s) | Final verification epoch |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| M1 | green | 1789755596 | 1789756148.526 | 1789756183 | 552.526 | 587 | 1789756148.526 |
| M2 | green | 1789756183 | 1789756739.036 | 1789756765 | 556.036 | 582 | 1789756739.036 |
| M3 | green | 1789756765 | 1789757320.204 | 1789757428 | 555.204 | 663 | 1789757397.559 |
| M4 | green | 1789757428 | 1789757811.964 | 1789757832 | 383.964 | 404 | 1789757811.964 |
| M5 | green | 1789757832 | 1789758352.971 | 1789758376 | 520.971 | 544 | 1789760575.762 |
| M6 | green | 1789758376 | 1789758917.061 | 1789759290 | 541.061 | 914 | 1789761752.727 |
| M8 | green | 1789759290 | 1789759558.874 | 1789760066 | 268.874 | 776 | 1789761810.672 |
| M7 | not-run | — | — | — | — | — | — |

Authoring milestones and the independent replay overlapped after M6; their inclusive walls must not be added. No milestone reached the four-hour safety limit. Token values are null because the external harness-native event stream was not exposed inside this lane; none were estimated. Phase subdivisions and grader timings are likewise not invented.

## Acceptance and choreography

| Milestone | Suite / coverage | Final choreography | Checks | Optional instrument skips |
| --- | --- | --- | --- | --- |
| M1 | [suite](evidence/m1-suite.json) / [coverage](evidence/m1-coverage.json) | [JSONL](evidence/m1-choreo-2.jsonl) | 3/3; required 3 | none |
| M2 | [suite](evidence/m2-suite.json) / [coverage](evidence/m2-coverage.json) | [JSONL](evidence/m2-choreo-4.jsonl) | 9/9; required 9 | none |
| M3 | [suite](evidence/m3-suite.json) / [coverage](evidence/m3-coverage.json) | [JSONL](evidence/m3-choreo-4.jsonl) | 7/7; required 5 | none |
| M4 | [suite](evidence/m4-suite.json) / [coverage](evidence/m4-coverage.json) | [JSONL](evidence/m4-choreo-1.jsonl) | 5/5; required 5 | none |
| M5 | [suite](evidence/m5-suite.json) / [coverage](evidence/m5-coverage.json) | [JSONL](evidence/m5-choreo-2.jsonl) | 4/4; required 2 | none |
| M6 | [suite](evidence/m6-suite-1789761736969.json) / [coverage](evidence/m6-coverage.json) | [JSONL](evidence/m6-choreo-4.jsonl) | 1/1; required 1 | none |
| M8 | [suite](evidence/m8-suite-1789761782373.json) / [coverage](evidence/m8-coverage.json) | [JSONL](evidence/m8-choreo-3.jsonl) | 5/5; required 5 | none |

[Combined coverage](evidence/coverage-manifest.json) maps every suite-required assertion in the requested milestones. Native simulator receipts are supplemental and unclaimed, as allowed by the run instructions; the seven Hermes exports are the native deliverables. No required browser check was relabeled as an instrument skip.

Additional retained proofs: [edit/delete windows and revocation](evidence/m4-boundaries.json), [no-client expiry](evidence/m5-expiry.json), [view-once and search suite](evidence/m5-suite.json), [push/API/replay sample suite](evidence/m6-suite.json), [cold-offline web](evidence/m6-web-cold-offline.json), [scheduled digest and restart](evidence/m8-digest-proof.json), [same-account edits/reactions](evidence/m8-same-account-edits.json), [two queued messages across offline relaunch](evidence/web-queued-restart.json), [settings permissions](evidence/settings-permissions.json), [delivery beyond the first inbox page](evidence/delivery-bound-proof.json).

## Independent scale replay

start=1789758926; end=1789762382; inclusive wall=3456s; verification/probe wall excluded=77.991s; replay wall excluding that work=3378.009s. Result: verified. The fresh persistent instance is scale-instance, port 49362, started with --replay (effects suppressed, schedule admission held). It replayed the three starter segments and all 167,157 scale actions, one authoritative settlement before the next. Documentary fixture timestamps were never used as server timestamps.

[Action receipts](evidence/scale-receipts.jsonl), [10% verification](evidence/scale-10pct-verification.json), [50% verification](evidence/scale-50pct-verification.json), [final verification](evidence/scale-final-verification.json), [clock/result](evidence/scale-result.json). The full scale hash was checked against the invariant manifest. Verification covers all application entity counts, every per-chat and per-user count, named O5 fixtures, busy-chat full API paging, and named profile/post/message content. Builder-owned API timings are retained; hidden rotated grader probes and an O5 score are not claimed. After that clock ended (adoption start=1789762476, end=1789762597), [M8 scale adoption](evidence/scale-m8-adoption.json) applied the final schema and backfill, verified all six insight totals and all seven daily buckets for all 1,008 profiles, checked exact top-ten ranking and the 100-chat delivery query, and confirmed all original entity counts remained unchanged.

## Packages and native artifacts

Resolved snapback4=0.2.30 and snapback4-expo=0.2.21, public npm packages. Node=24.18.0; Expo=57.0.22. [Resolved dependency evidence](evidence/resolved-packages.json). Backend business logic is Quarry; the JavaScript worker only logs the provider seam.

| Milestone | Hermes bundle | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| M1 | [bundle](artifacts/m1-ios/_expo/static/js/ios/entry-2dfa41dc732eb2c9468134218ef21bae.hbc) | 2689117 | sha256:5c0c6f1581a1771a1fe2a99f63094b7ffaa042fbfae44f6dca8af83984f7b203 |
| M2 | [bundle](artifacts/m2-ios/_expo/static/js/ios/entry-a307e2538d7884dbb14186bf31f0a1d7.hbc) | 2714220 | sha256:4d78172f2e9ada599f2b19a71382e2d1147828b4186a4d4f116ebf075a8288b8 |
| M3 | [bundle](artifacts/m3-ios/_expo/static/js/ios/entry-b1a9c073debf6c3c38e2547a58fd015b.hbc) | 2738220 | sha256:c6edb8bd105ed7cb4c5d1ffacde1144ccdbe1149b2bd22c656334fb1dc88430e |
| M4 | [bundle](artifacts/m4-ios/_expo/static/js/ios/entry-ccfe394a589ac079a22ae76fa622c423.hbc) | 2744667 | sha256:92d7cd0b263a21577a09a3537c1388b34a841917868f786906cf1628de901693 |
| M5 | [bundle](artifacts/m5-ios/_expo/static/js/ios/entry-bd1086570a0b48f2e3a14165aec01693.hbc) | 2753490 | sha256:5b00918cc9bbb4760ddb75cedbefb60289bfb72e02b9179043e575e2adb1b6a1 |
| M6 | [bundle](artifacts/m6-ios/_expo/static/js/ios/entry-df9f0d7e1ee84f1764e702e6b54e8fda.hbc) | 2754347 | sha256:e7a9589675a5281a3d5f5f044875ff8a5ead014c4f08d9bb054390d80dce73a3 |
| M8 | [bundle](artifacts/m8-ios/_expo/static/js/ios/entry-bc84b41a944b8723e8080e488a7cabcb.hbc) | 2762638 | sha256:87fac9221a550c620054b7c33a71a3816b1c70632ac316502a322b8e520b72e9 |

## Corrections and attribution

16 integration/correction episodes are listed below: 13 agent-error, 2 environment, 1 ambiguous, and 0 confirmed snapback4-defect. Initial dialect/compiler corrections (M4/M5/M8 and write-ID encoding) are recorded separately in run-log.md rather than presented as platform defects.

- **agent-error:** M1: Router Stack retained duplicate profile IDs; changed to Slot. [Evidence](evidence/m1-acceptance-output.txt).
- **agent-error:** M1: CI disabled Metro watch; restarted owned web process with watch enabled. [Evidence](evidence/web-server.log).
- **environment:** M1: copied harness required adjacent metering module; linked read-only instrument support paths. [Evidence](evidence/m1-choreo-output-1.txt).
- **agent-error:** M2: native asset resolver assumed on web; used Metro web asset URI. [Evidence](evidence/web-server.log).
- **agent-error:** M2: fixture path and profile-to-feed navigation adapter corrected. [Evidence](evidence/m2-choreo-output-1.txt).
- **agent-error:** M2: navigation adapter needed its required schemaVersion. [Evidence](evidence/m2-choreo-output-2.txt).
- **environment:** M2: browser navigation interruption; endpoint healthy and retry passed. [Evidence](evidence/m2-choreo-output-3.txt).
- **agent-error:** M3: Reply action moved inside the contract bubble wrapper. [Evidence](evidence/m3-choreo-output-1.txt).
- **agent-error:** M3: quote jump made immediate to satisfy actual target visibility. [Evidence](evidence/m3-choreo-output-2.txt).
- **agent-error:** M6: push oracle compared an obsolete fixture display name; uses current profile. [Evidence](evidence/m6-suite-output-1.txt).
- **agent-error:** M6: existing DM route incorrectly required an online mutation on cold reopen. [Evidence](evidence/m6-offline-output-1.txt).
- **ambiguous:** M6: send-control timeout during one later run; separate durable queue proof and final harness passed. [Evidence](evidence/m6-choreo-output-2.txt).
- **agent-error:** Post-boundary evidence audit: M5 suite was overwritten during timed choreography; archived suites and reran hash-valid proof. [Evidence](evidence/m5-choreo-2.jsonl).
- **agent-error:** Final specification audit: narrowed group admin-only gate to name, description and disappearing settings. [Evidence](evidence/settings-permissions.json).
- **agent-error:** Final scale audit: delivery receipts covered only the first inbox page; added a complete bounded membership query and proved 60-chat coverage. [Evidence](evidence/delivery-bound-proof.json).
- **agent-error:** M8 scale adoption: explicit CLI backfill raced the running host's derived rebuild and received E_STORE database is locked; stopped the recorded host, backfilled offline and restarted replay mode. [Evidence](evidence/scale-m8-adoption-output.txt).

Other startup issues: the copied read-only harness needed writable lane permissions; an immediate restart check raced server readiness; and an automatically rejected shell removal was replaced with targeted deletion of the generated starter files. No user confirmation or outside-lane inspection was used. All failed attempt logs and receipts were retained.

## Hand-authored source and test size

5751 physical lines across 76 files. This is a physical-line inventory, not a complexity or fairness claim; TypeScript and JavaScript were formatted before the final inventory. Excluded: installed dependencies, frozen UI/choreography/fixture copies, feed recipe, generated API/runtime/config outputs, build artifacts, proof-store copies and prose documents. The generated Metro scaffold contributes only its two authored block-list lines. Byte counts expose compact formatting.

| File | Authored physical lines | Bytes |
| --- | ---: | ---: |
| app.json | 28 | 535 |
| app/_layout.tsx | 10 | 191 |
| app/chats.tsx | 1 | 48 |
| app/conversation/[handle].tsx | 7 | 230 |
| app/conversation/group/[group]/index.tsx | 7 | 248 |
| app/conversation/group/[group]/settings.tsx | 7 | 257 |
| app/conversation/id/[id].tsx | 7 | 303 |
| app/index.tsx | 29 | 940 |
| app/insights.tsx | 1 | 55 |
| app/new-chat.tsx | 1 | 50 |
| app/post/[id].tsx | 23 | 794 |
| app/profile/[handle].tsx | 25 | 772 |
| app/profile/edit.tsx | 8 | 328 |
| app/search.tsx | 80 | 2489 |
| app/settings.tsx | 10 | 292 |
| index.js | 1 | 28 |
| metro.config.js | 2 | scaffold delta |
| package.json | 49 | 1565 |
| public/sw.js | 43 | 1266 |
| scripts/acceptance-m1.mjs | 142 | 4995 |
| scripts/acceptance-m2.mjs | 227 | 7664 |
| scripts/acceptance-m3.mjs | 111 | 3619 |
| scripts/acceptance-m4.mjs | 71 | 2461 |
| scripts/acceptance-m5.mjs | 81 | 2411 |
| scripts/acceptance-m6.mjs | 177 | 5800 |
| scripts/acceptance-m8.mjs | 162 | 5434 |
| scripts/acceptance.mjs | 2 | 112 |
| scripts/capture.mjs | 23 | 832 |
| scripts/choreo.mjs | 31 | 877 |
| scripts/cleanup.mjs | 90 | 2711 |
| scripts/configure-digest.mjs | 9 | 725 |
| scripts/configure.mjs | 11 | 723 |
| scripts/custom-client-demo.mjs | 83 | 2310 |
| scripts/delivery-bound-proof.mjs | 2 | 1377 |
| scripts/digest-proof.mjs | 197 | 6207 |
| scripts/m4-boundaries.mjs | 55 | 1583 |
| scripts/m5-expiry.mjs | 60 | 1761 |
| scripts/offline-proof.mjs | 60 | 1885 |
| scripts/offline-queue-proof.mjs | 96 | 2910 |
| scripts/proof-host.mjs | 70 | 2316 |
| scripts/push-worker.mjs | 31 | 887 |
| scripts/replay.mjs | 223 | 7347 |
| scripts/report.mjs | 415 | 20535 |
| scripts/same-account-proof.mjs | 65 | 1948 |
| scripts/scale-m8-adopt.mjs | 226 | 8161 |
| scripts/scale-run.mjs | 94 | 2759 |
| scripts/scale-verify.mjs | 202 | 7192 |
| scripts/seed.mjs | 116 | 4102 |
| scripts/settings-permissions-proof.mjs | 38 | 1101 |
| scripts/setup-identity.mjs | 53 | 1550 |
| scripts/start-scale.mjs | 25 | 861 |
| scripts/start-worker.mjs | 14 | 471 |
| scripts/start.mjs | 30 | 946 |
| scripts/suite.mjs | 91 | 2731 |
| snapback/chat.q | 286 | 13986 |
| snapback/digest.q | 49 | 2187 |
| snapback/insights.q | 45 | 2043 |
| snapback/schema.q | 32 | 1212 |
| snapback/social.q | 111 | 4583 |
| src/chat.tsx | 739 | 22332 |
| src/client.ts | 25 | 795 |
| src/device.ts | 9 | 466 |
| src/device.web.ts | 4 | 192 |
| src/insights.tsx | 71 | 2379 |
| src/LoadMore.tsx | 8 | 370 |
| src/LoadMore.web.tsx | 21 | 569 |
| src/offline-shell.ts | 1 | 37 |
| src/offline-shell.web.ts | 16 | 590 |
| src/pagination.ts | 4 | 135 |
| src/picker.ts | 24 | 753 |
| src/picker.web.ts | 25 | 868 |
| src/posts.tsx | 167 | 5336 |
| src/shell.tsx | 342 | 9354 |
| src/Video.tsx | 19 | 397 |
| src/Video.web.tsx | 18 | 303 |
| tsconfig.json | 13 | 310 |

## Candid limits and handoff

- This is a local development deployment, not a hosted production release. Finite caps are sized to the fixture envelope. The feed recipe and public post/like metadata have a substantial replica-acquisition cost; no hidden scale UI or native latency score is claimed.
- The message history horizon is 500 per chat, with online paging for older rows. Ordinary viewed-media retention is bounded to 64 MiB. Once-only responses are never durably retained.
- Digest work observes data in transactional chunks rather than one global snapshot. Its tested guarantees are scheduled no-client operation, period counts, authorization exclusion, tombstone exclusion and restart/idempotency behavior.
- Native artifacts are real Hermes exports using the exact published Expo arm. No simulator runtime proof, APNs/FCM delivery, independent binary qualification, or hidden grader result is claimed.
- Earlier first-green attestations remain in JSONL, but some original suite bodies were overwritten before the immutable-snapshot fix. Every final selected suite binding is valid; M5 was rerun specifically to repair its final binding.
- The run-record validates against the base protocol schema. The composed grading record requires an actual grader session and native metering provenance; those external records are not fabricated here.
- No published-platform capability gap prevented the requested milestone greens. Compiler completeness/residency notes and authored caps remain explicit operational constraints, not silently ignored errors.

[README](README.md) has start/configuration/seed instructions; [API](API.md) documents token issuance, expiry, revocation and third-party operations. [Diary](diary.md), [essay](essay.md), [run log](run-log.md), [machine record](run-record.json), and [line inventory](evidence/line-counts.json) retain the build account. The essay was written before this numeric tally. [Process cleanup](evidence/cleanup.json) records only owned PIDs.

end=1789762696
