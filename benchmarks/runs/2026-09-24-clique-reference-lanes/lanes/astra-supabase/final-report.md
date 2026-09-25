# Clique final report

Lane astra-clique-supabase-ref-20260924 · gpt-6-astra · effort=medium · Supabase JS **2.117.1**. Independent cold build in the supplied lane; no competing checkout or prior implementation inspected. No sub-agents used.

The requested sequence M1 → M2 → M3 → M4 → M5 → M6 → M8 is green under the frozen web acceptance bar. M7 is **not-run**, explicitly reserved for a later fresh session. Every requested milestone has an iOS Hermes export. The separate scale replay is **cap-exhausted**, and complete scale invariants are **not satisfied**. A green development milestone is not a claim of a green scale envelope.

## Clocks

Raw lane start=1790272699; final measurement end=1790294551.366; elapsed=21852.366 seconds. Cleanup occurs after this report and is separately logged. Orientation is included. First-green instants are the earliest retained passing combined receipts; milestone end/boundary instants also include any supplementary verification before moving on. M8's final revalidation is 1790291765.238, after its earlier first green. No fine-grained phase or token estimates are substituted for unavailable native accounting.

| Milestone | Status | Start epoch | End/boundary epoch | Wall seconds | First-green epoch | Seconds to first green |
|---|---|---:|---:|---:|---:|---:|
| M1 | green | 1790272699 | 1790273209.877 | 510.877 | 1790273209.877 | 510.877 |
| M2 | green | 1790273209.877 | 1790274392.918 | 1183.041 | 1790274392.918 | 1183.041 |
| M3 | green | 1790274392.918 | 1790276092.118 | 1699.200 | 1790276092.118 | 1699.200 |
| M4 | green | 1790276092.118 | 1790276846.247 | 754.129 | 1790276686.384 | 594.266 |
| M5 | green | 1790276846.247 | 1790277739.488 | 893.241 | 1790277727.741 | 881.494 |
| M6 | green | 1790277739.488 | 1790279969.238 | 2229.750 | 1790279927.276 | 2187.788 |
| M8 | green | 1790279969.238 | 1790291788.491 | 11819.253 | 1790280706.954 | 737.716 |
| M7 | not-run | — | — | — | — | — |

All attempted milestone walls are below the 14,400-second safety limit. The scale clock overlaps M8 and is not added to milestone authoring totals.

## Acceptance and choreography

| Milestone | Suite | Choreography | Evidence |
|---|---|---|---|
| M1 | 6 passed; 7 required IDs covered | 3/3 passed; 0 skipped | [suite](evidence/m1-suite.json), [coverage](evidence/m1-coverage.json), [choreography](evidence/m1-choreo.jsonl) |
| M2 | 12 passed; 22 required IDs covered | 9/9 passed; 0 skipped | [suite](evidence/m2-suite.json), [coverage](evidence/m2-coverage.json), [choreography](evidence/m2-choreo.jsonl) |
| M3 | 6 passed; 7 required IDs covered | 7/7 passed; 0 skipped | [suite](evidence/m3-suite.json), [coverage](evidence/m3-coverage.json), [choreography](evidence/m3-choreo.jsonl) |
| M4 | 6 passed; 5 required IDs covered | 5/5 passed; 0 skipped | [suite](evidence/m4-suite.json), [coverage](evidence/m4-coverage.json), [choreography](evidence/m4-choreo.jsonl) |
| M5 | 6 passed; 6 required IDs covered | 4/4 passed; 0 skipped | [suite](evidence/m5-suite.json), [coverage](evidence/m5-coverage.json), [choreography](evidence/m5-choreo.jsonl) |
| M6 | 5 passed; 5 required IDs covered | 1/1 passed; 0 skipped | [suite](evidence/m6-suite.json), [coverage](evidence/m6-coverage.json), [choreography](evidence/m6-choreo.jsonl) |
| M8 | 4 passed; 6 required IDs covered | 5/5 passed; 0 skipped | [suite](evidence/m8-suite.json), [coverage](evidence/m8-coverage.json), [choreography](evidence/m8-choreo.jsonl) |

The [aggregate coverage manifest](evidence/coverage-manifest.json) validates with the copied frozen coverage validator; each required ID also maps to a concrete test in the per-milestone files. Suite receipt hashes match the corresponding final choreography summaries. Required instrument skips: none. M6/M8 simulator evidence is marked not-recorded by the frozen supplemental external fields, not relabeled as a pass; the user requires Hermes exports rather than simulator proofs. Earlier failed runs and M8's first-green receipts are retained. Starter m1/m2/m3 segments ran through the application API; repeated installed-segment tests pass without adding rows.

