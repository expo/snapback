# Clique final report

Lane astra-clique-snapback4-full-20260913; gpt-6-astra, effort medium. Public npm pins **snapback4@0.4.13** and **snapback4-expo@0.4.13** resolved exactly; see [resolved package evidence](evidence/resolved-pins.json). All work stayed within this lane and the authorized instrument. No Snapback source checkout, other lane, previous implementation, or sub-agent was used.

M1, M2, M3, M4, M5, M6 and M8 are **green** under the environment's suite-plus-choreography rule. M7 is **not-run**, explicitly reserved for a separate session. Nothing was struck from product scope. Scale replay is **passed**, separately clocked and described below.

## Time and milestone proof

Raw lane start=1791242618; final M8 acceptance end=1791251834.831; continuous build-through-M8 wall=9216.831 seconds. Orientation is included. Raw report/cleanup end=1791257764.33; overall elapsed=15146.330 seconds. The independent replay is excluded from the build-through-M8 figure. No milestone reached its 14,400-second wall cap.

First green is the earliest attesting green segment-summary. M1 and M2 were subsequently reconfirmed; the end column preserves that later milestone verification rather than relabeling it first green. Post-green audit/verification time remains visible.

| Milestone | Status | Start epoch | End epoch | Raw stage wall (s) | First green epoch | First-green elapsed (s) | Suite tests | Choreography checks |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| M1 | green | 1791242618 | 1791243817.345 | 1199.345 | 1791243533.631 | 915.631 | 6/6 | 3/3 |
| M2 | green | 1791243835 | 1791246602.908 | 2767.908 | 1791246244.539 | 2409.539 | 8/8 | 9/9 |
| M3 | green | 1791246618 | 1791247192.942 | 574.942 | 1791247192.942 | 574.942 | 6/6 | 7/7 |
| M4 | green | 1791247211 | 1791247649.067 | 438.067 | 1791247649.067 | 438.067 | 7/7 | 5/5 |
| M5 | green | 1791247684 | 1791248551.635 | 867.635 | 1791248551.635 | 867.635 | 7/7 | 4/4 |
| M6 | green | 1791248634 | 1791250310.21 | 1676.210 | 1791250310.21 | 1676.210 | 6/6 | 1/1 |
| M7 | not-run | — | — | — | — | — | — | — |
| M8 | green | 1791250335 | 1791251834.831 | 1499.831 | 1791251834.831 | 1499.831 | 6/6 | 5/5 |

All final suite bytes match the SHA-256 bound into their choreography summaries. Required unimplemented checks, failed checks, and instrument skips are all zero. All 53 original copied UI/choreography files match the frozen instrument byte for byte (evidence/frozen-copy-audit.json). M3 and M5 also passed their implemented optional choreography checks. [Combined coverage manifest](coverage-manifest-all.json) validates against all seven milestones’ suite assertions; [audit](evidence/milestone-audit.json) retains exact receipt paths and counts. Supplemental simulator receipts are explicitly not recorded, as the user required exports without simulator proofs.

- M1: [suite](artifacts/m1/suite.json), [choreography JSONL](evidence/choreo-m1-1791243788214.jsonl), [first green](evidence/choreo-m1-1791243500766.jsonl), [Hermes export](artifacts/m1/ios).
- M2: [suite](artifacts/m2/suite.json), [choreography JSONL](evidence/choreo-m2-1791246525002.jsonl), [first green](evidence/choreo-m2-1791246166136.jsonl), [Hermes export](artifacts/m2/ios).
- M3: [suite](artifacts/m3/suite.json), [choreography JSONL](evidence/choreo-m3-1791247095013.jsonl), [first green](evidence/choreo-m3-1791247095013.jsonl), [Hermes export](artifacts/m3/ios).
- M4: [suite](artifacts/m4/suite.json), [choreography JSONL](evidence/choreo-m4-1791247537430.jsonl), [first green](evidence/choreo-m4-1791247537430.jsonl), [Hermes export](artifacts/m4/ios).
- M5: [suite](artifacts/m5/suite.json), [choreography JSONL](evidence/choreo-m5-1791248184688.jsonl), [first green](evidence/choreo-m5-1791248184688.jsonl), [Hermes export](artifacts/m5/ios).
- M6: [suite](artifacts/m6/suite.json), [choreography JSONL](evidence/choreo-m6-1791250298032.jsonl), [first green](evidence/choreo-m6-1791250298032.jsonl), [Hermes export](artifacts/m6/ios).
- M8: [suite](artifacts/m8/suite.json), [choreography JSONL](evidence/choreo-m8-1791251791373.jsonl), [first green](evidence/choreo-m8-1791251791373.jsonl), [Hermes export](artifacts/m8/ios).

