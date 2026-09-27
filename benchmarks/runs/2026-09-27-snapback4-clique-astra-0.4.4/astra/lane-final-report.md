# Clique — final report

lane id astra-clique-snapback4-full-20260913
model gpt-6-astra
effort=medium
backend=snapback4-0.4.4
start=1790481279

M1 → M2 → M3 → M4 → M5 → M6 → M8 are green against the required suite and frozen choreography. M7 is **not-run**, as explicitly required. **Full scale invariant verification passed; scale performance is not all-green:** search/trending midpoint checks and group render failed; cold acquisition timed out once, then completed in 29.56 seconds on repetition. Nothing was struck from scope. Both installed Snapback packages resolve exactly to **0.4.4** from public npm, including the Expo arm's nested dependency. See [resolved pins](evidence/resolved-pins.json), [lockfile](package-lock.json), and [setup identity](setup-identity.json).

## Milestone clocks and proof

Raw epoch seconds are retained below; wall is seconds. First green is the earliest passing frozen segment-summary, already linked to a passing suite. End is the recorded implementation boundary and can be later because of native export or additional corrections. Original builder boundary values remain in [milestones.json](milestones.json).

| Milestone | Status | Start | End | Wall seconds | First green epoch |
|---|---|---:|---:|---:|---:|
| M1 | green | 1790481279 | 1790481848.3 | 569.300 | 1790481848.3 |
| M2 | green | 1790481848.3 | 1790482649.257 | 800.957 | 1790482649.257 |
| M3 | green | 1790482649.257 | 1790484348.253 | 1698.996 | 1790484348.253 |
| M4 | green | 1790484348.253 | 1790486187.857 | 1839.604 | 1790486187.857 |
| M5 | green | 1790486187.857 | 1790487610.751 | 1422.894 | 1790487610.751 |
| M6 | green | 1790487610.751 | 1790488655.697 | 1044.946 | 1790488523.226 |
| M8 | green | 1790488655.697 | 1790491839.946 | 3184.249 | 1790489947.962 |
| M7 | not-run | — | — | — | — |

M8 first reached green, then was reopened after the exploratory replay revealed incomplete global search. Its final wall includes that exploratory work and remains below the 14,400-second safety cap. The first-green timestamp is preserved rather than being replaced by the later regression. There were no milestone capability failures, aborts, or blocked descendants. The exploratory **replay** was aborted; that is distinct from a milestone status.

| Milestone | Passing suite / mapped assertions | Frozen choreography / required checks | Native artifact |
|---|---|---|---|
| M1 | [evidence/m1-suite.json](evidence/m1-suite.json); 7 mapped | [evidence/m1-choreography-2.jsonl](evidence/m1-choreography-2.jsonl); 3/3 passed; 3 required | [m1-ios](artifacts/m1-ios) |
| M2 | [evidence/m2-suite.json](evidence/m2-suite.json); 22 mapped | [evidence/m2-choreography-2.jsonl](evidence/m2-choreography-2.jsonl); 9/9 passed; 9 required | [m2-ios](artifacts/m2-ios) |
| M3 | [evidence/m3-suite.json](evidence/m3-suite.json); 7 mapped | [evidence/m3-choreography-3.jsonl](evidence/m3-choreography-3.jsonl); 7/7 passed; 5 required | [m3-ios](artifacts/m3-ios) |
| M4 | [evidence/m4-suite-5.json](evidence/m4-suite-5.json); 5 mapped | [evidence/m4-choreography-4.jsonl](evidence/m4-choreography-4.jsonl); 5/5 passed; 5 required | [m4-ios](artifacts/m4-ios) |
| M5 | [evidence/m5-suite-4.json](evidence/m5-suite-4.json); 6 mapped | [evidence/m5-choreography-2.jsonl](evidence/m5-choreography-2.jsonl); 4/4 passed; 2 required | [m5-ios](artifacts/m5-ios) |
| M6 | [evidence/m6-suite-3.json](evidence/m6-suite-3.json); 5 mapped | [evidence/m6-choreography-3.jsonl](evidence/m6-choreography-3.jsonl); 1/1 passed; 1 required | [m6-ios](artifacts/m6-ios) |
| M8 | [evidence/m8-suite-2.json](evidence/m8-suite-2.json); 6 mapped | [evidence/m8-choreography-3.jsonl](evidence/m8-choreography-3.jsonl); 5/5 passed; 5 required | [m8-ios](artifacts/m8-ios) |