Additional evidence: [server-time windows](evidence/m4-window-probe.json), [no-client expiry](evidence/m5-expiry-probe.json), [cold offline media and revocation](evidence/m8-media-offline-probe.json), [ordered offline queue](evidence/m6-offline-probe.json), [native stream and push seam](evidence/m8-native-stream-probe.json), [scheduled digest and restart](evidence/m8-digest-probe.json), [authorization boundaries](evidence/m8-authorization-probe.json), [unloaded quote and preserved history](evidence/quote-history-probe.json), and [50-action adapter conformance](evidence/sample-conformance.json).

## Native artifacts

- M1: [artifacts/m1-ios/_expo/static/js/ios/entry-10a3b5ddd0082dbf6f3afc19d4b915f8.hbc](artifacts/m1-ios/_expo/static/js/ios/entry-10a3b5ddd0082dbf6f3afc19d4b915f8.hbc), 2697759 bytes, SHA-256 ac443e5ace7661901508a23ff29ede9b7b9768a0b8d05b347dbecaa82b562893.
- M2: [artifacts/m2-ios/_expo/static/js/ios/entry-c48e3551bdbc860d4ae5404f763e7a3f.hbc](artifacts/m2-ios/_expo/static/js/ios/entry-c48e3551bdbc860d4ae5404f763e7a3f.hbc), 2709061 bytes, SHA-256 c8ac1bc0d249c1a34e421bb3907f658fe54996074926533eb39cb7d3e6aee198.
- M3: [artifacts/m3-ios/_expo/static/js/ios/entry-76413fe5b0335d1c0b1eca8fb0b17511.hbc](artifacts/m3-ios/_expo/static/js/ios/entry-76413fe5b0335d1c0b1eca8fb0b17511.hbc), 2727770 bytes, SHA-256 0b29103f36f59991449124208d12bce305f0830d55cdea8ca9a19f703e0027c7.
- M4: [artifacts/m4-ios/_expo/static/js/ios/entry-1f0927e12fef90882ed7e263467a5c54.hbc](artifacts/m4-ios/_expo/static/js/ios/entry-1f0927e12fef90882ed7e263467a5c54.hbc), 2745559 bytes, SHA-256 63ecae7cca159f2dff9955eb8ce112ab11f8488fa6cfb0bf010abffef4ca1d1d.
- M5: [artifacts/m5-ios/_expo/static/js/ios/entry-2954dee670e4279d7905045531499645.hbc](artifacts/m5-ios/_expo/static/js/ios/entry-2954dee670e4279d7905045531499645.hbc), 2776280 bytes, SHA-256 d49ffc196d5755b5c0750ccea57bbbf5821c2efa0f3365780b9e97ef5ce13fdd.
- M6: [artifacts/m6-ios/_expo/static/js/ios/entry-d9626ef2b13780a45ea47a2f4a9675c5.hbc](artifacts/m6-ios/_expo/static/js/ios/entry-d9626ef2b13780a45ea47a2f4a9675c5.hbc), 2824761 bytes, SHA-256 3930a1d07a746000e06c987789b48213f4743bd45e9987f9e6d1c75dbb9af5dd.
- M8: [artifacts/m8-ios/_expo/static/js/ios/entry-4c227ae3a13c232a8841cd8b8809e4ea.hbc](artifacts/m8-ios/_expo/static/js/ios/entry-4c227ae3a13c232a8841cd8b8809e4ea.hbc), 2833452 bytes, SHA-256 9e441a8fe209e3e7a577b65a26bb9ca367512ed898a209073ff3bcf599952472.

These are exported Hermes bundles, not simulator or physical-device execution proofs.

## Scale replay

Final initially-fresh instance (including same-clock continuation): start=1790280088.537; end=1790294505.808; raw wall=14417.271000146866 seconds; configured safety cap=14400; checkpoint-probe wall excluded=17.024 seconds; settled actions=26352, including 26266 scale actions. Result: cap-exhausted; Replay wall cap exhausted. See [clock](evidence/scale-clock.json), [settled actions](evidence/scale-settle.jsonl), and [final invariant audit](evidence/scale-final-audit-verification.json).

The instance used schema clqra_scale, bucket clqra_scale_media, prefixed Auth emails and notification channel clqra_scale_changes. Starter invariants passed before the scale log. Fixture bytes were hash-checked. Replay executes actual app signup/mutation/upload paths sequentially and records settlement before the next action. Push and digest emission were disabled explicitly. No fixture-time backdating, privileged signup bypass or shared Auth limit change was used.