The implementation includes account/profile/avatar flows; follows and paginated media feeds; likes/reposts/replies; DMs/groups/admin membership; typing, quotes and receipts; image/video/once-photo messages; reactions; server edit/delete deadlines; asset revocation; server expiry with all clients closed; chat metadata/background; scoped search; durable offline sends/interactions and push seam; token-only API; replay adapter; aggregate insights, finite-window Trending, and scheduled digest. M6 tests cold web replica restart and pending-write reconciliation. M8 verifies two-device changes, unread behavior, and digest counts/negative cases with all clients closed and across a backend restart.

## Native artifacts

Each milestone produced a published-package iOS Hermes export. These establish bundle compilation, not simulator runtime behavior. Full hashes are in [native-artifacts.json](evidence/native-artifacts.json). Directories retain earlier export entries where builds were repeated; each export metadata.json identifies its final entry.

| Milestone | Hermes bundle | Bytes |
|---|---|---:|
| M1 | [artifacts/m1/ios/_expo/static/js/ios/entry-1fbf72d5035b9b543643c07ce54aaf5e.hbc](artifacts/m1/ios/_expo/static/js/ios/entry-1fbf72d5035b9b543643c07ce54aaf5e.hbc) | 3492802 |
| M1 | [artifacts/m1/ios/_expo/static/js/ios/entry-f7d74ff270ef8e7e3442df9d6c62c5db.hbc](artifacts/m1/ios/_expo/static/js/ios/entry-f7d74ff270ef8e7e3442df9d6c62c5db.hbc) | 3493010 |
| M1 | [artifacts/m1/ios/_expo/static/js/ios/web-worker-entry-8d08732221b6383116eaf57ba2f5dc98.hbc](artifacts/m1/ios/_expo/static/js/ios/web-worker-entry-8d08732221b6383116eaf57ba2f5dc98.hbc) | 211212 |
| M2 | [artifacts/m2/ios/_expo/static/js/ios/entry-999aa1b63e9d14825be792f2ef4e8cbb.hbc](artifacts/m2/ios/_expo/static/js/ios/entry-999aa1b63e9d14825be792f2ef4e8cbb.hbc) | 3525259 |
| M2 | [artifacts/m2/ios/_expo/static/js/ios/entry-9cb6e4afa52ba38ab1420703581c47f2.hbc](artifacts/m2/ios/_expo/static/js/ios/entry-9cb6e4afa52ba38ab1420703581c47f2.hbc) | 3527938 |
| M2 | [artifacts/m2/ios/_expo/static/js/ios/web-worker-entry-4d233d4bc1ef467b1483138661c20ea0.hbc](artifacts/m2/ios/_expo/static/js/ios/web-worker-entry-4d233d4bc1ef467b1483138661c20ea0.hbc) | 211212 |
| M2 | [artifacts/m2/ios/_expo/static/js/ios/web-worker-entry-af8337fcb55cee3048fbbc5bde4eb25b.hbc](artifacts/m2/ios/_expo/static/js/ios/web-worker-entry-af8337fcb55cee3048fbbc5bde4eb25b.hbc) | 211213 |
| M3 | [artifacts/m3/ios/_expo/static/js/ios/entry-040f0ea8e1087d2a4495ae945f5e7b17.hbc](artifacts/m3/ios/_expo/static/js/ios/entry-040f0ea8e1087d2a4495ae945f5e7b17.hbc) | 3576870 |
| M3 | [artifacts/m3/ios/_expo/static/js/ios/web-worker-entry-901bfadf3648206f73a73e4499065b84.hbc](artifacts/m3/ios/_expo/static/js/ios/web-worker-entry-901bfadf3648206f73a73e4499065b84.hbc) | 211212 |
| M4 | [artifacts/m4/ios/_expo/static/js/ios/entry-063fa124b31496f85df93f579fa60506.hbc](artifacts/m4/ios/_expo/static/js/ios/entry-063fa124b31496f85df93f579fa60506.hbc) | 3586922 |
| M4 | [artifacts/m4/ios/_expo/static/js/ios/web-worker-entry-7500c1bc9133ca4e5e56dab4c27b0b90.hbc](artifacts/m4/ios/_expo/static/js/ios/web-worker-entry-7500c1bc9133ca4e5e56dab4c27b0b90.hbc) | 211213 |
| M5 | [artifacts/m5/ios/_expo/static/js/ios/entry-c46e0ea30ba417b9824b102ed1543e9d.hbc](artifacts/m5/ios/_expo/static/js/ios/entry-c46e0ea30ba417b9824b102ed1543e9d.hbc) | 3608981 |
| M5 | [artifacts/m5/ios/_expo/static/js/ios/web-worker-entry-4013a2c94bb25abf9cd5397953f29e3d.hbc](artifacts/m5/ios/_expo/static/js/ios/web-worker-entry-4013a2c94bb25abf9cd5397953f29e3d.hbc) | 211213 |
| M6 | [artifacts/m6/ios/_expo/static/js/ios/entry-6f2785b5ea3d647d6ba34dd88f707738.hbc](artifacts/m6/ios/_expo/static/js/ios/entry-6f2785b5ea3d647d6ba34dd88f707738.hbc) | 3745085 |
| M6 | [artifacts/m6/ios/_expo/static/js/ios/web-worker-entry-d17889e4d7d2683508be0c1672655870.hbc](artifacts/m6/ios/_expo/static/js/ios/web-worker-entry-d17889e4d7d2683508be0c1672655870.hbc) | 211212 |
| M8 | [artifacts/m8/ios/_expo/static/js/ios/entry-a2b38d10c36f66637763b90a8e3ae73d.hbc](artifacts/m8/ios/_expo/static/js/ios/entry-a2b38d10c36f66637763b90a8e3ae73d.hbc) | 3759062 |
| M8 | [artifacts/m8/ios/_expo/static/js/ios/web-worker-entry-84651983e3810d7b68cf08346e62dfa9.hbc](artifacts/m8/ios/_expo/static/js/ios/web-worker-entry-84651983e3810d7b68cf08346e62dfa9.hbc) | 211212 |