Final global-search regression also passes [M5 suite](evidence/m5-suite-search-regression4.json) and [M5 choreography attempt 3](evidence/m5-choreography-3.jsonl). [Receipt digest verification](evidence/final-evidence-links.json) binds all cited green runs to unchanged suite files. Coverage mappings are inside each suite and in its adjacent coverage manifest. Failed attempts and compact structured miss logs are preserved. No required check was relabeled as a pass or an instrument skip. Simulator evidence is supplemental under this environment and was not run.

Every listed native artifact contains a Hermes .hbc bundle and Expo metadata. [Native artifact inventory](evidence/native-artifacts.json) records exact names, sizes, hashes and filesystem times. Final TypeScript checking passed in [final-typecheck.log](evidence/final-typecheck.log). The shortened configuration remains active; production windows and the 08:00 UTC daily schedule compile in [production-config-check.log](evidence/production-config-check.log).

## Additional behavioral evidence

- [Server expiry with clients closed](evidence/m5-expiry-closed.json): message removal, search exclusion and asset refusal after the real deadline.
- [Scheduled digest](evidence/m8-digest-closed.json): shortened real periods, no clients, backend restart, expected counts, privacy/deletion filtering, idle suppression and deduplication.
- [Browser process restart offline](evidence/m8-offline-restart.json): durable ordered sends, ordinary viewed media, view-once exclusion and subsequent read receipts.
- [Cross-client convergence](evidence/m8-client-convergence.json): edits, reactions and offline likes; [four-photo gallery](evidence/m8-post-gallery.json).
- [Cold offline history and new search](evidence/m8-search-cold-regression.log), [sample adapter conformance](evidence/m8-sample-final-regression.log), and the token-only [custom-client API](API.md).

## Scale replay and invariant verification

Final replay: start=1790491844.003; end=1790494270.991; cap=14400s; excluded verification/probe wall=121.550s; replay wall=2305.438s. It ran on a new instance seeded only with starter M1/M2/M3, with push and digests disabled by replay mode. [Instance identity](evidence/scale-final-instance.json), [clock](evidence/scale-final-clock.json), [settlement receipt](evidence/scale-final-receipt.json), [per-action receipts](evidence/scale-final-actions.jsonl), and [execution log](evidence/scale-execution-final.log).

Invariant result: **PASS**, 167157/167157 authoritative actions settled; 0 failed actions. The verifier independently pages actual profiles, follows, posts, social edges, authorized inboxes and every chat history, checks named O5 fixtures exactly, and checks named content, reactions, quotes and ordinary media bytes against fixtures. Verification precedes probes at [10%](evidence/scale-final-10pct-verification.json), [50%](evidence/scale-final-50pct-verification.json), and [full corpus](evidence/scale-final-full-verification.json). This is builder verification, not the secret rotated grader sample.

The first exploratory attempt is retained separately: [original clock](evidence/scale-clock.json), [receipt](evidence/scale-receipt.json), and [search failure diagnostic](evidence/scale-search-diagnostic.json). It stopped at 39,699 settled actions to correct an incomplete global search. The final attempt restarts from a fresh instance; it does not continue or conceal the aborted prefix. The frozen clock/receipt validator passed with only resource-URL routing into this lane; [validation](evidence/scale-evidence-validation.json) explains the snapshot's repository-relative import and preserves raw clocks if floating-point derived fields needed millisecond normalization.

## Local scale measurements

Three warm-ups, then twenty sequential samples per query, 30-second timeout, local npm binary. These are viability measurements, not comparative speed claims. No grader score is assigned.