Same-clock recovery: the driver stopped at action 585 with an Auth fetch error at epoch 1790285480.941. The interruption snapshot is retained at evidence/scale-interruption-585-clock.json. After correcting the application status mapping, scripts/resume-scale.mjs checked every retained action hash and contiguous index, reconstructed only in-memory aliases, and continued at the next action without reseeding or resetting hosted state. Resume epoch=1790285697.919; all interruption and repair wall remains charged to the original replay clock. This execution-recovery code was written after M8 and is disclosed rather than folded into the earlier M6 first-green time.

Checkpoint reports: 10pct: [passed](evidence/scale-10pct-verification.json); 50pct: not reached; 100pct: not reached. The running checkpoint verifier measures feed, chat and search reads. Final audit also probes M8 insights/trending; if the envelope is incomplete those observations are explicitly diagnostic-only in evidence/scale-partial-m8-probes.json, not full-envelope performance evidence.

Retained prior attempts:

- Attempt 1: start=1790278591.56; end=1790279163.711; wall=572.1510000228882; settled=1; result=failed; /upload: fetch failed.
- Attempt 2: start=1790279767.991; end=1790279813.556; wall=45.56500005722046; settled=112; result=failed; /auth/signup: Request rate limit reached.

The first retry followed a transient Storage/transport failure. The next exposed my HTTP status mapping of a provider 429 to 400. The final attempt backs off under hosted Auth limits, including observed 429 responses during signup and later session renewal. This shared hosted project can include traffic from other lanes; the result does not isolate a database-engine throughput limit. The 14,400-second replay safety cap is a lane-selected bound because the frozen brief leaves the replay cap pilot-calibrated rather than supplying a numeric value; it is not presented as a calibrated performance ceiling. Full-envelope O5 performance is unverified when replay or invariant verification fails; partial traffic cannot establish degradation ratios or absolute-ceiling passes.

## Corrections and attribution

Grouped correction loops: 24; agent-error: 23; environment: 0; ambiguous: 1; supabase-defect: 0. These are descriptive single-run counts, not a cross-backend effect estimate. First-pass syntax/setup errors are listed in run-log.md but excluded from this grouped loop count. Repeated iterations of the same reconnect or media investigation count once; the provisional stale-cache diagnosis was explicitly corrected after inspecting Playwright's async predicate handling.

1. **agent-error** — M1 optional catch-all did not match root after successful export. Evidence: evidence/m1-acceptance.log.
2. **agent-error** — M1 Stack retained duplicate globally-routed profile screens. Evidence: evidence/m1-acceptance.log.
3. **agent-error** — M2 stale feed projection on tab switch. Evidence: evidence/m2-choreo-attempt1-output.log.
4. **agent-error** — M2 repeated set/clear UI race; ordered per-entity intents. Evidence: evidence/m2-choreo-attempt2-output.log.
5. **agent-error** — M2 unbound Linking callback lost receiver. Evidence: evidence/link-diagnostic.log.
6. **agent-error** — M3 offline receipt recovery, three iterations including auth bootstrap. Evidence: evidence/m3-choreo-attempt1-output.log; scripts/receipt-probe-bob.mjs.
7. **agent-error** — M3 repeated suite matched an older identical reply. Evidence: evidence/m3-acceptance-attempt2.log.
8. **agent-error** — M3 seed ledger exposed fixture passwords in raw action keys; replaced with hashes. Evidence: evidence/seed-ledger-check.json.
9. **agent-error** — M5 search test matched multiple valid prior probe messages. Evidence: evidence/m5-acceptance-retry.log.
10. **agent-error** — M5 zero-row expiry UPDATE fired statement-level notifications. Evidence: evidence/m5-choreo-attempt1-output.log.
11. **agent-error** — M6 seed-idempotency count test overlapped conformance mutations. Evidence: evidence/m6-acceptance.log.
12. **agent-error** — M6 invalidation storms starved chat refresh. Evidence: evidence/m6-offline-probe.log.
13. **agent-error** — M6 sender receipt projection missed reconnect state. Evidence: evidence/m6-choreo-output.log.
14. **agent-error** — M6 own receipt probe read glyph instead of semantic attribute. Evidence: evidence/m6-offline-probe-retry.log.
15. **ambiguous** — Scale transport fetch failure after sample conformance; bounded timeouts and fresh retry. Evidence: evidence/scale-attempt1-scale-clock.json; evidence/transport-probe.json.
16. **agent-error** — Scale Auth status mapping: 429 initially became 400; a later zero-status retryable transport error also became 400 (two corrections). Evidence: evidence/scale-attempt2-scale-clock.json; evidence/scale-interruption-585-clock.json; evidence/auth-retry-status-probe.json.
17. **agent-error** — M8 online like optimism exposed state before server commit. Evidence: evidence/m8-choreo-attempt1-output.log; run-log.md.
18. **agent-error** — M8 home dashboard lacked required live chat rows. Evidence: run-log.md.
19. **agent-error** — M8 review corrected group color/background permission scope. Evidence: server/ephemeral.mjs; run-log.md.
20. **agent-error** — M8 stable group IDs replace name-dependent UI navigation. Evidence: lib/Chat.tsx; run-log.md.
21. **agent-error** — M8 offline media probe used async truthy polling; corrected diagnosis and awaited predicates. Evidence: scripts/media-offline-probe.mjs; run-log.md.
22. **agent-error** — M8 primitive revocation IDs were converted to objects, preventing cached media purge. Evidence: evidence/media-revocation-debug.json; evidence/m8-media-offline-probe.json.
23. **agent-error** — Post-M8 quote jumps fetched only loaded messages and refresh replaced older pages; bounded authorized context and history merge fixed. Evidence: evidence/quote-history-probe.json; lib/Chat.tsx; server/chat.mjs.
24. **agent-error** — View-once asset guard was duplicated on reaction writes; removed the reaction-only guard while preserving single-use asset denial. Evidence: evidence/m8-authorization-probe.json; server/message-actions.mjs.

