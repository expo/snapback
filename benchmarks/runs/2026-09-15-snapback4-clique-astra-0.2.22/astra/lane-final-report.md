# Clique — final report

Lane: astra-clique-snapback4-full-20260913. Model: gpt-6-astra, effort medium. Backend: snapback4 0.2.22; native arm: snapback4-expo 0.2.13, both registry packages.

## Outcome

M1 → M2 → M3 → M4 → M5 → M6 → M8 are green at the frozen suite-plus-choreography bar. Nothing was struck from product scope. M7 was not run, as required. These are authoring results, not a claim to have passed the separate hidden grader.

## Milestone clocks and evidence

Raw lane start: 1789499471. M8 first green: 1789502435.591. Elapsed to M8 green: 2964.591 seconds. Individual milestone clocks include their documented starts; short boundary/reporting intervals remain visible in the lane elapsed time. M1 includes initial orientation.

| Milestone | Status | Start epoch | End epoch | Wall seconds | First-green epoch | Suite | Choreography |
|---|---|---:|---:|---:|---:|---|---|
| M1 | green | 1789499471 | 1789499810.981 | 339.981 | 1789499810.981 | 6 tests / 7 mapped | 3/3 |
| M2 | green | 1789499837 | 1789500177.996 | 340.996 | 1789500177.996 | 7 tests / 22 mapped | 9/9 |
| M3 | green | 1789500270 | 1789500583.59 | 313.590 | 1789500583.59 | 5 tests / 7 mapped | 7/7 |
| M4 | green | 1789500644 | 1789500818.39 | 174.390 | 1789500818.39 | 6 tests / 5 mapped | 5/5 |
| M5 | green | 1789500874 | 1789501341.463 | 467.463 | 1789501341.463 | 7 tests / 6 mapped | 4/4 |
| M6 | green | 1789501385 | 1789502043.91 | 658.910 | 1789502043.91 | 5 tests / 5 mapped | 1/1 |
| M8 | green | 1789502067 | 1789502435.591 | 368.591 | 1789502435.591 | 5 tests / 6 mapped | 5/5 |
| M7 | not-run | — | — | — | — | separate session | separate session |

Exact receipt paths, hashes, assertion totals and native hashes: [milestone-details.json](milestone-details.json). All required choreography checks implemented by the frozen harness passed. No instrument assertion skip was used. The copied harness's missing external JSON-schema helper was supplied in this lane; assertion logic was unchanged.

## Native artifacts

- M1: [Hermes bundle](artifacts/m1-ios/_expo/static/js/ios/entry-135ca3651e365f7f6f31429c8e8a7ec3.hbc)
- M2: [Hermes bundle](artifacts/m2-ios/_expo/static/js/ios/entry-8b19d80e316bd4efdea37cacd136ee0f.hbc)
- M3: [Hermes bundle](artifacts/m3-ios/_expo/static/js/ios/entry-a6da883d48b8654e83e3a136945aa4ed.hbc)
- M4: [Hermes bundle](artifacts/m4-ios/_expo/static/js/ios/entry-3c4cdd8ff1821f645ff07d91718edebf.hbc)
- M5: [Hermes bundle](artifacts/m5-ios/_expo/static/js/ios/entry-838d0adb720ebb90394ebfa0665fb1b0.hbc)
- M6: [Hermes bundle](artifacts/m6-ios/_expo/static/js/ios/entry-c1d7fe87228ab640abcf1fdfc3ce8aa6.hbc)
- M8: [Hermes bundle](artifacts/m8-ios/_expo/static/js/ios/entry-9e2d2c9bdc768e8f4db3cf77b8c48dec.hbc)

A final static web export is retained at artifacts/web. M8's Hermes export was refreshed after the explicit reaction-pending label; final M6/M8 choreography regressions also pass (evidence/m6-final-choreo-console.log and evidence/m8-final-choreo-console.log).

These are real iOS Hermes exports using the installed native package. They are not simulator or device interaction proofs. The separate process-device cold-offline restart proof is retained in evidence/m6-process-offline.json.

## Scale replay