| Probe (p95 ms) | 10% | 50% | Full |
|---|---:|---:|---:|
| following500 | 8.536 | 25.295 | 10.071 |
| following5 | 13.559 | 12.863 | 10.804 |
| celebrityFollower | 22.911 | 9.818 | 10.752 |
| historyPage1 | 20.333 | 20.399 | 31.433 |
| historyPage50 | 25.053 | 22.808 | 25.144 |
| globalSearch | 13.679 | 24.415 | 13.925 |
| insights | 1.706 | 1.839 | 2.868 |
| trending | 8.841 | 17.054 | 12.900 |

| Degradation ratio | 10% | 50% | Full |
|---|---:|---:|---:|
| deepPage | 1.232 | 1.118 | 0.800 |
| followingFanout | 0.630 | 1.966 | 0.932 |
| celebrityRead | 1.690 | 0.763 | 0.995 |

| Growth rule | Full / 10% | 50% p95 | Interpolated limit | Pass |
|---|---:|---:|---:|---|
| globalSearch | 1.018 | 24.415 | 13.788 | false |
| insights | 1.681 | 1.839 | 2.222 | true |
| trending | 1.459 | 17.054 | 10.645 | false |

Supplemental full-corpus probes run on a copy of the stopped verified store, preserving the invariant-clean original. Celebrity write ratio=0.761; An earlier valid attempt timed out at 30 seconds ([retained result](evidence/scale-supplementary-probes-3.json)); final cold acquisition completed at 29561.622ms for 100 memberships; diagnostic completion=—ms; fifty-member send-and-render timed out after 30 seconds in its second warm-up, so no p95 is claimed. The longer readiness observation was not reached because that render probe failed. [Structured outcome](evidence/scale-supplementary-results-summary.json). [Full samples and heap observations](evidence/scale-supplementary-probes.json). Sampled Chromium JS heap excludes native and worker RSS; it is not a whole-process memory proof. All measured published predicates pass: **false**. Any failed curve predicate remains visible above and is not converted to a green O5 claim.

## Correction loops

Grouped by underlying defect, not by each retry. Ordinary first-pass compiler errors are excluded even when the contemporaneous log called them corrections. 32 grouped loops: agent-error=27, environment=3, ambiguous=2, snapback-defect=0. The user spelling snapback4-defect maps to the protocol's snapback-defect; none is asserted here. Attribution is a candid builder assessment, not independent adjudication. [Machine-readable loops](evidence/correction-loops.json) and [timestamped log](run-log.md).

