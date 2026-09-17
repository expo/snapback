# Clique — final report

Lane `astra-clique-snapback4-full-20260913`; model `gpt-6-astra`; effort `medium`. All requested continuous-session milestones are green. M7 was not attempted. Backend and native arm resolve to exactly **snapback4@0.2.27** and **snapback4-expo@0.2.18** ([resolved pins](evidence/resolved-pins.txt)). Platform binary snapback4-darwin-arm64@0.2.27. Expo 57.0.22, React 19.2.3, React Native 0.86.3. Published package/README/guide/generated types only; no other lane or source checkout was used.

## Milestone clocks and proof

Raw run start=1789615057; report end=1789620465; elapsed=5408s. Orientation is included in M1. First-green timestamps are the earliest retained passing matched suite/choreography receipts; milestone end is the recorded completion boundary after additional fixes/proofs/artifacts. M3 and M8 were reverified after their first green.

| Milestone | Status | Start epoch | End epoch | Wall seconds | First-green receipt epoch | Suite tests | Choreography checks |
|---|---|---:|---:|---:|---:|---|---|
| M1 | green | 1789615057 | 1789615510 | 453 | 1789615482.573 | 5 pass | 3/3 pass |
| M2 | green | 1789615510 | 1789615958 | 448 | 1789615928.678 | 11 pass | 9/9 pass |
| M3 | green | 1789615958 | 1789616436 | 478 | 1789616289.605 | 5 pass | 7/7 pass |
| M4 | green | 1789616436 | 1789616652 | 216 | 1789616619.666 | 4 pass | 5/5 pass |
| M5 | green | 1789616652 | 1789617290 | 638 | 1789617237.105 | 6 pass | 4/4 pass |
| M6 | green | 1789617290 | 1789618614 | 1324 | 1789618588.865 | 4 pass | 1/1 pass |
| M8 | green | 1789618634 | 1789620360 | 1726 | 1789619111.726 | 3 pass | 5/5 pass |
| M7 | not-run | — | — | — | — | Separate fresh session | Explicitly excluded by user |

Every milestone has [suite/coverage receipts](coverage-manifest.json) and `evidence/mN-choreo.jsonl`. All implemented required browser checks passed. There were no instrument skips. M6/M8 simulator evidence is explicitly supplemental/not-recorded in the frozen harness, not relabeled as a pass. Hermes exports satisfy the requested native-artifact bar. The [base-schema-valid run record](run-record.json) preserves receipt hashes and counts.

## Native artifacts

- M1: [Hermes bundle](artifacts/m1-ios-final/_expo/static/js/ios/entry-2e2809bd28602800cea7d4e9d1383a64.hbc), 2755416 bytes; SHA-256 `bc4180ba1e8935bf71128b87e6262d10df06b77c165d851764d2ffa0d8ef9bef`.
- M2: [Hermes bundle](artifacts/m2-ios-final/_expo/static/js/ios/entry-49e3ec128cdc65d6b6ba35d11fa17af4.hbc), 2779196 bytes; SHA-256 `7f1f4c4fcc9b876793ade500bf91f5d9cf2c1743256d4e380b106cd3f67fedcb`.
- M3: [Hermes bundle](artifacts/m3-ios-final/_expo/static/js/ios/entry-5c61fc42801139b320bf3b2b54cd62ec.hbc), 2801045 bytes; SHA-256 `25a59f03b53e4a247f1b181e87ee1c7002774b831c334bd094ce236e1e823e3e`.
- M4: [Hermes bundle](artifacts/m4-ios/_expo/static/js/ios/entry-2e0173cd0e241de81e4a46fe91a4efd7.hbc), 2808441 bytes; SHA-256 `a59bf8d297bdfc9bb4e92f1d971fa34a99dafbe6e63d5bb9b6ab940cf48c5f73`.
- M5: [Hermes bundle](artifacts/m5-ios-final/_expo/static/js/ios/entry-8efb8646c8fcfb683d0a9d936bfbbb94.hbc), 2817966 bytes; SHA-256 `3b495e89d0f155dd4bd1ce2a300bb00cc88ca85a79ea67aaaa924da266d72962`.
- M6: [Hermes bundle](artifacts/m6-ios-final/_expo/static/js/ios/entry-a94f495becb1468363e1fe237793ecac.hbc), 2818123 bytes; SHA-256 `f20494eef6d0b9789d0300c2261bc3f0376447da4cd535da40457f7c46b41521`.
- M8: [Hermes bundle](artifacts/m8-ios-final/_expo/static/js/ios/entry-28643f9a5b3816e2b89a41eb66fc4f8c.hbc), 2822836 bytes; SHA-256 `d7465144e62841c152596db00f6ad0d7d50a6238d0b70a66c2cfcb662b4c8642`.