Final attempt status: **verified**. Fresh persistent store: /Users/ccheever/clique-sb4-20260915-astra-cal6/lanes/astra-snapback4/evidence/scale-persistent-1789503123450. Start epoch 1789503342.699; last settled-action end epoch 1789504105.335; replay execution 729.350 seconds; checkpoint verification/probe pauses excluded 33.286 seconds. Safety cap 14400 seconds; no calibrated O5 cap or absolute latency ceiling was supplied by the frozen placeholder.

The first in-memory attempt is separately retained under evidence/scale-memory-attempt; its status is verified, start 1789502465.114, end 1789503096.453. It was repeated to retain a restartable dataset, not to erase a workload failure. The first persistent pass was interrupted by an added probe's unhandled request-forwarding error at the 10% pause; its clock and receipts are retained in evidence/scale-persistent-interrupted. The final pass resumes that same originally empty store, rebuilding accounting with stable IDs and no duplicated source writes; its execution clock includes this replayed prefix. This is explicitly a retry, not a second independently fresh dataset.

Final verification/probe completion epoch: 1789504137.736; post-action verification/probe wall: 32.401 seconds. Supplemental analytics and corrected write probes followed on their own recorded server sessions.

Final invariant verification: PASS. Exact settle accounting is compared to the combined manifest; independent deterministic API samples cover profiles, follow counts, post/media/reaction/quote data and full selected chat histories. The busy chat and named O5 fixtures are exact at all checkpoints. Builder sampling seed is explicit and does not impersonate the hidden grader seed. Replay notifications and schedules are suppressed by the published replay mode.

[evidence/scale-result.json](evidence/scale-result.json) carries full counts and checkpoint results. [evidence/scale-analytics-verification.json](evidence/scale-analytics-verification.json) independently reduces the action logs for lifetime/day totals and verifies exact Trending candidates. Write, cold-start and render probes run only on stopped-store copies, preserving the primary invariant state.

### Read latency observations

Twenty sequential requests after three warmups; values below are p95 milliseconds. Public SDK cards expose completeness, not internal work meters. These are local observations, not comparative speed claims.

| Checkpoint | Query | p95 ms |
|---|---|---:|
| 10pct | following-500 | 2.242 |
| 10pct | following-5 | 2.166 |
| 10pct | celebrity-follower | 2.314 |
| 10pct | busy-history-page1 | 18.082 |
| 10pct | search-100-chats | 9.016 |
| 10pct | insights | 1.596 |
| 10pct | trending | 1.808 |
| 50pct | following-500 | 2.219 |
| 50pct | following-5 | 2.152 |
| 50pct | celebrity-follower | 2.650 |
| 50pct | busy-history-page1 | 16.051 |
| 50pct | search-100-chats | 8.013 |
| 50pct | insights | 1.587 |
| 50pct | trending | 1.915 |
| 50pct | busy-history-page50 | 16.445 |
| full | following-500 | 2.267 |
| full | following-5 | 2.123 |
| full | celebrity-follower | 2.452 |
| full | busy-history-page1 | 16.081 |
| full | search-100-chats | 8.121 |
| full | insights | 1.578 |
| full | trending | 1.861 |
| full | busy-history-page50 | 15.783 |

See the extra-probe receipts for fresh browser initial sync and 50-member send-to-render observations. Corrected celebrity-write comparisons are in evidence/scale-corrected-writes-*.json: the first baseline user followed five accounts but had four followers; u0600 is independently verified to have five followers. Original invalid-baseline samples remain retained. The public degradation-rule evaluation is in evidence/scale-degradation.json; no hidden O5 score is claimed. **One literal predicate failed:** Trending midpoint p95 was 1.915 ms versus a 1.832 ms interpolation limit. Every other recorded predicate passed, including cold-start timeouts, full-to-10% ratios and corrected celebrity-write comparisons. The failure is retained without selective reruns; its cause is not established. Full cold-browser sync was 14,821.323 ms and full 50-member group send-to-render p95 was 295.376 ms.

## Corrections and attribution

