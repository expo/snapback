# Clique — final report

Lane `astra-clique-snapback4-full-20260913`; model `gpt-6-astra`; effort `medium`. Public pins: `snapback4@0.4.2`, `snapback4-expo@0.4.2`. No source checkout or sibling lane was inspected.

start=1790385436

All seven requested milestone suites and choreography segments are green. M7 was not attempted. The fresh-instance scale replay and post-fix invariant verification passed.

## Milestone clocks and evidence

The end below is the logged milestone boundary; M8 includes final verification and evidence packaging. First retained hash-bound green times are shown separately; total lane wall is 15440 seconds. Replay clocks overlap some M8 work and must not be added to these milestones as authoring time.

| Milestone | Status | Start epoch | End epoch | First retained green epoch | Wall seconds | Suite IDs | Choreography passed/implemented | Native |
|---|---|---:|---:|---:|---:|---:|---:|---|
| M1 | green | 1790385436 | 1790386107 | 1790386051.634 | 671.000 | 7 | 3/3 | [Hermes](artifacts/m1-ios) |
| M2 | green | 1790386107 | 1790386432 | 1790386428.652 | 325.000 | 22 | 9/9 | [Hermes](artifacts/m2-ios) |
| M3 | green | 1790386432 | 1790387151 | 1790387151.043 | 719.000 | 7 | 7/7 | [Hermes](artifacts/m3-ios) |
| M4 | green | 1790387151 | 1790387499 | 1790387499.069 | 348.000 | 5 | 5/5 | [Hermes](artifacts/m4-ios) |
| M5 | green | 1790387499 | 1790388484 | 1790388452.950 | 985.000 | 6 | 4/4 | [Hermes](artifacts/m5-ios) |
| M6 | green | 1790388484 | 1790389265 | 1790389223.939 | 781.000 | 5 | 1/1 | [Hermes](artifacts/m6-ios) |
| M7 | not-run | — | — | — | 0 | — | — | — |
| M8 | green | 1790389265 | 1790400876 | 1790389540.115 | 11611.000 | 6 | 5/5 | [Hermes](artifacts/m8-ios) |

- M1: [first green](evidence/frozen/m1-f7a331f8-f084-48a5-a032-6f81c938bd9b/receipts.jsonl), [hash-matching suite](evidence/frozen/m1-f7a331f8-f084-48a5-a032-6f81c938bd9b/m1-suite.json); latest retained green 2026-09-26T01:27:31.634Z.
- M2: [first green](evidence/frozen/m2-bb98ec73-3aea-4b20-9c6f-4ac62499cc52/receipts.jsonl), [hash-matching suite](evidence/frozen/m2-bb98ec73-3aea-4b20-9c6f-4ac62499cc52/m2-suite.json); latest retained green 2026-09-26T01:33:48.652Z.
- M3: [first green](evidence/frozen/m3-3daab861-e4a0-45ee-acd4-ea947b4e5e9b/receipts.jsonl), [hash-matching suite](evidence/frozen/m3-3daab861-e4a0-45ee-acd4-ea947b4e5e9b/m3-suite.json); latest retained green 2026-09-26T05:29:25.750Z.
- M4: [first green](evidence/frozen/m4-e2797b13-e4be-4fb3-a936-53e7bc2bbe3d/receipts.jsonl), [hash-matching suite](evidence/frozen/m4-e2797b13-e4be-4fb3-a936-53e7bc2bbe3d/m4-suite.json); latest retained green 2026-09-26T05:17:05.666Z.
- M5: [first green](evidence/frozen/m5-d538a789-a92c-4fd7-9eea-be9dacbe29f1/receipts.jsonl), [hash-matching suite](evidence/frozen/m5-d538a789-a92c-4fd7-9eea-be9dacbe29f1/m5-suite.json); latest retained green 2026-09-26T05:22:23.811Z.
- M6: [first green](evidence/frozen/m6-3726e718-f70b-43cf-bc2b-b0017ce47b0b/receipts.jsonl), [hash-matching suite](evidence/frozen/m6-3726e718-f70b-43cf-bc2b-b0017ce47b0b/m6-suite.json); latest retained green 2026-09-26T05:31:28.833Z.
- M8: [first green](evidence/frozen/m8-046bd4ee-d6a6-4782-90d6-da1cef4254fc/receipts.jsonl), [hash-matching suite](evidence/frozen/m8-046bd4ee-d6a6-4782-90d6-da1cef4254fc/m8-suite.json); latest retained green 2026-09-26T05:31:54.141Z.

Coverage: [manifest](evidence/coverage-manifest.json). Exact supplemental simulator statuses are preserved in [journey-record.json](journey-record.json); they are not relabeled as passing or struck from scope. M1–M5 suites also passed a post-M6 regression run.

## Replay and scale

