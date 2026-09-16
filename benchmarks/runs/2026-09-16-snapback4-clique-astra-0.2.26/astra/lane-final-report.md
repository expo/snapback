# Clique lane report

Lane: astra-clique-snapback4-full-20260913. Model: gpt-6-astra, effort=medium. Exact resolved pins: snapback4@0.2.26 and snapback4-expo@0.2.17 (package-lock.json). Built alone from the public package surface in this lane. No M7 work.

start=1789586220

All seven requested milestones are green under the supplied suite + implemented required choreography bar. Every milestone has an iOS Hermes artifact. This is a web-green/build-artifact claim; M6/M8 simulator evidence is explicitly not recorded by the frozen summaries.

| Milestone | Status | Start epoch | Retained green epoch | Wall seconds | Suite | Choreography |
|---|---|---:|---:|---:|---|---|
| M1 | green | 1789586220 | 1789586610.284 | 390.284 | 5 pass | 3/3 required pass |
| M2 | green | 1789586634 | 1789587061.256 | 427.256 | 7 pass | 9/9 required pass |
| M3 | green | 1789587135 | 1789587640.441 | 505.441 | 5 pass | 7/5 required pass |
| M4 | green | 1789587699 | 1789588024 | 325.000 | 3 pass | 5/5 required pass |
| M5 | green | 1789588071 | 1789588485.543 | 414.543 | 5 pass | 4/2 required pass |
| M6 | green | 1789588618 | 1789589036.689 | 418.689 | 3 pass | 1/1 required pass |
| M8 | green | 1789589098 | 1789589824.019 | 726.019 | 3 pass | 5/5 required pass |
| M7 | not-run | — | — | — | Separate future session | — |

M1 starts at the lane origin, including orientation; its explicit milestone-start line was written 45 seconds later. End/green epochs come from retained segment-summary recordedAt; timestamped diary/bundle wrap-up boundaries are separately preserved in evidence/milestones.json. M8 was rerun after further corrections: its final retained green is reported, and the earliest transient green JSONL was overwritten before the runner gained archival. No earlier exact M8 first-green is invented. Raw elapsed run through this report is 4518.064 seconds, including independent replay and reporting; it is not a scored authoring statistic.

The per-milestone suite receipts and coverage manifests are evidence/mN-suite.json and evidence/mN-coverage.json. Choreography receipts are evidence/mN-choreo.jsonl with observation sidecars. Each final suite SHA-256 matches the hash captured by its choreography summary. Embedded setup identities are recovered byte-for-byte into evidence/setup-mN.json and their hashes checked.

## Scale and supplemental proofs

M6 fresh-instance replay: start=1789589071.102, end=1789589986.297, raw wall=915.195s; 167243 settled actions including 86 starter actions; invariant verification=true.

M8 fresh-instance replay: start=1789589628.649, end=1789590547.339, raw wall=918.690s; 167243 settled actions; invariant verification=true.

Both replays use real signup, sequential authoritative write receipts, all 13 verbs, fixture media, and dev --replay to suppress push and schedules. Exact verification covers entity counts, every per-user following/conversation count, every per-chat message count, every group size, named profiles/posts/messages/reactions/quotes, and named O5 fixtures. Busy-group history is fully paged. See scale*-verification.json, scale*-probes.json and scale*-settles.jsonl. The expected full state is 1,008 users, 50,228 posts, 100,015 messages, 5,921 follow edges, 5,008 active likes, 1,004 active reposts and 2,000 reactions.

The instrument's replay cap is still literally pilot-calibrated; cap utilization and cap exhaustion are not scored or invented. The first replay's probeSeconds field includes checkpoint verification and excludes final probe time from that subtotal; use its raw start/end wall as authoritative. The M8 replay separates checkpoint/final probe time. The two own replays overlap for part of execution, a host-load confound for builder timings; probes themselves run sequentially, with three warmups and twenty samples. These are builder observations, not hidden grader results.