## Scale replay and independent checks

Primary fresh instance: `scale-instance`, port49363, starter actions through real identity/mutations, then the exact pinned scale log. Start=1789618615; end=1789619288; wall=673s; checkpoint work excluded=3781ms; active=669.219s. Settled=167243 (86 starter +167157 scale actions). **Invariant verification passed at 10%, 50%, and 100%.** [Clock/result](evidence/scale-result.json), [invariants](evidence/scale-invariants.json), [settle receipts](evidence/scale-receipts.jsonl). Final state includes 1008 users/profiles, 5921 follow edges, 50228 posts, 1002 conversations, 2053 memberships, 100015 messages, 910 media messages, 2736 quoted replies and 2000 active reactions. Independent SQL counts cover every entity/per-chat/per-user count; authenticated named spots verify content, relationships, media, reactions and rosters.

M8 full-corpus probes use 3 warmups +20 serial samples. [Results](evidence/scale-m8-probes.json): deep-history-ratio=1.098× (pass); following-ratio=0.857× (pass); celebrity-read-ratio=0.889× (pass); celebrity-write-ratio-vs-comparison-user=1.242× (pass). Cold process-device acquisition=5789.4ms, acquired=true; Node RSS snapshot=341934080 bytes. This is not a simulator or a memory-growth time series.

Supplementary fresh M8 curve replay: start=1789619668; end=1789620369; wall=701s; excluded checkpoints=5473ms; invariant pass=true. It includes insights, trending and search at all three corpus sizes. [Curve probes](evidence/scale-m8-curve-probes.json), [comparison](evidence/scale-m8-curve-comparison.json). global-search: p95 8.229/7.940/7.316ms; full/10=0.889× (pass); midpoint fail. insights: p95 1.810/1.626/1.547ms; full/10=0.854× (pass); midpoint pass. trending: p95 1.805/1.793/1.814ms; full/10=1.005× (pass); midpoint pass. The first supplementary attempt stopped at an agent-owned page50 probe mistake at 10%; its exact result and fresh store are retained under `evidence/curve-attempt1` and `proofs/scale-m8-curve-attempt1`. That was not a primary scale invariant failure or a milestone capability failure. These are builder probes; the secret scored holdout was not inspected and no official O5 score is claimed.

## Authority and offline proofs

- [Authority](evidence/authority-proof.json): server edit deadline, deletion revocation, unattended message/asset expiry without a clock override.
- [Digest](evidence/digest-proof.json): real shortened schedule; every client closed; correct active-user counts; private-chat/tombstone exclusion; inactive user/next period silent; restart mid-period and after emission without duplication.
- [Replica](evidence/offline-proof.json): cold offline retained media/search, view-once refusal, pending likes/reactions/messages, durable restart, ordered flush and read receipt.
- [Exported web cold reload](evidence/web-cold-proof.json): service-worker shell + IndexedDB queue.
- [Independent client API](API.md) and [demo](evidence/m6-demo.json); [50-action adapter conformance](evidence/sample-conformance.json).

## Corrections and attribution

24 grouped correction episodes: agent-error=21, environment=3, ambiguous=0, snapback4-defect=0. Episodes group repeated retries of the same root cause; they are not the number of failing subprocesses. [Complete episode list](evidence/correction-loops.json) and [timestamped log](run-log.md). No confirmed Snapback4 defect was established. Intentional compiler refusals were resolved within the required scope. The repeated M6 receipt failures were my wrong kit prop, not a broken outbox. An Expo web event-dispatch console exception appeared during early passing runs and was not attributed to Snapback.