| Run | Start | End | Wall seconds | Checkpoint verification/probe time recorded | Actions | Result |
|---|---:|---:|---:|---:|---:|---|
| Initial | 1790389265 | 1790390570 | 1304.482 | 24.453 | 167243 | pass |
| Later replay (recovered) | 1790390572 | 1790399087 | 8515.563 | 31.731 | 167243 | pass |

Each replay includes 86 starter actions and the hash-pinned 167,157-action scale log. Both use fresh stores and `--replay`, never the dev database. All per-entity, per-chat, per-user follow/conversation and group-member counts match; named O5 fixtures and named content are checked independently. The busy group was counted through 200 public API history pages at the full 10,000 messages. Final totals: 1,008 users, 50,228 posts, 100,015 messages, 1,002 conversations. See [final result](evidence/scale-final-result.json), [invariant verification](evidence/scale-final-verify-final.json), and the JSONL settle receipts. The unread block-count and local-inbox fixes were applied after the full replay, using a declared Quarry backfill on that same instance; all invariants and named entities were then reverified under the final schema ([post-fix proof](evidence/scale-postfix-result.json), [invariants](evidence/scale-postfix-verify-final.json)). This is not represented as a third fresh replay. The configured instrument does not supply a numeric calibrated replay cap; no cap-fraction score is invented.

Fresh browser acquisition for u0500: 5.602 seconds; browser RSS 1213.5 MiB. [Cold-sync proof](evidence/scale-final-cold-sync.json). All 100 conversations rendered online and 100 survived a cold offline reload. The previous ungated attempt took 69.894 seconds; both attempts are retained.

Read anchors use 3 warm-ups followed by 20 sequential requests at each checkpoint. These are diagnostics, not the hidden rotated grader probes.

| Read | 10% p95 ms | 50% p95 ms | Full p95 ms | Full/10% | Midpoint at/below endpoint line |
|---|---:|---:|---:|---:|---|
| home500 | 3.072 | 2.411 | 4.393 | 1.43 | true |
| home5 | 3.012 | 2.721 | 5.112 | 1.70 | true |
| celebrityHome | 2.920 | 2.435 | 5.217 | 1.79 | true |
| messageSearch | 3.641 | 2.435 | 5.236 | 1.44 | true |
| busyFirstPage | 4.048 | 2.752 | 5.769 | 1.43 | true |
| insights | 2.321 | 1.617 | 2.785 | 1.20 | true |
| trending | 2.475 | 1.722 | 3.409 | 1.38 | true |

Full-scale page-50/first-page p95 ratio: 1.27 ([proof](evidence/scale-final-page50.json)). Celebrity/five-follower-author post acknowledgement p95 ratio: 1.22 ([disposable snapshot proof](evidence/scale-final-write-probe.json)). Both satisfy the published 3x bound.

Full Following 500/5 ratio: 0.86. Celebrity-follower/5 ratio: 1.02. The raw midpoint flags are retained; no overall performance score is claimed.

## Additional verification

- Scheduled 2-minute digest with no connected clients: exact counts; no contribution from removed membership or tombstones; one emission across a mid-period restart; no digest in the quiet next period. [Proof](evidence/m8-digest-proof.json).
- Cold browser reload: ordinary viewed media survives, once-only bytes do not; two pending messages survive reload, flush in server order without duplicates, and reach read. [Proof](evidence/m8-offline-depth.json).
- Cached deleted photo purges after sync and remains absent on an offline reload. [Proof](evidence/m8-revocation-depth.json). Server-only message/asset expiry is separately recorded in [M5 proof](evidence/m5-server-expiry.txt).
- Four hundred messages across ordinal blocks: unread totals 300, then 150 after a partial read, 149 after deletion, and zero after final read. [Proof](evidence/m8-unread-block-proof.json).
- Exact recipient-set progress, including later joins and removal, and 65 unread messages clearing consistently. [Recipient proof](evidence/m8-recipient-proof.json), [unread proof](evidence/m8-unread-depth.json).
- Fresh starter-only Alice insights are exactly 3 posts, 2 likes received, 1 repost received, 1 reply received, 4 followers, and 2 following. [Proof](evidence/m8-starter-insights.json).
- TypeScript and Quarry checks, web export and every required Hermes export pass. Native artifact paths, sizes and SHA-256 hashes are in [journey-record.json](journey-record.json).

## Corrections, accounting and gaps

Explicitly attributed correction/diagnostic log entries: {"environment":6,"agent-error":28,"ambiguous":3}. These are log-entry counts, not a reconstructed count of independent defects. No confirmed Snapback 4 platform blocker was established. Main loops involved React lifetimes, receipt coverage/index alignment, replay argument identity and test isolation. Full entries and evidence pointers are in [run-log.md](run-log.md) and [run-record.json](run-record.json).