| Attribution | Correction and evidence |
|---|---|
| environment | Copied read-only choreography permissions and Node PATH selection needed correction. Evidence: evidence/choreography-install.log |
| agent-error | M1 duplicate-handle refusal withdrew onboarding data; keep the onboarding decision stable. Evidence: evidence/m1-suite.json; run-log.md:17 |
| agent-error | Avatar suite used a generic image-role selector instead of the kit observable URI. Evidence: evidence/m1-acceptance-3.log |
| agent-error | Profile edit spread non-argument row fields into saveProfile. Evidence: evidence/m1-acceptance-4.log |
| environment | Copied choreography required its frozen sibling metering modules. Evidence: evidence/m1-choreo-1.log |
| agent-error | Fixture intent IDs were not valid ULIDs; deterministic valid IDs replaced them. Evidence: evidence/m2-seed.txt |
| ambiguous | M2 choreography expected feed tabs on a profile route; exposed useful global navigation. Evidence: evidence/m2-choreo-1.log |
| agent-error | Concurrent mutating suite and choreography paged a fixture out of the feed; verification became serial. Evidence: evidence/m2-acceptance-final.log |
| environment | First Metro page load exceeded ordinary timeout under host load; static export and ordinary 30-second harness timeout were used. Typing thresholds stayed unchanged. Evidence: evidence/m3-choreo-1.log; evidence/host-load.txt |
| agent-error | DM/profile/inbox read replacement remounted route and composer; stable route identity and kept observations required multiple iterations. Evidence: evidence/m3-dm-probe.txt; evidence/m3-acceptance-route.log |
| agent-error | Quote suite selected an unstable reply snapshot; unique excerpt and eventual observation fixed it. Evidence: evidence/m3-quote-dom.txt |
| agent-error | Viewer and reaction picker state belonged to transient message rows; moved it above the list. Evidence: evidence/m4-choreo-1.log; evidence/m4-acceptance-2.log |
| agent-error | Video was actually ready, but Expo web VideoView omitted the contract ID; explicit wrapper corrected the original lifecycle-only diagnosis. Evidence: evidence/m4-video-contract-probe.txt; evidence/m4-choreo-2.log |
| agent-error | Long-press selection disappeared during row replacement and exposed unrelated edit controls; root pointer capture and scoped menu fixed it. Initial harness attribution was ambiguous, resolved by own probe. Evidence: evidence/m4-choreo-3.log; evidence/m4-edit-longpress-probe-2.txt |
| agent-error | Offline search probe disconnected before acquisition; ready observation and cold acquired test corrected it. Evidence: evidence/m5-offline-probe-2.log |
| agent-error | Chat settings controls disappeared during read replacement; static mounted controls preserve interaction. Evidence: evidence/m5-choreo-1.log |
| ambiguous | Published service-token sequence suggested minting while running, but E_STORE_BUSY required stopping first; empty-token worker then exited E_AUTH. Evidence: evidence/m6-token-mint.log; evidence/m6-why-store-busy.txt |
| agent-error | Push test expected an original display name after profile choreography changed it. Evidence: evidence/m6-acceptance-1.log |
| agent-error | Offline pending UI only represented predicted rows; durable pending intents needed their own deduplicated representation. Evidence: evidence/m6-choreo-1.log |
| agent-error | Cold-offline probe used the wrong kit input ID. Evidence: run-log.md:85; evidence/m6-cold-offline-2.log |
| agent-error | M8 home read-state choreography needed visible recent chats; added previews to landing feed. Evidence: run-log.md:95; evidence/m8-choreo-1.log |
| agent-error | Offline restart final assertion sampled a query replacement gap; use eventual atomic order/count predicate. Evidence: evidence/m8-offline-restart-1.log |
| agent-error | Dual-offline history vanished transiently on receipt refresh; bounded metadata display continuity preserves interaction without authority or asset caching. Evidence: evidence/m8-choreo-1.log; src/history-display.ts |
| agent-error | Post detail disappeared on disconnect before offline Like; kept public observations fixed it. Evidence: evidence/m8-client-convergence-1.log |
| agent-error | Doctor was invoked with a URL belonging to another owned project; use the fresh instance working directory. Evidence: evidence/scale-doctor-start.log |
| agent-error | Global search was incomplete and empty at larger corpus; stopped exploratory replay and adopted documented membership-scoped merge. Strengthened probes to require meaningful complete results. Evidence: evidence/scale-search-diagnostic.json; evidence/scale-search-fixed-diagnostic.json |
| agent-error | Search regression assertions assumed an old group title, then unstable snapshots and nested kit rows; three iterations corrected the test to authoritative labels and same-frame sibling observations. Evidence: evidence/m8-search-regression-suite.log; evidence/m8-search-regression-suite-2.log; evidence/m8-search-regression-suite-3.log |
| agent-error | Production-config compile preparation generated in lane root rather than copy; immediately restored shortened main config and compiled isolated production files. Evidence: run-log.md:123; evidence/production-config-check.log |
| agent-error | First-green bookkeeping used builder/export boundaries for M6/M8; reconciled exact green summary times while retaining original boundary fields. Evidence: evidence/green-receipt-index.json; milestones.json |
| agent-error | Supplemental proof hash attempted a whole-file read of the 2.3 GB store; stream hashing avoids Node readFileSync size limit. No probe or server had started. Evidence: evidence/scale-supplementary-1.log |
| agent-error | Scale browser export contained the main49360 endpoint, so scale-user login could not reach the copied corpus; rebuilt with explicit49365 environment and cleared Metro cache. Prior timeout was a misconfigured probe, not a measured sync timeout. Evidence: evidence/scale-supplementary-probes-2.json; evidence/scale-web-export-corrected.log; evidence/scale-web-endpoint-check.json |
| agent-error | Final report normalization used toolInvocations instead of schema toolUses, mixed total and required check denominators, and initially carried the prior cold timeout into the latest successful29.56s result; corrected from exact schema and receipts, preserving earlier failures. Evidence: evidence/run-record-validation-1.json; evidence/scale-supplementary-probes-3.json; evidence/scale-supplementary-probes.json |