## Scale replay

The final schema runs in a separate fresh instance on 49362, with a dedicated exported authentication client on 49363. The 86 starter actions settled before the scale action clock. The exact hash-pinned log contains 167157 actions; 167157 settled. The adapter was authored and sample-conformance-tested during M6; final aggregate verification was extended during M8. It uses real UI registration and public authenticated SDK writes, stable IDs, per-action sent acknowledgments, and all media actions. Replay mode holds schedules and suppresses new effects.

[Clock](evidence/scale-clock.json), [receipt](evidence/scale-receipt.json), [per-action JSONL](evidence/scale-actions.jsonl), and [frozen validator result](evidence/scale-evidence-validation.json) are retained. Cap=14400 seconds; charged replay wall=5497.233 seconds; checkpoint/probe wall excluded=27.158 seconds; cap exhausted=false.

| Attempt | Start epoch | End epoch | Settled prefix | Disposition |
|---|---:|---:|---:|---|
| 1 | 1791251881.001 | 1791251881.001 | 0 | continued |
| 2 | 1791252143.452 | 1791257667.843 | 167157 | completed |

Invariant result: **passed at both fixed checkpoints and final state**. Checkpoint bindings: 10% at 24777, 50% at 88057. Final state matched 1,008 profiles, 5,921 follow edges, 50,228 posts, 1,002 conversations, 2,053 memberships, and 100,015 messages (910 media). The complete 10,000-message busy chat was paged without duplicates. Exact per-actor/per-conversation maps, named high-fanout fixtures, quotes/reactions, and public profile checks also passed; see [final invariant evidence](evidence/scale-verify-final.json). All 167,157 sent receipts form a contiguous sequence (evidence/scale-action-audit.json). Public continuity timing probes are builder diagnostics; hidden external grader probes and an O5 verdict are not claimed.

The first setup attempt failed before any fresh profile or scale action was admitted: Metro reused a bundle bound to the main backend, so the fresh backend correctly returned E_AUTH. A cleared export and literal URL check fixed the setup. Its zero-action receipt and log remain preserved; accepted replay prefixes and elapsed action-clock attempts were never discarded.

## Corrections and limits

The curated protocol count is 20 correction loops: 14 agent-error, 4 environment, 2 ambiguous, 0 confirmed snapback4-defect. [correction-loops.json](correction-loops.json) provides every explanation and evidence pointer; [run-log.md](run-log.md) retains timestamped errors, lookups, retries and attribution. Repeated iterations of one cause count once. First-pass compiler mistakes and proactive test hardening do not count. No confirmed platform defect is asserted from a timeout or a correct refusal.