Supplemental Node-replica proofs cover cold history, viewed media, held search, post-sync asset revocation, expiry with clients closed, durable offline pending messages, ordered once-only delivery, read receipts, and idempotent offline likes/reactions. They are not simulator substitutes. The scheduled M8 proof checks exact digest counts with clients closed, quiet user/period suppression, private-chat/tombstone exclusion and backend restart. It also checks Trending's rolling age exclusion, fresh like ranking and newest-first ties.

## Builder performance observations

| M8 probe p95 (ms) | 10% | 50% | Full |
|---|---:|---:|---:|
| history-page1 | 21.129 | 17.309 | 17.056 |
| history-page50 | not yet 50 pages | 15.526 | 18.081 |
| following-u0005 | 2.362 | 2.287 | 2.427 |
| following-u0500 | 2.752 | 2.476 | 2.809 |
| following-u0901 | 2.725 | 2.936 | 2.658 |
| global-search-server | 10.150 | 8.158 | 11.031 |
| insights | 1.855 | 1.915 | 1.772 |
| trending | 1.961 | 1.899 | 2.085 |

Full-corpus deep-page/page-1 ratio: 1.060. 500-follow/5-follow ratio: 1.157. Celebrity read ratio: 1.095. Celebrity write ratio: 0.496 (900 versus 5 followers). M8 cold sync: 6114.413ms; observed Node-client-plus-replica peak RSS: 384288KiB, excluding backend. M6 cold sync: 4897.707ms.

The literal Insights mid-curve bound was **not met**: observed 1.915ms versus straight-line bound 1.818ms. The full/10% ratio remains below 3, but this timing series does not justify an all-degradation-rules-pass or O5-pass claim. No timeout or query error occurred in these builder probes. Raw samples and concurrency/load caveats are retained. The celebrity write probe added 46 posts only after exact invariant verification; the M8 store therefore has those additional probe posts at shutdown.

## Artifacts and implementation

Native exports and SHA-256 hashes: evidence/native-artifacts.json. Paths: artifacts/m1-ios/_expo/static/js/ios/entry-be21ed93ba814444a8ce56f5122f29b8.hbc, artifacts/m2-ios/_expo/static/js/ios/entry-a2c44f7b44b15f2f784accbc286b2fcc.hbc, artifacts/m3-ios/_expo/static/js/ios/entry-e941728c1c9c27aeb7c4e3604784a155.hbc, artifacts/m4-ios/_expo/static/js/ios/entry-5a0247088823d2a7bf6902caa277ae66.hbc, artifacts/m5-ios/_expo/static/js/ios/entry-5eb458f99383e9d589aa6162cbbd21b4.hbc, artifacts/m6-ios/_expo/static/js/ios/entry-13a2bff3ca398d362b91acb6dce7b397.hbc, artifacts/m8-ios/_expo/static/js/ios/entry-ac08670e086bf97b4d9b24fb0f09ea8d.hbc. Final web export: artifacts/web. All native exports contain .hbc bundles. TypeScript and Quarry checks pass. API.md and scripts/custom-client-demo.mjs document/exercise authentication, conversation listing, paged history, send and polling. README.md gives restart, seed, configuration and worker commands.

The backend is Quarry schema/rules/sync/operations/jobs/schedules. The push worker only records committed effects. The installed published feed recipe is generated code, separately excluded from hand-authored line counts.

## Corrections and limitations

1. **agent-error** — correction-loop M1 attribution=agent-error evidence=evidence/m1-acceptance.log; retained Stack routes duplicated Edit; replaced with Slot; evidence: evidence/m1-acceptance.log.

2. **agent-error** — correction-loop M2 attribution=agent-error evidence=evidence/m2-choreo-run.log; harness requires feed tabs reachable on profile and thread; added persistent feed navigation; evidence: evidence/m2-choreo-run.log.

3. **agent-error** — correction-loop M3 attribution=agent-error evidence=evidence/m3-acceptance.log; async send completion cleared subsequent draft; capture and clear at submission; evidence: evidence/m3-acceptance.log.