Environment incidents include the initial Node shim version discrepancy, Expo CLI self-update behavior, the copied harness's metering import, the hosted 15-session connection ceiling during a supplementary regression (retry with a two-connection test pool passed), and the host ffprobe missing-library failure (replaced with lane-local MP4 parsing). No established Supabase defect was found. Published signup throttling is provider policy, not mislabeled as a defect.

## Resolved package pins

| Package | Resolved version |
|---|---|
| @react-native-async-storage/async-storage | 2.2.0 |
| @supabase/supabase-js | 2.117.1 |
| cors | 2.8.5 |
| dotenv | 17.2.3 |
| expo | 55.0.31 |
| expo-constants | 55.0.17 |
| expo-crypto | 55.0.19 |
| expo-file-system | 55.0.26 |
| expo-image-picker | 55.0.24 |
| expo-linking | 55.0.17 |
| expo-router | 55.0.18 |
| expo-status-bar | 55.0.6 |
| expo-video | 55.0.21 |
| express | 5.1.0 |
| mp4box | 2.4.1 |
| pg | 8.16.3 |
| prettier | 3.6.2 |
| react | 19.2.0 |
| react-dom | 19.2.0 |
| react-native | 0.83.10 |
| react-native-safe-area-context | 5.6.2 |
| react-native-screens | 4.23.0 |
| react-native-web | 0.21.2 |
| ws | 8.18.3 |

The complete transitive closure is in package-lock.json; the frozen choreography has its own lock. Node 24.18.0 and the installed Chromium/Playwright version are recorded in evidence/setup-identity.json.

## Hand-authored source lines

Physical source/test lines after formatting: 7697 across 78 files. Nonblank lines: 7692. This includes application code, SQL, tests and operational/report scripts; it excludes copied UI/choreography/metering/instrument, dependencies, fixtures, assets, generated bundles, lockfiles, evidence and prose. SQL remains compact; physical LOC is only a source inventory, not an effort metric.

