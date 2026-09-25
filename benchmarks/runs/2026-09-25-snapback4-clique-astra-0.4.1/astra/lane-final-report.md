# Clique — final report

Lane `astra-clique-snapback4-full-20260913`; model `gpt-6-astra`; effort `medium`. Backend and native arm are exact public npm 0.4.1 packages. All requested milestones are green at the environment overlay’s suite-plus-choreography bar. M7 was not attempted. Nothing was struck from scope.

Run start=1790309185; final retained acceptance epoch=1790316511.172; report/cleanup end=1790316553. Wall through last acceptance: 7326.172s. Orientation is included. Milestone intervals below include their implementation, verification and boundary-export work. Replay ran independently and overlapped M6/M8, so its wall is not added to their elapsed intervals.

| Milestone | Status | Start epoch | Boundary end epoch | Wall seconds | First green / retained timestamp |
|---|---|---:|---:|---:|---|
| M1 | green | 1790309185 | 1790309946 | 761 | 2026-09-25T04:17:56.613Z |
| M2 | green | 1790309946 | 1790310724 | 778 | 2026-09-25T04:30:17.756Z |
| M3 | green | 1790310724 | 1790312111 | 1387 | 2026-09-25T04:54:32.047Z |
| M4 | green | 1790312111 | 1790312363 | 252 | 2026-09-25T04:58:54.061Z |
| M5 | green | 1790312363 | 1790312959 | 596 | 2026-09-25T05:08:53.890Z |
| M6 | green | 1790312959 | 1790313908 | 949 | 2026-09-25T05:24:35.839Z |
| M7 | not-run | — | — | — | Separate fresh session, explicitly excluded |
| M8 | green | 1790313908 | 1790315634 | 1726 | 2026-09-25T05:53:12.643Z |

M1–M6 first-green timestamps were saved at their original boundaries. M8’s table value is the earliest **retained attestation**, from the final build. Its initial passing compact log survives with mtime `1790314355.993647`, an upper bound on the earlier observed pass, not an exact harness timestamp. Some reruns overwrote original JSONL paths; original first-green hashes are therefore unavailable for those attempts. Final passing receipts are frozen in `evidence/final/`, and future runs now archive prior receipts. Post-M8 regression verification continued through the last acceptance epoch above. No four-hour cap was reached.

[Essay](essay.md) was written before the final metric tally; [diary](diary.md) records every milestone boundary. [Run log](run-log.md) contains errors, retries, lookups, process identities and corrections.

| Milestone | Suite tests passed | Suite-required IDs covered | Choreography passed / implemented | Required checks | Skips | Evidence |
|---|---:|---:|---:|---:|---:|---|
| M1 | 6 | 7 | 3/3 | 3 | 0 | [suite](evidence/final/suite-m1.json), [choreography](evidence/final/choreo-m1.jsonl) |
| M2 | 9 | 22 | 9/9 | 9 | 0 | [suite](evidence/final/suite-m2.json), [choreography](evidence/final/choreo-m2.jsonl) |
| M3 | 5 | 7 | 7/7 | 5 | 0 | [suite](evidence/final/suite-m3.json), [choreography](evidence/final/choreo-m3.jsonl) |
| M4 | 6 | 5 | 5/5 | 5 | 0 | [suite](evidence/final/suite-m4.json), [choreography](evidence/final/choreo-m4.jsonl) |
| M5 | 7 | 6 | 4/4 | 2 | 0 | [suite](evidence/final/suite-m5.json), [choreography](evidence/final/choreo-m5.jsonl) |
| M6 | 4 | 5 | 1/1 | 1 | 0 | [suite](evidence/final/suite-m6.json), [choreography](evidence/final/choreo-m6.jsonl) |
| M8 | 3 | 6 | 5/5 | 5 | 0 | [suite](evidence/final/suite-m8.json), [choreography](evidence/final/choreo-m8.jsonl) |

All suite-required assertion IDs are covered and every retained final choreography summary is green. There are no instrument skips or required-unimplemented checks. Optional implemented browser checks passed too. Supplemental simulator records are `not-recorded`, explicitly non-required by this run’s environment. [Combined coverage](evidence/coverage-manifest.json) and [hash-bound summaries](evidence/final-choreography-summaries.json) retain the mapping and suite receipt hashes.

Additional proofs: [no-client message expiry and asset revocation](evidence/expiry-proof.json), [cold offline history/media/search](evidence/web-cold-offline.json), [durable offline queue after page closure](evidence/web-durable-offline.json), [same-account live send/edit/reaction](evidence/same-account-live.json), [scheduled digest](evidence/digest-proof.json), and [final scale Insights UI](evidence/scale-m8-insights.json). Digest evidence includes exact four-count payloads, quiet-user suppression, private/tombstone exclusion, backend/provider restart mid-period, same-period retry deduplication, and a following idle period with no emission. These are additional builder proofs, not a claim that the independent grader has run.