4. **agent-error** — correction-loop M3 attribution=agent-error evidence=evidence/m3-receipt-diagnostic2.log; offline during reload missed async web-device JS chunk and fell to auth; use platform-resolved static device import; evidence: evidence/m3-receipt-diagnostic2.log.

5. **agent-error** — correction-loop M4 attribution=agent-error evidence=evidence/m4-attach-diagnostic.log; circular component imports raised Expo warning toast intercepting attachment; extracted shared Button to break cycles; evidence: evidence/m4-attach-diagnostic.log.

6. **agent-error** — correction-loop M4 iteration=2 attribution=agent-error evidence=evidence/chat-inspect.png; actual blocking toast was empty-string conditional child under RN View; coerced error condition to boolean; earlier cycle diagnosis incomplete; evidence: evidence/chat-inspect.png.

7. **agent-error** — correction-loop M5 attribution=agent-error evidence=evidence/m5-acceptance.log; group header kit renders uppercase; test now compares case-insensitively while requiring grouped DOM nodes; evidence: evidence/m5-acceptance.log.

8. **agent-error** — correction-loop M6 attribution=agent-error evidence=evidence/m6-check.log; moved variable-cost reads outside effects-only presence branch to restore prediction; evidence: evidence/m6-check.log.

9. **agent-error** — correction-loop M6 attribution=agent-error evidence=evidence/m6-acceptance.log; test assumed original display name despite choreography edit; replay reuploaded media under same write id causing E_ID_REUSED; reuse current authoritative asset reference; evidence: evidence/m6-acceptance.log.

10. **agent-error** — correction-loop M6 attribution=agent-error evidence=node_modules/snapback4/CLIENT-AND-OPERATIONS.md; custom API pagination corrected to Read.next, not cursor; full-scale verifier exhausts next; evidence: node_modules/snapback4/CLIENT-AND-OPERATIONS.md.

11. **agent-error** — correction-loop M8 attribution=agent-error evidence=evidence/m8-check.log; schedule period syntax accepts m/h/d, converted config seconds to equivalent minutes; evidence: evidence/m8-check.log.

12. **agent-error** — correction-loop M8 attribution=agent-error evidence=evidence/m8-choreo-run.log,evidence/m8-identity-diagnostic.log; harness expects chat rows at base URL; added recent-chat home section with activity ordering, retained full Chats route; evidence: evidence/m8-choreo-run.log,evidence/m8-identity-diagnostic.log.

13. **agent-error** — correction-loop M8 attribution=agent-error evidence=snapback/generated/api.ts; Trending was device-run; added server-now eligibility filter to enforce screen-load server freshness; evidence: snapback/generated/api.ts.

14. **ambiguous** — correction-loop M8 attribution=ambiguous evidence=evidence/m8-choreo-attempt3.log,evidence/dual-offline-proof.log; repeat harness saw missing offline bubble while independent dual-client reproduction passed; added durable pending-view fallback for SDK queued-without-row outcomes, never resubmitting from view metadata; evidence: evidence/m8-choreo-attempt3.log,evidence/dual-offline-proof.log.

15. **agent-error** — correction-loop post-green attribution=agent-error evidence=evidence/invalid-post-proof.log; text-post media guard now rejects hidden photo2/photo3/photo4 arguments as well as photo1; negative API proof passed; evidence: evidence/invalid-post-proof.log.

Additional environment errors/retries are timestamped in run-log.md: shell-background server lifetimes, copied read-only permissions, initial seed before readiness, Node PATH mismatch, and the snapshot's missing JSON-schema helper. The copied frozen harness needed a lane-contained relative-import layout and an AJV helper; no check logic was changed. Public binary/wrapper qualification and packed/prepack closure are nonclaimed in setup identity.