1. **environment** — Copied readonly directories could not install; made only lane copies writable. [Evidence](evidence/choreo-install.log).
2. **agent-error** — Expo Stack retained duplicate hidden profile nodes; changed route shell to Slot. [Evidence](evidence/m1-acceptance.log).
3. **agent-error** — CI/watch and empty CI setting caused stale or failed Metro startup; restarted own server. [Evidence](evidence/web.stdout.log).
4. **environment** — Actual ambient Node25 differed from declared Node24 PATH; selected Node24 explicitly. [Evidence](run-log.md).
5. **environment** — Copied choreography imported sibling metering directory; copied supplied metering unchanged. [Evidence](run-log.md).
6. **agent-error** — Choreography adapter initially omitted required schemaVersion. [Evidence](evidence/m1-choreo-console2.log).
7. **agent-error** — Used unsupported RN Web Image.resolveAssetSource; used Expo Asset. [Evidence](evidence/m2-acceptance.log).
8. **agent-error** — Feed tabs were absent on profile screen; moved navigation into shell. [Evidence](evidence/m2-choreo-console2.log).
9. **agent-error** — Timestamp ordering did not prove server arrival under ties; added transactional ordinals. [Evidence](evidence/guide-writes.txt).
10. **agent-error** — Media suite read server before optimistic write settled; awaited authoritative state. [Evidence](evidence/m4-acceptance.log).
11. **agent-error** — Placed once modifier on an argument instead of the asset column. [Evidence](evidence/m5-check.txt).
12. **agent-error** — Guessed coral color differed from frozen kit token; used exact palette. [Evidence](ui/src/tokens.ts).
13. **agent-error** — Push sink had a missing brace; corrected syntax and relaunched. [Evidence](evidence/push-worker.log).
14. **agent-error** — Delayed draft clearing could erase a second offline draft; clear submitted draft synchronously. [Evidence](evidence/m6-choreo-console.log).
15. **agent-error** — One M6 runner used ambient Node25 and failed setup identity; reran with Node24. [Evidence](evidence/m6-choreo-console-final.log).
16. **agent-error** — Passed pending as ReceiptState instead of receiptPending; repeated misses investigated with temporary diagnostics. [Evidence](evidence/client-debug.jsonl).
17. **agent-error** — Digest rule used unsupported joined field syntax; replaced with exists rule. [Evidence](evidence/m8-check4.txt).
18. **agent-error** — Mutation scanned expiring candidates; changed staging and job revalidation. [Evidence](evidence/m8-check5.txt).
19. **agent-error** — Root screen lacked chat rows for account-wide unread interaction; added inbox sidebar. [Evidence](evidence/m8-choreo-console.log).
20. **agent-error** — Cold DM routing depended on online creation; resolve held membership first. [Evidence](evidence/web-cold-proof.json).
21. **agent-error** — No-watch scale host needed reopening after schema adoption; restarted exact owned PIDs. [Evidence](evidence/scale-m8-console.log).
22. **agent-error** — Media limits initially used binary MB; changed to strict decimal byte bounds. [Evidence](snapback/social.q).
23. **agent-error** — Root tab highlight used local layout params; switched to global params and verified selected state. [Evidence](evidence/screenshots-final.log).
24. **agent-error** — Supplementary 10% probe assumed page50 existed; retained failed attempt and replayed fresh with conditional deep probe. [Evidence](evidence/curve-attempt1/scale-m8-curve-result.json).

## Hand-authored line counts

68 source/test/config files, 5147 physical lines. Generated feed recipe, generated config/API, copied kit/harness/fixtures, docs, dependencies and build artifacts are excluded. Authored JS/TS was formatted before counting. [Machine-readable counts](evidence/hand-authored-loc.json).