- Cold offline conversation identity and history remain available. Unread totals whose expiry-aware source coverage is unavailable are omitted on a cold offline reload; online totals are authoritative. Browser RSS is reported, not described as small or as a universal memory bound.
- The later replay suffered ECONNRESET after roughly 108,000 actions. Recovery reused hash-bound settled receipts on the same initially fresh instance; its original clock includes the interruption. The first complete replay was uninterrupted. The root cause of the reset is unproven; see evidence/scale-final-interrupted-result.json.
- Reaction chips show the first 50 distinct emoji aggregates. A conversation accumulating more than 50 distinct emoji through historical membership has no continuation control.
- No iOS simulator interaction proof was required or run; each requested milestone has a Hermes export. The harness records supplemental simulator evidence as not-recorded, with requiredForGreen:false.
- No hidden grader or official rotated performance probe set was available. Read timings here are builder anchors, not an official O5 score. Celebrity write acknowledgements and page-50 versus first-page full-scale reads are recorded separately as builder diagnostics.
- Native Codex usage streams and driver custody were not supplied inside the permitted lane. Token totals and phase counts are null; no estimates or token-efficiency claims are made. Full post-grading record composition remains external.
- An earlier M6 choreography pass survives only as evidence/m6-choreo-run3.txt; its JSONL was overwritten before receipt preservation was added. The M6 table therefore uses the first retained hash-bound green, not a reconstructed earlier timestamp.
- The supplied schema for a complete scoring record requires a grading session and driver metering/clock artifacts. This builder-only record validates the base run schema; it does not claim complete scored-record validation.
- A supplemental probe expected immediate media purge on membership leave and failed while an already-open blob stayed visible. The brief explicitly retains delivered history and specifies media revocation for view-once, deletion and expiry. The corrected delete-for-everyone cache-revocation proof passes; no broader leave-byte guarantee is claimed.
- The runtime posture is a loopback development server, including documented dev-only administrative seams. No hosted deployment, independent package qualification, or real APNs/FCM delivery is claimed.

The base run-record schema validates. Tokens and phase splits are honest nulls, not prose estimates. [Validation](evidence/run-record-validation.json). The essay was written before this tally: [essay.md](essay.md).

## Hand-authored file line counts

Physical source/test lines in files created or maintained in this lane, after formatting. Excludes installed dependencies, frozen UI/choreography, generated API/config Quarry, duplicated proof/replay schemas, assets, exports and evidence. This is a ceremony count, not a keystroke estimate. Total 6055 lines across 81 files.