- **environment**: Copied frozen harness expected an absent external schema validator; supplied AJV wrapper without changing assertions. Evidence: run-log.md:14
- **environment**: PATH differed from overlay; switched proof runners to exact Node24.18.0. Evidence: setup-identity.json
- **agent-error**: Approximate M1 first-green log corrected from exact neutral summary timestamp. Evidence: evidence/m1-boundary.json
- **agent-error**: Feed navigation unavailable from profile; added persistent feed tabs. Evidence: evidence/m2-choreo-console.log
- **agent-error**: Conversation navigation followed by immediate offline could race lazy device dependency; replaced with static platform modules. Evidence: evidence/m3-choreo-console.log
- **agent-error**: Authoritative media test ran before pending write settled; corrected wait and kit punctuation selector. Evidence: evidence/m4-acceptance-console.log
- **agent-error**: M8 suite dispatcher/readiness setup omitted new milestone and guessed an endpoint; fixed both. Evidence: evidence/m8-suite-1789502346100.json
- **agent-error**: Isolated digest proof lacked its own service token; added authenticated inspection setup. Evidence: evidence/m8-services-guide.txt
- **agent-error**: Reactions lacked an explicit pending label despite queued prediction; added the label and verified offline intents. Evidence: evidence/offline-intents-verification.json
- **agent-error**: Write probe confused five following with five followers; fixed baseline to independently checked u0600 and retained original samples. Evidence: evidence/scale-corrected-writes-full.json
- **agent-error**: Initial scale search probe used a no-hit word; repeated the persistent curve using populated coffee results. Evidence: evidence/scale-memory-attempt/scale-probes-10pct.json
- **agent-error**: An added browser proxy probe had an unhandled route.fetch rejection; direct request forwarding passed and the dataset resumed idempotently. Evidence: evidence/scale-persistent-interrupted/attempt.json
- **agent-error**: First scale attempt used an ephemeral store; repeated on a persistent fresh store to preserve final state. Evidence: evidence/scale-memory-attempt/scale-result.json

First-pass type, expiry-index and structural-fanout diagnostics are also timestamped in run-log.md. They are authoring errors, not asserted platform defects. The correction-loop list applies the protocol's revise-after-contrary-evidence definition rather than counting every compiler edit.

## Scope and candid limits

- No observed requirement was declared an unsupported Snapback capability. New binary uploads require connectivity, as documented by the package; queued text, likes, reactions and durable message restart are verified. Independent hidden trust, native-interaction and performance grading remains unrun.
- The push seam is a durable, inspectable effect outbox; an APNs/FCM delivery provider is intentionally outside the brief's seam.
- Digest correctness and restarts were exercised under the shortened config, including private-chat and tombstone exclusion. Its resumable full-message sweep grows with history and is a production optimization target. Expired-message authority is exercised independently; the hidden combined digest-expiry case remains a grader check.
- Production window and daily 08:00 UTC digest profiles are present; grading uses the required shortened profiles. Copy the profile and run npm run configure to switch.
- Native package integration compiles; native interaction and physical power-loss durability were not tested. Browser and process-device durability are separate evidence.
- Full composed efficiency custody cannot honestly be reconstructed: this lane lacks the native token stream, original first-edit marker and instrument manifest. record.json validates the base protocol schema; tokens and phase splits are null. It is not an efficiency-scored composed record.
- Absolute performance ceilings and calibrated replay caps remain placeholders in the supplied instrument. No calibrated O5 score or cross-backend latency ordering is invented.

## Cleanup

All recorded lane servers were stopped by their exact PIDs. The owned ports 49360–49366 were checked closed; no pattern kills were used. The primary scale database and probe copies remain on disk. See evidence/cleanup.json and server-pids.jsonl.

## Hand-authored line counts

[Machine-readable counts](evidence/line-counts.json). Raw physical lines, including blanks, by authored file; generated API/config, copied kit/harness and retained duplicate scripts are excluded from the hand-authored total. The published feed recipe contributes only its two timestamp changes. This is a ceremony count, not an implementation-quality metric.