| File | Physical lines | Nonblank | Bytes |
|---|---:|---:|---:|
| [app.json](app.json) | 28 | 28 | 541 |
| [app/_layout.tsx](app/_layout.tsx) | 24 | 24 | 790 |
| [app/chat-settings/[id].tsx](app/chat-settings/[id].tsx) | 9 | 9 | 256 |
| [app/chats.tsx](app/chats.tsx) | 1 | 1 | 49 |
| [app/conversation/[handle].tsx](app/conversation/[handle].tsx) | 9 | 9 | 270 |
| [app/conversation/group/[group]/index.tsx](app/conversation/group/[group]/index.tsx) | 9 | 9 | 273 |
| [app/conversation/group/[group]/settings.tsx](app/conversation/group/[group]/settings.tsx) | 9 | 9 | 282 |
| [app/index.tsx](app/index.tsx) | 35 | 35 | 1222 |
| [app/insights.tsx](app/insights.tsx) | 41 | 41 | 1586 |
| [app/new-chat.tsx](app/new-chat.tsx) | 1 | 1 | 51 |
| [app/post/[id].tsx](app/post/[id].tsx) | 9 | 9 | 243 |
| [app/profile/[handle].tsx](app/profile/[handle].tsx) | 9 | 9 | 248 |
| [app/profile/edit.tsx](app/profile/edit.tsx) | 5 | 5 | 134 |
| [app/search.tsx](app/search.tsx) | 1 | 1 | 41 |
| [app/settings.tsx](app/settings.tsx) | 11 | 11 | 329 |
| [babel.config.js](babel.config.js) | 4 | 4 | 101 |
| [package.json](package.json) | 49 | 49 | 1472 |
| [scripts/acceptance.mjs](scripts/acceptance.mjs) | 155 | 155 | 5565 |
| [scripts/authority-proof.mjs](scripts/authority-proof.mjs) | 160 | 160 | 5065 |
| [scripts/build-web.mjs](scripts/build-web.mjs) | 27 | 27 | 1976 |
| [scripts/choreo.mjs](scripts/choreo.mjs) | 21 | 21 | 1202 |
| [scripts/config.mjs](scripts/config.mjs) | 12 | 12 | 1298 |
| [scripts/custom-client-demo.mjs](scripts/custom-client-demo.mjs) | 67 | 67 | 2309 |
| [scripts/digest-proof.mjs](scripts/digest-proof.mjs) | 219 | 219 | 6744 |
| [scripts/log.mjs](scripts/log.mjs) | 4 | 4 | 143 |
| [scripts/m2-tests.mjs](scripts/m2-tests.mjs) | 251 | 251 | 8803 |
| [scripts/m3-tests.mjs](scripts/m3-tests.mjs) | 133 | 133 | 4633 |
| [scripts/m4-tests.mjs](scripts/m4-tests.mjs) | 105 | 105 | 3993 |
| [scripts/m5-tests.mjs](scripts/m5-tests.mjs) | 104 | 104 | 4212 |
| [scripts/m6-tests.mjs](scripts/m6-tests.mjs) | 154 | 154 | 6035 |
| [scripts/m8-tests.mjs](scripts/m8-tests.mjs) | 129 | 129 | 5683 |
| [scripts/offline-proof.mjs](scripts/offline-proof.mjs) | 187 | 187 | 5877 |
| [scripts/push-worker.mjs](scripts/push-worker.mjs) | 21 | 21 | 519 |
| [scripts/replay.mjs](scripts/replay.mjs) | 184 | 184 | 6115 |
| [scripts/report.mjs](scripts/report.mjs) | 267 | 267 | 21756 |
| [scripts/scale-m8-curve.mjs](scripts/scale-m8-curve.mjs) | 281 | 281 | 11624 |
| [scripts/scale-m8-proof.mjs](scripts/scale-m8-proof.mjs) | 221 | 221 | 7856 |
| [scripts/scale.mjs](scripts/scale.mjs) | 228 | 228 | 10234 |
| [scripts/screenshots.mjs](scripts/screenshots.mjs) | 35 | 35 | 1588 |
| [scripts/seed.mjs](scripts/seed.mjs) | 128 | 128 | 4246 |
| [scripts/setup-identity.mjs](scripts/setup-identity.mjs) | 50 | 50 | 1387 |
| [scripts/start-push.mjs](scripts/start-push.mjs) | 14 | 14 | 478 |
| [scripts/start.mjs](scripts/start.mjs) | 22 | 22 | 904 |
| [scripts/static-server.mjs](scripts/static-server.mjs) | 46 | 46 | 1327 |
| [scripts/stop-recorded.mjs](scripts/stop-recorded.mjs) | 47 | 47 | 1908 |
| [scripts/wait-web.mjs](scripts/wait-web.mjs) | 7 | 7 | 174 |
| [scripts/web-cold-proof.mjs](scripts/web-cold-proof.mjs) | 75 | 75 | 2920 |
| [scripts/web-offline-debug.mjs](scripts/web-offline-debug.mjs) | 61 | 61 | 3015 |
| [scripts/web-offline-exact.mjs](scripts/web-offline-exact.mjs) | 63 | 63 | 2421 |
| [snapback/chat.q](snapback/chat.q) | 175 | 168 | 8898 |
| [snapback/digest.q](snapback/digest.q) | 62 | 61 | 2920 |
| [snapback/insights.q](snapback/insights.q) | 30 | 30 | 1372 |
| [snapback/media.q](snapback/media.q) | 60 | 60 | 3209 |
| [snapback/push.q](snapback/push.q) | 7 | 7 | 417 |
| [snapback/schema.q](snapback/schema.q) | 43 | 40 | 1578 |
| [snapback/search.q](snapback/search.q) | 9 | 9 | 757 |
| [snapback/settings.q](snapback/settings.q) | 27 | 27 | 1798 |
| [snapback/social.q](snapback/social.q) | 105 | 102 | 4419 |
| [snapback/trending.q](snapback/trending.q) | 15 | 15 | 387 |
| [src/Chats.tsx](src/Chats.tsx) | 390 | 390 | 17104 |
| [src/Feed.tsx](src/Feed.tsx) | 162 | 162 | 6672 |
| [src/Media.tsx](src/Media.tsx) | 43 | 43 | 1420 |
| [src/Profile.tsx](src/Profile.tsx) | 101 | 101 | 3761 |
| [src/Search.tsx](src/Search.tsx) | 56 | 56 | 2536 |
| [src/client.ts](src/client.ts) | 39 | 39 | 1349 |
| [src/following.ts](src/following.ts) | 37 | 35 | 2516 |
| [src/session.tsx](src/session.tsx) | 53 | 53 | 2055 |
| [tsconfig.json](tsconfig.json) | 1 | 1 | 233 |