| File | Lines |
|---|---:|
| [app.json](app.json) | 27 |
| [app/_layout.tsx](app/_layout.tsx) | 62 |
| [app/chat/[id].tsx](app/chat/[id].tsx) | 9 |
| [app/chat/new.tsx](app/chat/new.tsx) | 1 |
| [app/chats.tsx](app/chats.tsx) | 1 |
| [app/conversation/[handle].tsx](app/conversation/[handle].tsx) | 6 |
| [app/conversation/group/[group]/index.tsx](app/conversation/group/[group]/index.tsx) | 6 |
| [app/conversation/group/[group]/settings.tsx](app/conversation/group/[group]/settings.tsx) | 6 |
| [app/index.tsx](app/index.tsx) | 1 |
| [app/insights.tsx](app/insights.tsx) | 45 |
| [app/post/[id].tsx](app/post/[id].tsx) | 6 |
| [app/profile/[handle].tsx](app/profile/[handle].tsx) | 6 |
| [app/profile/edit.tsx](app/profile/edit.tsx) | 1 |
| [app/search.tsx](app/search.tsx) | 1 |
| [app/settings.tsx](app/settings.tsx) | 12 |
| [package.json](package.json) | 44 |
| [scripts/acceptance-m2.mjs](scripts/acceptance-m2.mjs) | 214 |
| [scripts/acceptance-m3.mjs](scripts/acceptance-m3.mjs) | 129 |
| [scripts/acceptance-m4.mjs](scripts/acceptance-m4.mjs) | 95 |
| [scripts/acceptance-m5.mjs](scripts/acceptance-m5.mjs) | 79 |
| [scripts/acceptance-m6.mjs](scripts/acceptance-m6.mjs) | 160 |
| [scripts/acceptance-m8.mjs](scripts/acceptance-m8.mjs) | 119 |
| [scripts/acceptance.mjs](scripts/acceptance.mjs) | 176 |
| [scripts/acquisition-selector-check.mjs](scripts/acquisition-selector-check.mjs) | 26 |
| [scripts/api.mjs](scripts/api.mjs) | 41 |
| [scripts/choreo.mjs](scripts/choreo.mjs) | 32 |
| [scripts/config.mjs](scripts/config.mjs) | 25 |
| [scripts/custom-client-demo.mjs](scripts/custom-client-demo.mjs) | 74 |
| [scripts/digest-proof.mjs](scripts/digest-proof.mjs) | 207 |
| [scripts/expiry-proof.mjs](scripts/expiry-proof.mjs) | 62 |
| [scripts/final-scale-run.mjs](scripts/final-scale-run.mjs) | 60 |
| [scripts/freeze-evidence.mjs](scripts/freeze-evidence.mjs) | 77 |
| [scripts/inspect-chat.mjs](scripts/inspect-chat.mjs) | 18 |
| [scripts/inspect-history.mjs](scripts/inspect-history.mjs) | 13 |
| [scripts/inspect.mjs](scripts/inspect.mjs) | 30 |
| [scripts/offline-depth.mjs](scripts/offline-depth.mjs) | 140 |
| [scripts/offline-proof.mjs](scripts/offline-proof.mjs) | 56 |
| [scripts/order-browser.mjs](scripts/order-browser.mjs) | 62 |
| [scripts/recipient-proof.mjs](scripts/recipient-proof.mjs) | 54 |
| [scripts/recover-sample-media.mjs](scripts/recover-sample-media.mjs) | 49 |
| [scripts/regression.mjs](scripts/regression.mjs) | 16 |
| [scripts/replay.mjs](scripts/replay.mjs) | 209 |
| [scripts/report.mjs](scripts/report.mjs) | 320 |
| [scripts/reset-choreo.mjs](scripts/reset-choreo.mjs) | 21 |
| [scripts/revocation-depth.mjs](scripts/revocation-depth.mjs) | 70 |
| [scripts/scale-cold-sync.mjs](scripts/scale-cold-sync.mjs) | 90 |
| [scripts/scale-page50.mjs](scripts/scale-page50.mjs) | 47 |
| [scripts/scale-postfix-verify.mjs](scripts/scale-postfix-verify.mjs) | 32 |
| [scripts/scale-verify.mjs](scripts/scale-verify.mjs) | 193 |
| [scripts/scale-write-probe.mjs](scripts/scale-write-probe.mjs) | 57 |
| [scripts/scale.mjs](scripts/scale.mjs) | 89 |
| [scripts/screenshots.mjs](scripts/screenshots.mjs) | 18 |
| [scripts/seed.mjs](scripts/seed.mjs) | 109 |
| [scripts/setup.mjs](scripts/setup.mjs) | 40 |
| [scripts/start-backend.mjs](scripts/start-backend.mjs) | 16 |
| [scripts/start-proof.mjs](scripts/start-proof.mjs) | 25 |
| [scripts/start-scale-web.mjs](scripts/start-scale-web.mjs) | 18 |
| [scripts/start-scale.mjs](scripts/start-scale.mjs) | 27 |
| [scripts/start-web.mjs](scripts/start-web.mjs) | 16 |
| [scripts/starter-insights-proof.mjs](scripts/starter-insights-proof.mjs) | 67 |
| [scripts/stop-servers.mjs](scripts/stop-servers.mjs) | 83 |
| [scripts/trending-proof.mjs](scripts/trending-proof.mjs) | 57 |
| [scripts/unread-block-proof.mjs](scripts/unread-block-proof.mjs) | 43 |
| [scripts/unread-depth.mjs](scripts/unread-depth.mjs) | 35 |
| [scripts/viewonce-browser.mjs](scripts/viewonce-browser.mjs) | 49 |
| [scripts/web-server.mjs](scripts/web-server.mjs) | 42 |
| [snapback/insights.q](snapback/insights.q) | 19 |
| [snapback/schema.q](snapback/schema.q) | 403 |
| [snapback/worker.mts](snapback/worker.mts) | 5 |
| [src/Chat.tsx](src/Chat.tsx) | 198 |
| [src/ChatSettings.tsx](src/ChatSettings.tsx) | 117 |
| [src/Conversation.tsx](src/Conversation.tsx) | 469 |
| [src/Feed.tsx](src/Feed.tsx) | 349 |
| [src/InboxLinks.tsx](src/InboxLinks.tsx) | 33 |
| [src/Pending.ts](src/Pending.ts) | 105 |
| [src/Profile.tsx](src/Profile.tsx) | 140 |
| [src/Search.tsx](src/Search.tsx) | 120 |
| [src/Video.tsx](src/Video.tsx) | 11 |
| [src/client.ts](src/client.ts) | 25 |
| [src/useInbox.ts](src/useInbox.ts) | 27 |
| [tsconfig.json](tsconfig.json) | 13 |

Resolved pins: [npm evidence](evidence/resolved-pins.json). Server lifecycle: [stop receipts](evidence/servers-stopped.json); only exact owned PIDs were stopped.

end=1790400876