| File | Physical lines | Hand-authored lines |
|---|---:|---:|
| src/analytics.tsx | 3 | 3 |
| src/chat.tsx | 48 | 48 |
| src/client.ts | 18 | 18 |
| src/device.ts | 2 | 2 |
| src/device.web.ts | 2 | 2 |
| src/following.ts | 32 | 0 |
| src/posts.tsx | 34 | 34 |
| src/profile.tsx | 18 | 18 |
| src/search.tsx | 3 | 3 |
| src/session.tsx | 17 | 17 |
| app/_layout.tsx | 11 | 11 |
| app/chats.tsx | 1 | 1 |
| app/conversation/[handle]/settings.tsx | 1 | 1 |
| app/conversation/[handle].tsx | 1 | 1 |
| app/conversation/group/[group]/index.tsx | 1 | 1 |
| app/conversation/group/[group]/settings.tsx | 1 | 1 |
| app/index.tsx | 2 | 2 |
| app/insights.tsx | 1 | 1 |
| app/new-chat.tsx | 1 | 1 |
| app/post/[id].tsx | 4 | 4 |
| app/profile/[handle].tsx | 4 | 4 |
| app/profile/edit.tsx | 1 | 1 |
| app/search.tsx | 1 | 1 |
| app/settings.tsx | 4 | 4 |
| scripts/acceptance.mjs | 25 | 25 |
| scripts/analytics-retained-proof.mjs | 1 | 1 |
| scripts/analytics-scale-proof.mjs | 5 | 5 |
| scripts/boundary.mjs | 4 | 4 |
| scripts/choreo.mjs | 7 | 7 |
| scripts/cleanup.mjs | 1 | 1 |
| scripts/configure.mjs | 4 | 4 |
| scripts/correct-write-probes.mjs | 3 | 3 |
| scripts/custom-client-demo.mjs | 4 | 4 |
| scripts/debug-receipt.mjs | 4 | 4 |
| scripts/degradation.mjs | 1 | 1 |
| scripts/digest-proof.mjs | 2 | 2 |
| scripts/expiry-proof.mjs | 3 | 3 |
| scripts/finish-milestone.mjs | 3 | 3 |
| scripts/inspect-history.mjs | 1 | 1 |
| scripts/isolated.mjs | 2 | 2 |
| scripts/m2-tests.mjs | 24 | 24 |
| scripts/m3-tests.mjs | 8 | 8 |
| scripts/m4-tests.mjs | 8 | 8 |
| scripts/m5-tests.mjs | 9 | 9 |
| scripts/m6-tests.mjs | 7 | 7 |
| scripts/m8-tests.mjs | 9 | 9 |
| scripts/offline-intents-proof.mjs | 1 | 1 |
| scripts/offline-proof.mjs | 3 | 3 |
| scripts/post-scale.mjs | 1 | 1 |
| scripts/proof-api-token.mjs | 1 | 1 |
| scripts/push-log.mjs | 3 | 3 |
| scripts/replay.mjs | 29 | 29 |
| scripts/report.mjs | 34 | 34 |
| scripts/scale-clocks.mjs | 1 | 1 |
| scripts/scale-extra-probes.mjs | 6 | 6 |
| scripts/scale-memory-attempt.mjs | 6 | 0 |
| scripts/scale.mjs | 6 | 6 |
| scripts/seed.mjs | 27 | 27 |
| scripts/setup.mjs | 11 | 11 |
| scripts/start.mjs | 8 | 8 |
| scripts/verify-replay.mjs | 12 | 12 |
| snapback/analytics.q | 49 | 49 |
| snapback/chat.q | 148 | 148 |
| snapback/config.q | 5 | 0 |
| snapback/digest.q | 55 | 55 |
| snapback/feed.q | 208 | 2 |
| snapback/media.q | 53 | 53 |
| snapback/push.q | 9 | 9 |
| snapback/schema.q | 31 | 31 |
| snapback/settings.q | 31 | 31 |
| snapback/social.q | 122 | 122 |
| lib/json-schema.mjs | 3 | 3 |

Total credited source/test lines: 960 across 69 files. Package pins are verified from installed manifests and package-lock.json. Qualitative account: [essay.md](essay.md); milestone experience: [diary.md](diary.md); complete timestamped events: [run-log.md](run-log.md).

end=1789504270.26