### Gaps and verification limits

- Native proof in this run is Hermes bundle export. No simulator interaction or native/O4 proof is claimed, per the user’s explicit export-only native proof instruction.
- The optimized Following view copies the latest 1,000 events per followed author. A separate complete-history reader is available at the feed end. Its compiler certificate says work grows with skipped posts/reposts and its examined ceiling is 8,192; sparse large histories can therefore return incomplete reads. The UI labels incomplete results. Evidence: `evidence/m2-history-cost.txt` and `evidence/guide-feeds.txt`. This is a documented execution bound, not an observed platform defect; the complete scale fixture and both checkpoints passed, but that does not remove the documented sparse-history bound.
- Video posters use a pinned fixture image. Actual playback uses the uploaded MP4. Thumbnail generation was optional; the host did not expose `ffmpeg` on PATH (`evidence/video-poster.log`).

- Hidden grader probes and externally stamped grading sessions were not supplied. Public continuity probes and invariant verification are retained, without claiming an external O5 verdict.
- Harness-native token events, driver first-edit custody, and clock-skew attestations were not exposed in this lane. Token counts/charges remain null; the base protocol record is validated, while the complete composed grading/metering record awaits the external driver. See `evidence/metering-unavailable.json`.
- Source is compact timed-build code. Successful fixture proofs and bundle exports do not establish production operational hardening or native device runtime behavior.


The harness-native token stream and driver custody artifacts were not exposed within the permitted lane. Token counts, charges and detailed phase splits are null; no estimates or efficiency claim substitute for them. [run-record.json](run-record.json) passes the protocol base schema. A complete composed social-messenger grading/metering record awaits the external driver and grader; no sessions, orientation stamp, skew bound, native runtime proof or hidden-grader result is invented.

## Source inventory

Hand-authored or rewritten source/configuration and verification tooling: 1176 physical lines in 73 files. This is a ceremony proxy, not semantic complexity or effort. Dense lines remain dense. Unchanged generated starter code/configuration, copied UI/choreography, generated API, fixture-generated constants, lockfiles, bundles, evidence copies and prose are excluded from that total. The table includes excluded source with provenance so the boundary is reviewable. [Machine-readable inventory](evidence/file-line-counts.json) also records nonblank counts.