## Authored lines

79 source/config/tooling files; 6270 physical lines including blanks/comments. Generated API, generated config/schedule, instance copies, dependencies, copied frozen UI/harness, lockfiles, binary assets, evidence and prose are excluded. src/receipts.ts is an attributed adaptation of the public guide recipe. This is a ceremony inventory, not an originality or efficiency score. [JSON inventory](evidence/hand-authored-lines.json).

| File | Lines | Category |
|---|---:|---|
| app.json | 36 | client/config |
| app/_layout.tsx | 15 | client/config |
| app/chat/[id]/index.tsx | 1 | client/config |
| app/chat/[id]/settings.tsx | 1 | client/config |
| app/chats.tsx | 1 | client/config |
| app/conversation/[handle].tsx | 1 | client/config |
| app/conversation/group/[group]/index.tsx | 1 | client/config |
| app/conversation/group/[group]/settings.tsx | 4 | client/config |
| app/index.tsx | 1 | client/config |
| app/insights.tsx | 1 | client/config |
| app/new-chat.tsx | 1 | client/config |
| app/post/[id].tsx | 1 | client/config |
| app/profile/[handle].tsx | 1 | client/config |
| app/profile/edit.tsx | 1 | client/config |
| app/search.tsx | 1 | client/config |
| app/settings.tsx | 1 | client/config |
| package.json | 45 | client/config |
| scripts/acceptance.mjs | 178 | verification/tooling |
| scripts/boundary.mjs | 32 | verification/tooling |
| scripts/choreo.mjs | 37 | verification/tooling |
| scripts/configure.mjs | 21 | verification/tooling |
| scripts/custom-client-demo.mjs | 86 | verification/tooling |
| scripts/final-report.mjs | 34 | verification/tooling |
| scripts/isolated.mjs | 51 | verification/tooling |
| scripts/probe-avatar.mjs | 26 | verification/tooling |
| scripts/probe-client-convergence.mjs | 5 | verification/tooling |
| scripts/probe-cold-offline.mjs | 57 | verification/tooling |
| scripts/probe-digest.mjs | 178 | verification/tooling |
| scripts/probe-dm.mjs | 24 | verification/tooling |
| scripts/probe-edit.mjs | 33 | verification/tooling |
| scripts/probe-expiry.mjs | 110 | verification/tooling |
| scripts/probe-offline-restart.mjs | 192 | verification/tooling |
| scripts/probe-post-gallery.mjs | 3 | verification/tooling |
| scripts/probe-search-offline.mjs | 37 | verification/tooling |
| scripts/probe-video.mjs | 35 | verification/tooling |
| scripts/push-worker.mjs | 32 | verification/tooling |
| scripts/replay.mjs | 277 | verification/tooling |
| scripts/report-corrections.mjs | 35 | verification/tooling |
| scripts/reset-m3-choreo.mjs | 26 | verification/tooling |
| scripts/scale-probes.mjs | 12 | verification/tooling |
| scripts/scale-run.mjs | 114 | verification/tooling |
| scripts/scale-supplementary.mjs | 30 | verification/tooling |
| scripts/seed.mjs | 148 | verification/tooling |
| scripts/serve-web.mjs | 39 | verification/tooling |
| scripts/setup-identity.mjs | 45 | verification/tooling |
| scripts/start-scale.mjs | 3 | verification/tooling |
| scripts/start.mjs | 26 | verification/tooling |
| scripts/test-m2.mjs | 235 | verification/tooling |
| scripts/test-m3.mjs | 169 | verification/tooling |
| scripts/test-m4.mjs | 170 | verification/tooling |
| scripts/test-m5.mjs | 154 | verification/tooling |
| scripts/test-m6.mjs | 156 | verification/tooling |
| scripts/test-m8.mjs | 160 | verification/tooling |
| scripts/validate-report.mjs | 11 | verification/tooling |
| scripts/validate-scale-evidence.mjs | 23 | verification/tooling |
| scripts/verify-sample.mjs | 158 | verification/tooling |
| scripts/verify-scale.mjs | 203 | verification/tooling |
| snapback/digest.q | 31 | Quarry backend |
| snapback/insights.q | 20 | Quarry backend |
| snapback/messaging.q | 314 | Quarry backend |
| snapback/schema.q | 142 | Quarry backend |
| src/ChatSettings.tsx | 157 | client/config |
| src/Insights.tsx | 73 | client/config |
| src/PostViewer.tsx | 15 | client/config |
| src/Search.tsx | 130 | client/config |
| src/Video.tsx | 14 | client/config |
| src/WriteStatus.tsx | 9 | client/config |
| src/client.ts | 26 | client/config |
| src/history-display.ts | 18 | client/config |
| src/intent-store.native.ts | 8 | client/config |
| src/intent-store.ts | 2 | client/config |
| src/intent-store.web.ts | 7 | client/config |
| src/intents.ts | 90 | client/config |
| src/messaging.tsx | 918 | client/config |
| src/receipts.ts | 154 | adapted published receipt recipe |
| src/screens.tsx | 213 | client/config |
| src/shell.tsx | 157 | client/config |
| src/social.tsx | 281 | client/config |
| tsconfig.json | 13 | client/config |