Scale replay start=1790313713; end=1790314232; raw wall=519s; checkpoint/probe wall excluded=8.707s; replay chargeable wall=510.293s. Fresh isolated backend on port 49362, seeded through the app path with 86 starter actions. Applied and settled 167157/167157 scale actions, failedActions=0; invariant verification=pass at both checkpoints and final. Replay mode suppressed push and digest effects. The log hash is `sha256:b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9`. [Full receipt](evidence/scale-receipt.json), [10%](evidence/scale-checkpoint-10.json), [50%](evidence/scale-checkpoint-50.json), [bounded status](evidence/scale-status.json).

Verification compares the complete receipt-driven action ledger, count maps and memberships against the combined invariant manifest, then checks actual named entities, deterministic public samples, full busy/sample chat pagination, message field manifests, reactions and media references. This is not an exhaustive independent scan of every database row. Hidden grader probes remain unrun. The adapter supports all thirteen verbs and its retry conformance passes.

| Final public API probe | p50 ms | p95 ms | Max ms |
|---|---:|---:|---:|
| following-5 | 2.003 | 4.728 | 27.228 |
| following-500 | 3.237 | 28.531 | 31.657 |
| global | 3.144 | 29.659 | 29.891 |
| busy-latest | 3.417 | 27.336 | 27.342 |
| chat-list-100 | 5.325 | 29.907 | 30.425 |
| busy-search | 4.416 | 27.900 | 29.774 |
| all-chat-search | 4.712 | 26.357 | 30.707 |

Each probe used 3 warmups and 20 timed reads, with a 30-second per-read ceiling. These are public builder-selected server/API probes, not the frozen secret grader sample. The final cold scale browser flow across login, celebrity profile, own profile and Insights took **42.324 seconds total**; it is distinct from the API timings above.

| Native milestone export | Hermes artifact |
|---|---|
| M1 | [entry-ac566d1a03218a63122ab379b241e0de.hbc](artifacts/ios-m1/_expo/static/js/ios/entry-ac566d1a03218a63122ab379b241e0de.hbc) |
| M2 | [entry-d9ee74c22f569dfe4ef2ef9980824848.hbc](artifacts/ios-m2/_expo/static/js/ios/entry-d9ee74c22f569dfe4ef2ef9980824848.hbc) |
| M3 | [entry-e9e4a88ac1827f02ecaf346e497b20a9.hbc](artifacts/ios-m3/_expo/static/js/ios/entry-e9e4a88ac1827f02ecaf346e497b20a9.hbc) |
| M4 | [entry-5c475f0473893fdd161757ac1742e8b9.hbc](artifacts/ios-m4/_expo/static/js/ios/entry-5c475f0473893fdd161757ac1742e8b9.hbc) |
| M5 | [entry-024c22facba3ea8a633b1bad57d1575d.hbc](artifacts/ios-m5/_expo/static/js/ios/entry-024c22facba3ea8a633b1bad57d1575d.hbc) |
| M6 | [entry-30a19d51738f716b1d6e7f6d809ab72e.hbc](artifacts/ios-m6/_expo/static/js/ios/entry-30a19d51738f716b1d6e7f6d809ab72e.hbc) |
| M8 | [entry-440b0de7dd4241ddd5bfd3f008b770bd.hbc](artifacts/ios-m8/_expo/static/js/ios/entry-440b0de7dd4241ddd5bfd3f008b770bd.hbc) |

[Native artifact hashes and sizes](evidence/native-artifacts.json). Every requested milestone produced an iOS Hermes export. M8 was re-exported with a cleared Metro cache and the main backend target. Native runtime/simulator behavior was not exercised; web proofs do not substitute for it.

| Resolved package | Version |
|---|---|
| snapback4 | 0.4.1 |
| snapback4-expo | 0.4.1 |
| snapback4-darwin-arm64 | 0.4.1 |
| expo | 57.0.22 |
| react-native | 0.86.3 |
| react | 19.2.3 |
| expo-router | 57.0.23 |

Exact pins were recorded before installation. [Setup identity](setup-identity.json) includes package manifest and wrapper hashes; the wrapper was hashed as bytes, not inspected as source. Only the published package/README/guide/diagnostics/generated API informed Snapback authoring. No sibling lane, prior implementation, or source repository was inspected.