## Candid gaps and measurement limits

The strict builder global-search midpoint timing predicate failed: the 50% p95 was above the line interpolated between the 10% and 100% p95 values, while the full-corpus p95 was lower than the 10% value. This is retained as a failed measurement, not a claimed performance pass or a platform capability omission. The exact values are in the curve section above.

No required product feature was dropped as an inexpressible platform gap. This is a local development-binary deployment; production hosting/hardening and real APNs delivery are not claimed. The push seam is deliberately logged. Native proof is Hermes export only; no simulator/physical-device run is claimed. The native loopback backend address must be changed for a physical device.

Harness-native token events and driver custody were not supplied inside this lane. Tokens and exact orientation/authoring/verification/diagnosis phase splits are null, never estimated. The base run record validates; a fully composed scored driver/grader record is not fabricated. Some early knowledge/error timestamps were batched retrospectively, so the log is not a complete per-tool native trace. M8 authoring and independent replay execution overlap in wall time; their durations must not be added as disjoint phases. Host-load series and secret rotated grading results are unclaimed. The selected feed recipe has explicit author/edge/event/route caps recorded in its schema; the fixture fits, and indefinite growth beyond those declared limits was not tested.

[Final home screenshot](evidence/clique-home.png), [insights](evidence/clique-insights.png), [conversation](evidence/clique-conversation.png).

[Diary](diary.md) and [essay](essay.md) were completed before the final numeric tally. [Server PID custody](evidence/server-pids.jsonl); final stop receipts are in `evidence/server-stop.json`.

end=1789620465