## Limits and gaps

- Scale performance is not all-green: search and trending missed the recorded 50%-interpolation predicate, and a valid cold offline acquisition attempt exceeded 30 seconds, while the final repetition completed in 29.56 seconds (both retained). The fifty-member live send/render probe also timed out during warm-up. Complete invariant verification and milestone green do not erase these failures. Failed probe attempts are retained; the wrong-endpoint attempt is explicitly invalid measurement.
- Native proof is seven iOS Hermes exports. Native simulator/device behavior, SecureStore persistence and native offline restart were not executed; web behavior was exercised.
- Push uses the required durable provider seam with a logging provider, not live APNs/FCM. Deployment is loopback development, not a hosted production service.
- The published token-mint sequence conflicted with the live-store lock diagnostic. Stopping, minting, then restarting worked; attribution remains ambiguous. No demonstrated platform capability gap prevented the requested product scope.
- Search is complete on the measured scoped corpus and offline within acquired horizons. Query incompleteness is exposed by the client; small-fixture compilation alone had not proven scale correctness.
- The full composed efficiency record needs orchestrator custody: retained native token stream, measured clock skew, exact delivered orientation and first-edit receipt, and compaction records. They are not exposed inside this lane. Token counts and phase splits remain null, reason NATIVE_DRIVER_EVIDENCE_NOT_EXPOSED_IN_LANE; no estimates, token-cap result, comparative efficiency claim, or invented provenance. [run-record.json](run-record.json) is a base-schema diagnostic record, not a claimed complete composed record; exact schema results are in [run-record-validation.json](evidence/run-record-validation.json).
- Frozen sources are unchanged: [UI integrity](evidence/frozen-ui-integrity.json), [choreography integrity](evidence/frozen-choreography-integrity.json). The meter fixture path needed an in-memory routing adapter for standalone validation; no instrument file or assertion was changed.
- M7 was not attempted. Existing message ordinals, membership unread data and M8 insight aggregates are documented in Quarry; no M7 poll feature or post-hoc migration was prebuilt.
- This single run cannot establish cross-backend latency or earlier-generation improvement. See the pre-tally [essay](essay.md) and milestone [diary](diary.md).

## Reproduction and shutdown

Use Node 24.18.0, npm ci, npm run check, npm run backend (49360), npm run build:web, then node scripts/serve-web.mjs (49362). See [README](README.md) for fixture seeding, milestone acceptance, CHOREO_BASE_URL, worker token handling, production config and replay. Every server PID is recorded in run-log.md; [shutdown evidence](evidence/server-shutdown.json) records the four remaining owned servers exiting after exact PID/command checks; replay/probe servers closed through their owners.

end=1790495056.523