Curated correction loops: 23 total — agent-error: 19, ambiguous: 2, environment: 2. Established snapback4-defect loops: 0. This is a protocol-style grouping of related iterations; raw first-pass syntax/compiler errors are retained in the log but are not automatically loops. [Curated loop records](evidence/correction-loops.json); [raw labeled correction events](evidence/correction-events.json).

| Attribution | Correction loop and evidence |
|---|---|
| environment | Default Node differed from the environment overlay; switched to absolute Node 24. Evidence: `run-log.md:17` |
| agent-error | Profile navigation treated pending as terminal; await terminal receipt. Evidence: `evidence/acceptance-m1.log` |
| agent-error | Profile edit sent extra fields and retained screens duplicated controls; narrow fields and use Slot. Evidence: `evidence/acceptance-m1.log` |
| environment | Metro served an older UI after edits; switched to explicit static exports. Evidence: `evidence/acceptance-m2.log` |
| agent-error | Web document scrolling bypassed ScrollView paging; bound viewport. Evidence: `evidence/acceptance-m2.log` |
| agent-error | Initial acquisition reset paged state; coordinate readiness and rendered-page tests. Evidence: `evidence/acceptance-m2-attempt-scroll.log` |
| agent-error | Profile lacked direct feed navigation used by choreography; retain primary tabs. Evidence: `evidence/choreo-m2.log` |
| agent-error | Test selected an image post sharing text; scope author and variant. Evidence: `evidence/acceptance-m2-attempt-link.log` |
| agent-error | Suite groups shadowed the named fixture; use distinct names and ID routes. Evidence: `scripts/clean-suite-groups.mjs` |
| agent-error | Transient parent reads unmounted a conversation; retain confirmed parent data. Evidence: `evidence/acceptance-m3-attempt1.log` |
| agent-error | Seed baseline raced a pending quote, then matched repeated text; wait for a unique authoritative row. Evidence: `evidence/acceptance-m3-attempt-seed-race.log; evidence/acceptance-m3-attempt-seed-race2.log` |
| agent-error | Typing backlog and deadline display; throttle writes and filter local expiry. Evidence: `evidence/choreo-m3-attempt1.log; docs/expire.txt` |
| agent-error | Hard navigation beat admin mutation admission; retain stable synchronous intent and recover. Evidence: `evidence/remove-ui-probe.log; evidence/remove-ui-probe-fixed.log` |
| agent-error | Quote target fell beyond first history page; load through target. Evidence: `evidence/acceptance-m3.log` |
| agent-error | Pagination test clicked before rendered rows committed; wait for row count. Evidence: `scripts/suite-m3.mjs` |
| agent-error | Suite confused imperative asset result with React state; use documented url-or-denied result. Evidence: `node_modules/snapback4/CLIENT-AND-OPERATIONS.md; run-log.md` |
| ambiguous | One view-once UI click missed; unchanged retry passed, no cause established. Evidence: `evidence/acceptance-m5.log; evidence/acceptance-m5-retry.log` |
| agent-error | Retry re-upload changed arguments under a stable write ID; persist original store-bound upload references. Evidence: `evidence/acceptance-m6.log; docs/E_ID_REUSED.txt` |
| agent-error | Full-screen acquisition gate delayed scale startup; removing it exposed readiness races. Iterations added roster readiness and an eight-second online fallback while preserving initial acquisition wait. Evidence: `evidence/scale-startup.log; evidence/same-account-live.log; evidence/choreo-m8-final.log; run-log.md` |
| agent-error | Metro cached the main backend URL into a scale export; clear cache for each target and verify URL. Evidence: `evidence/scale-startup-current.log; evidence/scale-m8-insights-cleared.log` |
| ambiguous | One M6 rendered-order miss despite correct server order; four independent rounds and unchanged frozen rerun passed. Evidence: `evidence/choreo-m6-final.log; evidence/offline-order-probe.json; evidence/choreo-m6-final-retry.log` |
| agent-error | Reused choreography output paths overwrote older receipts; freeze final evidence and archive before future reruns. Historical first-green attestation coverage is incomplete. Evidence: `evidence/final/; scripts/choreo.mjs; run-log.md` |
| agent-error | Final hash audit found M4/M5 suites newer than their choreography references; rerun segments to attest current suite bytes. Evidence: `evidence/choreo-m4-final.log; evidence/choreo-m5-final.log` |

The two unresolved intermittent observations remain ambiguous: one view-once click and one final M6 rendered-order check. Unchanged retries passed; the latter also passed four independent rounds with correct server order. Neither was relabeled an instrument skip or blamed on the platform.

Known constraints and proof gaps:

- Following requires full public source sync. A bounded post horizon is refused by `E_TIMELINE_SHAPE`; see [diagnostic](evidence/check-bounded-posts.log) and [published explanation](docs/E_TIMELINE_SHAPE.txt). Cold acquisition can be slow. The client waits initially and then permits online server fallback while showing offline preparation. Fresh devices must finish acquisition before offline predictions are available.
- The published Following model backfills the newest 1,000 live events of a newly followed author. Older source posts remain available on profiles and Global. This is a model limitation, not a scope deletion.
- Real APNs/FCM delivery and public production deployment are not claimed. The requested authenticated effect/provider logging seam is implemented; the server instances were local development binaries.
- iOS proof is a Hermes build export, not runtime execution. Initial message acquisition is the latest 500 per conversation; older history pages require online fallback unless held. The ordinary-media cache is bounded; once-only content deliberately bypasses it. Video playback uses uploaded bytes, while the poster is a fixture-derived representative image rather than per-upload poster generation.
- Final receipts and suite hashes are preserved, but some earlier attempts’ full JSONL receipts were overwritten before archive handling was added. Historical first-green attestation is incomplete as described above.
- Harness-native token usage, phase accounting, first-edit/orientation snapshots, full compaction history and driver session-tree join are not available to the builder within this lane. Token values are null; no estimate, token-cap result, efficiency eligibility or independent grading score is claimed. `run-record.json` is a base-schema builder record; it is not the completed composed social-messenger driver record. The orchestrator must join its retained native stream for that record.

Hand-authored/materially edited source, test and configuration: 1087 physical lines in 78 files. Blank lines/comments count. Whole modified files count, not net changes. The copied UI/instrument, dependencies, generated API/helpers/config outputs, unchanged CLI scaffolding, binary assets, exports and generated reports are excluded. Compact one-line TSX makes this a weak effort proxy. [Machine-readable counts](evidence/line-counts.json).