| File | Physical lines | Provenance |
|---|---:|---|
| [app.json](app.json) | 25 | hand-authored-or-rewritten |
| [app/_layout.tsx](app/_layout.tsx) | 17 | hand-authored-or-rewritten |
| [app/chats.tsx](app/chats.tsx) | 1 | hand-authored-or-rewritten |
| [app/conversation/[id]/index.tsx](app/conversation/[id]/index.tsx) | 1 | hand-authored-or-rewritten |
| [app/conversation/[id]/settings.tsx](app/conversation/[id]/settings.tsx) | 1 | hand-authored-or-rewritten |
| [app/conversation/group/[slug]/index.tsx](app/conversation/group/[slug]/index.tsx) | 1 | hand-authored-or-rewritten |
| [app/conversation/group/[slug]/settings.tsx](app/conversation/group/[slug]/settings.tsx) | 1 | hand-authored-or-rewritten |
| [app/index.tsx](app/index.tsx) | 13 | hand-authored-or-rewritten |
| [app/insights.tsx](app/insights.tsx) | 1 | hand-authored-or-rewritten |
| [app/post/[id].tsx](app/post/[id].tsx) | 5 | hand-authored-or-rewritten |
| [app/profile/[handle].tsx](app/profile/[handle].tsx) | 6 | hand-authored-or-rewritten |
| [app/profile/edit.tsx](app/profile/edit.tsx) | 5 | hand-authored-or-rewritten |
| [app/profile/index.tsx](app/profile/index.tsx) | 5 | hand-authored-or-rewritten |
| [app/search.tsx](app/search.tsx) | 1 | hand-authored-or-rewritten |
| [app/settings.tsx](app/settings.tsx) | 6 | hand-authored-or-rewritten |
| [babel.config.js](babel.config.js) | 4 | retained-generated-configuration |
| [choreography-adapter.json](choreography-adapter.json) | 6 | hand-authored-or-rewritten |
| [digest-config.json](digest-config.json) | 9 | generated-from-fixture-config |
| [metro-wasm-transformer.cjs](metro-wasm-transformer.cjs) | 10 | retained-generated-configuration |
| [metro.config.js](metro.config.js) | 8 | retained-generated-configuration |
| [package.json](package.json) | 43 | hand-authored-or-rewritten |
| [scripts/acceptance-m2.mjs](scripts/acceptance-m2.mjs) | 19 | hand-authored-verification-tooling |
| [scripts/acceptance-m3.mjs](scripts/acceptance-m3.mjs) | 11 | hand-authored-verification-tooling |
| [scripts/acceptance-m4.mjs](scripts/acceptance-m4.mjs) | 12 | hand-authored-verification-tooling |
| [scripts/acceptance-m5.mjs](scripts/acceptance-m5.mjs) | 10 | hand-authored-verification-tooling |
| [scripts/acceptance-m6.mjs](scripts/acceptance-m6.mjs) | 10 | hand-authored-verification-tooling |
| [scripts/acceptance-m8.mjs](scripts/acceptance-m8.mjs) | 10 | hand-authored-verification-tooling |
| [scripts/acceptance.mjs](scripts/acceptance.mjs) | 36 | hand-authored-verification-tooling |
| [scripts/audit-frozen-copies.mjs](scripts/audit-frozen-copies.mjs) | 3 | hand-authored-verification-tooling |
| [scripts/audit-milestones.mjs](scripts/audit-milestones.mjs) | 4 | hand-authored-verification-tooling |
| [scripts/boundary.mjs](scripts/boundary.mjs) | 8 | hand-authored-verification-tooling |
| [scripts/choreography.mjs](scripts/choreography.mjs) | 6 | hand-authored-verification-tooling |
| [scripts/collect-inventory.mjs](scripts/collect-inventory.mjs) | 5 | hand-authored-verification-tooling |
| [scripts/configure-digest.mjs](scripts/configure-digest.mjs) | 1 | hand-authored-verification-tooling |
| [scripts/configure-windows.mjs](scripts/configure-windows.mjs) | 2 | hand-authored-verification-tooling |
| [scripts/custom-client-demo.mjs](scripts/custom-client-demo.mjs) | 20 | hand-authored-verification-tooling |
| [scripts/debug-digest.mjs](scripts/debug-digest.mjs) | 1 | hand-authored-verification-tooling |
| [scripts/debug-m6-cold.mjs](scripts/debug-m6-cold.mjs) | 1 | hand-authored-verification-tooling |
| [scripts/debug-m6-interactions.mjs](scripts/debug-m6-interactions.mjs) | 1 | hand-authored-verification-tooling |
| [scripts/debug-m8-functional.mjs](scripts/debug-m8-functional.mjs) | 1 | hand-authored-verification-tooling |
| [scripts/debug-m8-read.mjs](scripts/debug-m8-read.mjs) | 1 | hand-authored-verification-tooling |
| [scripts/debug-repost.mjs](scripts/debug-repost.mjs) | 4 | hand-authored-verification-tooling |
| [scripts/diagnostic-server.mjs](scripts/diagnostic-server.mjs) | 1 | hand-authored-verification-tooling |
| [scripts/digest-proof.mjs](scripts/digest-proof.mjs) | 17 | hand-authored-verification-tooling |
| [scripts/finalize-report.mjs](scripts/finalize-report.mjs) | 21 | hand-authored-verification-tooling |
| [scripts/inspect.mjs](scripts/inspect.mjs) | 2 | hand-authored-verification-tooling |
| [scripts/replay-adapter.mjs](scripts/replay-adapter.mjs) | 36 | hand-authored-verification-tooling |
| [scripts/sample-conformance.mjs](scripts/sample-conformance.mjs) | 21 | hand-authored-verification-tooling |
| [scripts/scale-probes.mjs](scripts/scale-probes.mjs) | 8 | hand-authored-verification-tooling |
| [scripts/scale-replay.mjs](scripts/scale-replay.mjs) | 9 | hand-authored-verification-tooling |
| [scripts/scale-verify.mjs](scripts/scale-verify.mjs) | 21 | hand-authored-verification-tooling |
| [scripts/screenshot-chat.mjs](scripts/screenshot-chat.mjs) | 3 | hand-authored-verification-tooling |
| [scripts/screenshot.mjs](scripts/screenshot.mjs) | 3 | hand-authored-verification-tooling |
| [scripts/seed-browser.mjs](scripts/seed-browser.mjs) | 18 | hand-authored-verification-tooling |
| [scripts/seed-m1.mjs](scripts/seed-m1.mjs) | 25 | hand-authored-verification-tooling |
| [scripts/seed.mjs](scripts/seed.mjs) | 26 | hand-authored-verification-tooling |
| [scripts/serve-web.mjs](scripts/serve-web.mjs) | 3 | hand-authored-verification-tooling |
| [scripts/setup-identity.mjs](scripts/setup-identity.mjs) | 5 | hand-authored-verification-tooling |
| [scripts/start-replay.mjs](scripts/start-replay.mjs) | 4 | hand-authored-verification-tooling |
| [scripts/validate-record.mjs](scripts/validate-record.mjs) | 4 | hand-authored-verification-tooling |
| [snapback/schema.q](snapback/schema.q) | 436 | hand-authored-or-rewritten |
| [snapback/workers/notifications.mjs](snapback/workers/notifications.mjs) | 6 | hand-authored-or-rewritten |
| [src/ActiveScreen.tsx](src/ActiveScreen.tsx) | 4 | hand-authored-or-rewritten |
| [src/Bridge.tsx](src/Bridge.tsx) | 9 | hand-authored-or-rewritten |
| [src/ChatMessage.tsx](src/ChatMessage.tsx) | 14 | hand-authored-or-rewritten |
| [src/ChatSettings.tsx](src/ChatSettings.tsx) | 14 | hand-authored-or-rewritten |
| [src/Chats.tsx](src/Chats.tsx) | 10 | hand-authored-or-rewritten |
| [src/Conversation.tsx](src/Conversation.tsx) | 43 | hand-authored-or-rewritten |
| [src/Insights.tsx](src/Insights.tsx) | 10 | hand-authored-or-rewritten |
| [src/OnceViewer.tsx](src/OnceViewer.tsx) | 6 | hand-authored-or-rewritten |
| [src/Posts.tsx](src/Posts.tsx) | 36 | hand-authored-or-rewritten |
| [src/Profile.tsx](src/Profile.tsx) | 25 | hand-authored-or-rewritten |
| [src/Search.tsx](src/Search.tsx) | 4 | hand-authored-or-rewritten |
| [src/Video.tsx](src/Video.tsx) | 2 | hand-authored-or-rewritten |
| [src/Video.web.tsx](src/Video.web.tsx) | 2 | hand-authored-or-rewritten |
| [src/client.ts](src/client.ts) | 21 | hand-authored-or-rewritten |
| [src/intent-store.native.ts](src/intent-store.native.ts) | 8 | copied-generated-starter |
| [src/intent-store.ts](src/intent-store.ts) | 2 | copied-generated-starter |
| [src/intent-store.web.ts](src/intent-store.web.ts) | 7 | copied-generated-starter |
| [src/intents.ts](src/intents.ts) | 85 | copied-generated-starter |
| [src/useLiveRows.ts](src/useLiveRows.ts) | 3 | hand-authored-or-rewritten |
| [src/useOnceMedia.ts](src/useOnceMedia.ts) | 39 | copied-generated-starter |
| [src/useOnlineArm.ts](src/useOnlineArm.ts) | 28 | copied-generated-starter |
| [src/useTyping.ts](src/useTyping.ts) | 53 | copied-generated-starter |
| [tsconfig.json](tsconfig.json) | 17 | retained-generated-configuration |
| [window-config.json](window-config.json) | 25 | generated-from-fixture-config |

## Public replay read timings

These are warm public-API observations on this host (20 samples after three warmups), not hidden grader results or cross-backend comparisons.

| Probe | 10% p95 (ms) | 50% p95 (ms) | final p95 (ms) |
|---|---:|---:|---:|
| following-500 | 8.884 | 7.966 | 15.072 |
| following-5 | 5.691 | 14.375 | 22.155 |
| following-celebrity-reader | 3.519 | 6.910 | 25.763 |
| search | 14.248 | 19.259 | 32.129 |
| history-page1 | 5.974 | 5.002 | 19.918 |
| history-page50 | 3.353 | 7.844 | 29.387 |
| receipt-page1 | 17.220 | 22.458 | 42.924 |
| insights | 4.008 | 3.575 | 23.135 |
| trending | 6.001 | 7.154 | 3.276 |

The milestone [diary](diary.md) records what helped and what fought the implementation. The [comparison essay](essay.md) was written after M8 and before final metrics were tallied. [README](README.md) documents launch, seeds, acceptance, exports, replay, and configuration; [API](API.md) documents the custom client. Server cleanup is recorded in run-log.md and evidence/process-cleanup.json.

end=1791257764.33