Candid gaps: no APNs delivery beyond the requested logged push seam; no iOS simulator proof; no native token totals, first-edit token marker or reliable phase splits available within this lane; no hidden grader scores; no fabricated numerical replay cap; some intermediate failed/fleeting-green receipts were overwritten, though final green receipts and bounded failure logs remain. The remaining N_WIDE_MERGE note warns that the optional server search can exceed its meter at 1,000 chat lanes; the UI uses the fully synced held index and the required scale probe uses 100 chats. Digest per-chat period scanning is bounded at 16,384 rows, above the specified busy-group envelope, and is not claimed unbounded. Public social sync deliberately acquires the public corpus; cold-sync evidence measures that cost. The pending-view fix addresses a documented queued-without-row case; the intermittent miss is attributed ambiguous, not a demonstrated Snapback defect.

run-record.json validates against the base run-record schema. The complete scored social-messenger extension requires independent grader/native-driver provenance absent from this lane, and is not claimed validated. Tokens remain null; no estimates were made. Essay was written after M8 and before this tally.

## Hand-authored physical lines

1239 lines across 60 product/configuration/test/diagnostic/report-script files. Counts include authored edits to scaffold files; exclude dependencies, lockfiles, copied instrument/UI/harness/metering, generated recipe/types/config, bundles, reports, and isolated schema copies. This is a physical-line inventory, not normalized effort.

| File | Lines |
|---|---:|
| app.json | 28 |
| app/[...path].tsx | 1 |
| app/_layout.tsx | 14 |
| app/index.tsx | 1 |
| babel.config.js | 4 |
| harness/lib/json-schema.mjs | 4 |
| metro-wasm-transformer.cjs | 10 |
| metro.config.js | 8 |
| package.json | 46 |
| scripts/accept-m2.mjs | 27 |
| scripts/accept-m3.mjs | 13 |
| scripts/accept-m4.mjs | 13 |
| scripts/accept-m5.mjs | 15 |
| scripts/accept-m6.mjs | 29 |
| scripts/accept-m8.mjs | 6 |
| scripts/acceptance.mjs | 37 |
| scripts/choreo.mjs | 10 |
| scripts/cleanup.mjs | 5 |
| scripts/cold-scale.mjs | 2 |
| scripts/configure.mjs | 7 |
| scripts/custom-client-demo.mjs | 16 |
| scripts/dual-offline-proof.mjs | 6 |
| scripts/inspect-attach.mjs | 2 |
| scripts/inspect-chat.mjs | 2 |
| scripts/inspect-chats.mjs | 1 |
| scripts/inspect-identity.mjs | 1 |
| scripts/inspect-toast.mjs | 2 |
| scripts/inspect-video.mjs | 2 |
| scripts/inspect.mjs | 2 |
| scripts/invalid-post-proof.mjs | 1 |
| scripts/offline-proof.mjs | 10 |
| scripts/patch-chat-m4.py | 35 |
| scripts/prove-m8.mjs | 20 |
| scripts/prove-revocation.mjs | 14 |
| scripts/push-worker.mjs | 6 |
| scripts/receipt-proof.mjs | 3 |
| scripts/replay.mjs | 35 |
| scripts/report.mjs | 20 |
| scripts/scale-after.mjs | 3 |
| scripts/scale-extra.mjs | 9 |
| scripts/scale-verify.mjs | 33 |
| scripts/scale.mjs | 5 |
| scripts/seed.mjs | 35 |
| scripts/serve-web.mjs | 4 |
| scripts/web-export-smoke.mjs | 1 |
| snapback/chat.q | 266 |
| snapback/digest.q | 42 |
| snapback/insights.q | 48 |
| snapback/schema.q | 142 |
| src/Chat.tsx | 71 |
| src/Insights.tsx | 2 |
| src/Main.tsx | 32 |
| src/MediaViewer.tsx | 6 |
| src/Primitives.tsx | 3 |
| src/Social.tsx | 30 |
| src/client.ts | 21 |
| src/device.ts | 2 |
| src/device.web.ts | 2 |
| src/pending.ts | 11 |
| tsconfig.json | 13 |

All six recorded listening servers and the recorded worker processes were stopped; no lane port remains listening.

end=1789590738.064