| File | Physical lines |
|---|---:|
| [.gitignore](.gitignore) | 12 |
| [app.json](app.json) | 24 |
| [app/_layout.tsx](app/_layout.tsx) | 5 |
| [app/chats.tsx](app/chats.tsx) | 1 |
| [app/conversation/[handle]/index.tsx](app/conversation/[handle]/index.tsx) | 1 |
| [app/conversation/[handle]/settings.tsx](app/conversation/[handle]/settings.tsx) | 1 |
| [app/conversation/group/[group]/index.tsx](app/conversation/group/[group]/index.tsx) | 1 |
| [app/conversation/group/[group]/settings.tsx](app/conversation/group/[group]/settings.tsx) | 1 |
| [app/conversation/id/[id]/index.tsx](app/conversation/id/[id]/index.tsx) | 1 |
| [app/conversation/id/[id]/settings.tsx](app/conversation/id/[id]/settings.tsx) | 1 |
| [app/index.tsx](app/index.tsx) | 1 |
| [app/insights.tsx](app/insights.tsx) | 1 |
| [app/new-chat.tsx](app/new-chat.tsx) | 1 |
| [app/post/[postId].tsx](app/post/[postId].tsx) | 1 |
| [app/profile/[handle].tsx](app/profile/[handle].tsx) | 3 |
| [app/profile/edit.tsx](app/profile/edit.tsx) | 2 |
| [app/search.tsx](app/search.tsx) | 1 |
| [app/settings.tsx](app/settings.tsx) | 3 |
| [choreography-adapter.json](choreography-adapter.json) | 1 |
| [package.json](package.json) | 50 |
| [scripts/acceptance.mjs](scripts/acceptance.mjs) | 22 |
| [scripts/boundary.mjs](scripts/boundary.mjs) | 1 |
| [scripts/browser-probe.mjs](scripts/browser-probe.mjs) | 3 |
| [scripts/choreo.mjs](scripts/choreo.mjs) | 6 |
| [scripts/clean-suite-groups.mjs](scripts/clean-suite-groups.mjs) | 1 |
| [scripts/configure.mjs](scripts/configure.mjs) | 2 |
| [scripts/custom-client-demo.mjs](scripts/custom-client-demo.mjs) | 9 |
| [scripts/digest-proof.mjs](scripts/digest-proof.mjs) | 9 |
| [scripts/expiry-proof.mjs](scripts/expiry-proof.mjs) | 2 |
| [scripts/ids.mjs](scripts/ids.mjs) | 2 |
| [scripts/offline-cold-proof.mjs](scripts/offline-cold-proof.mjs) | 2 |
| [scripts/offline-durable-proof.mjs](scripts/offline-durable-proof.mjs) | 2 |
| [scripts/offline-order-probe.mjs](scripts/offline-order-probe.mjs) | 6 |
| [scripts/poster.mjs](scripts/poster.mjs) | 1 |
| [scripts/push-worker.mjs](scripts/push-worker.mjs) | 4 |
| [scripts/recover-sample-assets.mjs](scripts/recover-sample-assets.mjs) | 2 |
| [scripts/remove-ui-probe.mjs](scripts/remove-ui-probe.mjs) | 2 |
| [scripts/replay-adapter.mjs](scripts/replay-adapter.mjs) | 36 |
| [scripts/replay-ledger.mjs](scripts/replay-ledger.mjs) | 8 |
| [scripts/replay-sample.mjs](scripts/replay-sample.mjs) | 4 |
| [scripts/report.py](scripts/report.py) | 88 |
| [scripts/retention-join-probe.mjs](scripts/retention-join-probe.mjs) | 5 |
| [scripts/retention-probe.mjs](scripts/retention-probe.mjs) | 2 |
| [scripts/same-account-proof.mjs](scripts/same-account-proof.mjs) | 9 |
| [scripts/scale-m8-proof.mjs](scripts/scale-m8-proof.mjs) | 21 |
| [scripts/scale-replay.mjs](scripts/scale-replay.mjs) | 12 |
| [scripts/scale-startup-probe.mjs](scripts/scale-startup-probe.mjs) | 3 |
| [scripts/scroll-probe.mjs](scripts/scroll-probe.mjs) | 1 |
| [scripts/seed.mjs](scripts/seed.mjs) | 30 |
| [scripts/serve.mjs](scripts/serve.mjs) | 2 |
| [scripts/setup-identity.mjs](scripts/setup-identity.mjs) | 3 |
| [scripts/shutdown.py](scripts/shutdown.py) | 23 |
| [scripts/suite-m2.mjs](scripts/suite-m2.mjs) | 12 |
| [scripts/suite-m3.mjs](scripts/suite-m3.mjs) | 8 |
| [scripts/suite-m4.mjs](scripts/suite-m4.mjs) | 10 |
| [scripts/suite-m5.mjs](scripts/suite-m5.mjs) | 10 |
| [scripts/suite-m6.mjs](scripts/suite-m6.mjs) | 7 |
| [scripts/suite-m8.mjs](scripts/suite-m8.mjs) | 6 |
| [scripts/test-helpers.mjs](scripts/test-helpers.mjs) | 8 |
| [scripts/validate-report.py](scripts/validate-report.py) | 12 |
| [scripts/verify-scale.mjs](scripts/verify-scale.mjs) | 12 |
| [snapback/analytics.q](snapback/analytics.q) | 20 |
| [snapback/digest.q](snapback/digest.q) | 18 |
| [snapback/schema.q](snapback/schema.q) | 407 |
| [src/ChatBubble.tsx](src/ChatBubble.tsx) | 3 |
| [src/Chats.tsx](src/Chats.tsx) | 23 |
| [src/Delivery.tsx](src/Delivery.tsx) | 2 |
| [src/Feed.tsx](src/Feed.tsx) | 11 |
| [src/Insights.tsx](src/Insights.tsx) | 5 |
| [src/PostCard.tsx](src/PostCard.tsx) | 8 |
| [src/Profile.tsx](src/Profile.tsx) | 13 |
| [src/Search.tsx](src/Search.tsx) | 3 |
| [src/client.ts](src/client.ts) | 19 |
| [src/common.tsx](src/common.tsx) | 16 |
| [src/intents.tsx](src/intents.tsx) | 9 |
| [src/media.tsx](src/media.tsx) | 7 |
| [src/settle.ts](src/settle.ts) | 1 |
| [src/useLiveRows.ts](src/useLiveRows.ts) | 2 |

Authored prose is counted separately:

| File | Physical lines |
|---|---:|
| [README.md](README.md) | 30 |
| [API.md](API.md) | 86 |
| [CONFIGURATION.md](CONFIGURATION.md) | 16 |
| [diary.md](diary.md) | 27 |
| [essay.md](essay.md) | 29 |
| [run-log.md](run-log.md) | 121 |

Launch and validation commands are in [README](README.md), production/shortened configuration and worker setup in [CONFIGURATION](CONFIGURATION.md), and the standalone client contract in [API](API.md). Starter segments M1/M2/M3 are idempotent through `npm run seed -- --segment mN`; M8 has no starter segment. Stores and artifacts are retained. All owned servers are stopped at handoff; [shutdown receipt](evidence/shutdown.json) and run log identify exact PIDs.

end=1790316553