| File | Physical lines | Nonblank |
|---|---:|---:|
| app.json | 16 | 16 |
| app/[...path].tsx | 1 | 1 |
| app/_layout.tsx | 4 | 4 |
| app/index.tsx | 1 | 1 |
| lib/Chat.tsx | 723 | 722 |
| lib/Clique.tsx | 427 | 427 |
| lib/Insights.tsx | 64 | 64 |
| lib/MediaViewer.tsx | 71 | 71 |
| lib/Search.tsx | 140 | 140 |
| lib/Social.tsx | 223 | 223 |
| lib/cache.ts | 82 | 82 |
| lib/client.ts | 380 | 380 |
| lib/events.ts | 4 | 4 |
| lib/storage.ts | 40 | 40 |
| package.json | 41 | 41 |
| scripts/acceptance.mjs | 198 | 198 |
| scripts/authorization-probe.mjs | 99 | 99 |
| scripts/boundary.mjs | 42 | 42 |
| scripts/build-web.mjs | 22 | 22 |
| scripts/choreo.mjs | 66 | 66 |
| scripts/cleanup.mjs | 74 | 74 |
| scripts/credential-bundle-audit.mjs | 46 | 46 |
| scripts/custom-client-demo.mjs | 85 | 85 |
| scripts/digest-probe.mjs | 153 | 153 |
| scripts/expiry-probe.mjs | 78 | 78 |
| scripts/hash-seed-ledger.mjs | 14 | 14 |
| scripts/log.mjs | 4 | 4 |
| scripts/m5-color-probe.mjs | 42 | 42 |
| scripts/m6-ui-diagnostic.mjs | 32 | 32 |
| scripts/media-offline-probe.mjs | 291 | 290 |
| scripts/migrate.mjs | 62 | 62 |
| scripts/native-stream-probe.mjs | 94 | 94 |
| scripts/offline-probe.mjs | 92 | 91 |
| scripts/progress.mjs | 38 | 38 |
| scripts/quote-history-probe.mjs | 113 | 113 |
| scripts/receipt-probe-bob.mjs | 75 | 75 |
| scripts/receipt-probe.mjs | 72 | 72 |
| scripts/replay-adapter.mjs | 236 | 235 |
| scripts/report.mjs | 365 | 365 |
| scripts/reset-scale.mjs | 31 | 31 |
| scripts/restore-m3-membership.mjs | 27 | 27 |
| scripts/resume-scale.mjs | 159 | 159 |
| scripts/sample-conformance.mjs | 134 | 134 |
| scripts/scale-final-audit.mjs | 81 | 81 |
| scripts/scale-replay.mjs | 110 | 110 |
| scripts/seed.mjs | 158 | 158 |
| scripts/test-m2.mjs | 210 | 210 |
| scripts/test-m3.mjs | 148 | 148 |
| scripts/test-m4.mjs | 130 | 130 |
| scripts/test-m5.mjs | 110 | 110 |
| scripts/test-m6.mjs | 87 | 87 |
| scripts/test-m8.mjs | 160 | 160 |
| scripts/transport-probe.mjs | 27 | 27 |
| scripts/verify-scale.mjs | 165 | 165 |
| scripts/web.mjs | 8 | 8 |
| scripts/window-probe.mjs | 65 | 65 |
| server/auth-errors.mjs | 11 | 11 |
| server/chat.mjs | 212 | 212 |
| server/connections.mjs | 58 | 58 |
| server/db.mjs | 43 | 43 |
| server/env.mjs | 9 | 9 |
| server/ephemeral.mjs | 148 | 148 |
| server/index.mjs | 317 | 316 |
| server/insights.mjs | 54 | 54 |
| server/m1.sql | 17 | 17 |
| server/m2.sql | 20 | 20 |
| server/m3-extra.sql | 1 | 1 |
| server/m3.sql | 15 | 15 |
| server/m4.sql | 11 | 11 |
| server/m5.sql | 7 | 7 |
| server/m6-fast.sql | 48 | 48 |
| server/m6.sql | 2 | 2 |
| server/m8.sql | 27 | 27 |
| server/media.mjs | 36 | 36 |
| server/message-actions.mjs | 106 | 106 |
| server/push.mjs | 34 | 34 |
| server/social.mjs | 93 | 93 |
| server/windows.mjs | 8 | 8 |

## Candid limits and handoff

- Complete scale-envelope verification and performance grading are not claimed unless the final replay and invariant audit pass. The final audit records actual and expected counts on failure.
- The hosted backend is accessed through a lane-authored Node API with privileged SQL and explicit authorization. RLS is enabled with no anonymous table policies; this is not a direct-client/RLS-policy-only design or a Supabase Realtime implementation. The API and its workers require a supervised process for production operation.
- Push is the requested logged delivery seam, not APNs integration. The daily digest uses the shortened fixture configuration in this run and a production UTC configuration in source.
- Native proof is Hermes export plus a headless authenticated stream probe. No simulator/device behavior, APNs delivery, or physical-device API routing is claimed.
- Token counts, per-phase token charges, detailed phase clocks and complete compaction timing are null/unavailable. No native usage stream was exposed inside the authorized lane. The [base run record](run-record.json) validates against the base schema; no composed, graded, metering-eligible record is claimed without the external driver/grader evidence. M7 and independent grading remain outside this session.
- The API deliberately documents reauthentication after token expiry; there is no client refresh endpoint. The build uses permissive TypeScript types in UI integration rather than claiming full end-to-end schema-generated typing.
- Hosted state will be destroyed immediately after this report, as instructed. Source, locks, migrations, seed commands, artifacts and receipts remain in this lane. Recreating hosted state requires the retained private credentials and an authorized rerun; no credential is copied into this report.

Read [diary.md](diary.md) and the pre-tally [essay.md](essay.md) for the qualitative account. Teardown verification is recorded in run-log.md and evidence/cleanup.json after this report.

end=1790294551.366
