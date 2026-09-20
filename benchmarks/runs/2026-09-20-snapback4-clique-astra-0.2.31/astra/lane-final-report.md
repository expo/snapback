# Clique final report

Lane astra-clique-snapback4-full-20260913 · gpt-6-astra · effort=medium.

All requested milestones are green under the environment's suite-plus-choreography bar. M7 was deliberately not run. Exact installed pins: snapback4@0.2.31 and snapback4-expo@0.2.22; see evidence/resolved-pins.txt and package-lock.json.

Raw run start=1789896546; end=1789901119; total wall=4573s. Milestone walls include their orientation/correction work. Replay ran on its own clock while M8 authoring continued, so overlapping walls must not be summed as elapsed time. M6's terminal includes checkpoint-verifier authoring through the replay start; its first passing UI proof was earlier. M8's terminal includes the additional full-scale digest correction.

| Milestone | Status | Start epoch | End epoch | Wall s | First green epoch | Suite tests / mapped assertions | Choreo passed / implemented | Hermes |
|---|---|---:|---:|---:|---:|---|---|---|
| M1 | green | 1789896546 | 1789897048 | 502 | 1789897031.148 | 6 / 7 | 3 / 3 | artifacts/m1-ios |
| M2 | green | 1789897048 | 1789897546 | 498 | 1789897530.015 | 9 / 22 | 9 / 9 | artifacts/m2-ios |
| M3 | green | 1789897546 | 1789898085 | 539 | 1789898033.139 | 5 / 7 | 7 / 7 | artifacts/m3-ios |
| M4 | green | 1789898085 | 1789898345 | 260 | 1789898326.718 | 5 / 5 | 5 / 5 | artifacts/m4-ios |
| M5 | green | 1789898345 | 1789898996 | 651 | 1789898957.683 | 6 / 6 | 4 / 4 | artifacts/m5-ios |
| M6 | green | 1789898996 | 1789899576 | 580 | 1789899461.358 | 4 / 5 | 1 / 1 | artifacts/m6-ios |
| M8 | green | 1789899647 | 1789901065 | 1418 | 1789900039.939 | 3 / 6 | 5 / 5 | artifacts/m8-ios |
| M7 | not-run | — | — | — | — | Separate fresh session | — | — |

Each milestone has evidence/mN-suite.json, evidence/mN-coverage.json, and evidence/mN-choreo.jsonl. All final choreography suite hashes match their receipts. coverage-manifest.json passed the frozen coverage validator. Failed attempts remain alongside the final receipts. The frozen web harness reported no skipped or required-unimplemented checks in these segments. Native simulator assertions were not run; exports are the native proof permitted by ENVIRONMENT.md, and are not simulator receipts.

## Scale and scheduled work

Fresh isolated store at scale-instance, port49363; all 86 starter actions followed by all 167,157 scale actions, each awaiting authoritative acceptance. Replay SHA256=b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9. Start=1789899576; actionEnd=1789900244; action wall=668s; verificationEnd=1789900284; final invariant result=pass. Both 10% and 50% checkpoint manifests passed before replay continued. Final state: 1,008 profiles, 50,228 posts, 100,015 messages, 5,921 follow edges, and 1,002 conversations. See evidence/replay-scale/verification-{10pct,50pct,final}.json for counts, named spots, pagination and unscored 20-sample query probes. New push effects were suppressed permanently in replay mode.

Post-replay M8 adoption/backfill passed full-scale insight totals and trending checks (evidence/scale-insights-proof.json). The first digest stress run hit E_BOUND at 16 MiB heap; narrowing its projection also failed. The corrected job pages period messages, accumulates per-chat totals and records message/period admission. The final scale digest completed 33949 chunks and 580996 writes; evidence/scale-digest-job3.json. Earlier parked runs are retained. The independent real-time scheduled proof passed with every client closed, exact counts, quiet users, private-chat exclusion, restart, same-period rerun, and a quiet following period (evidence/digest-proof.json).

## Additional evidence

Server expiry with both clients closed and revoked media: evidence/m5-expiry-proof.json. Real elapsed edit/delete denial: evidence/window-proof.json. Production web offline reload and persistent pending queue: evidence/web-offline-proof.json. The current web export is artifacts/m8-web; each native artifact directory contains an actual Hermes .hbc bundle. Final compiler/type checks are retained under evidence/.

## Corrections and attribution

The following are logged correction entries; some entries group several closely related retries, so this is not a normalized per-attempt metric. No confirmed snapback4-defect was established. The scale digest bound was a documented envelope that the first application query exceeded.

- **environment** — 1789896666 environment rejection: rm -f rejected before execution; retry used explicit Path.unlink for generated starter files only; no permission needed.
- **environment** — 1789896827 error/retry; environment: copied frozen choreography retained read-only permissions; chmod on lane copies only, reinstall. Shell login selected Node25 contrary to overlay; explicitly use Node24 PATH henceforth. Evidence: evidence/choreo-install.log, evidence/m1-probe.log. Agent-error: UI barrel is ui/index.ts; fixed import, retry export.
- **agent-error** — 1789896905 error/retry; agent-error: optional catch-all route did not match root in Expo Router; added explicit index plus catch-all. Evidence: evidence/m1-probe-retry.log.
- **agent-error** — 1789896982 correction loop agent-error: browser passed signup then duplicate-handle probe found duplicate form controls from retained Stack screens using global pathname. Use Slot for this shared router shell. Evidence: evidence/m1-acceptance-3.log.
- **agent-error** — 1789897406 correction loop agent-error: suite video path passed but choreography exposed absent composer poster on RN Web; switched bundled image resolution to Expo Asset.fromModule. Evidence: evidence/m2-choreo.log.
- **agent-error** — 1789897444 correction loop agent-error: frozen choreography expects feed tabs directly reachable after profile navigation; added feed-tab navigation to secondary screens. Evidence: evidence/m2-choreo.log.
- **agent-error** — 1789897481 verification correction agent-error: suite and choreography ran concurrently against dev state; suite-created posts pushed choreography reference out of first feed page. Serialize suites and choreography henceforth; evidence/m2-acceptance-2.log, evidence/m2-choreo.log.
- **agent-error** — 1789897520 knowledge lookup source: package guide and diagnostic; guide app/presence/sync, why E_QUARRY_TYPE. M2 reference bridge fixed using generic id rather than incompatible table reference; evidence/m2-check-*.log.
- **agent-error** — 1789897836 M3 verification: suite passes all required assertion mappings; iOS Hermes exported. Source: diagnostic; Quarry exists does not take where; rewrote unread to first bounded matching row. Evidence: evidence/m3-check.log, m3-suite.json, m3-ios.log.
- **agent-error** — 1789897876 correction loop agent-error: empty word-prefix query returns no people; add-member chooser needed explicit empty-query profile listing. Evidence: evidence/m3-choreo.log; fixed chat.candidates branch.
- **agent-error** — 1789897977 correction loop agent-error: choreography opens a new Alice–Dave DM via direct route for ordered cutoff witness; route only offered manual creation. Added deduplicated automatic opening/creation for a known-person DM route. Evidence: evidence/m3-choreo-2.log; SQL confirmed removal itself completed.
- **agent-error** — 1789898202 knowledge lookup source: web (Expo only); https://docs.expo.dev/versions/latest/sdk/video/ confirms useVideoPlayer/VideoView native playback. Source: diagnostic; reaction query missing conversation prefix made reads incomplete; added authorization prefix to reaction keys. Evidence/m4-check*.log.
- **agent-error** — 1789898274 M4 test correction agent-error: local predicted bubble appeared before server query observed accepted media; suite now waits for composer settlement before authoritative read. Evidence: evidence/m4-acceptance.log.
- **agent-error** — 1789899475 M6 correction loops agent-error: helper return syntax, presence-guard fallible profile read, write ID format E_WRITE_ID, and empty URL test data corrected; evidence/m6-check*.log, m6-sample-replay.log, m6-acceptance.log. Sources: diagnostic, package guide effects, fixture validator.
- **agent-error** — 1789899735 correction agent-error: empty accidental /tmp placeholder immediately removed; no external project/source read. All task artifacts remain in lane. M8 check syntax corrections optional lookup and qualified schedule recorded in evidence/m8-check.log.
- **ambiguous** — 1789899924 M8 correction agent-error/environment ambiguous: Metro served stale Screen after edit (debug-ui showed feed at /insights). Killed owned Expo PID80288; restarting cache. Evidence/scripts/debug-ui.mjs and web-3.log.
- **agent-error** — 1789900017 M8 choreography correction agent-error: frozen cross-device read check returns to root and expects chat rows there. Added chat overview to root; group links now use stable IDs to survive rename/duplicate names. Killed owned Metro PID23377 to avoid stale development transform. Evidence/m8-choreo.log.
- **agent-error** — 1789900179 final client correction agent-error: broad JSX replacement accidentally touched a generic; typecheck caught it and it was corrected (evidence/m8-typecheck2.log through4). Killed owned Metro PID36994 for final source reload.
- **agent-error** — 1789900302 M8 test correction agent-error: prior choreography added a sixth like to a previous ranking fixture; rerunnable trending suite now chooses a score above current maximum. Evidence/m8-acceptance-final.log and final2.log. Web offline reload and durable outbox passed: evidence/web-offline-proof.json.
- **ambiguous** — 1789900652 post-green scale stress correction ambiguous pending diagnosis: digest job parked E_BOUND heap16777216 after5chunks on scale dataset. Narrowing message count projection; evidence/scale-digest-job.json. M8 final closure waits for correction and reproof.
- **agent-error** — 1789900729 scale digest correction agent-error: narrow projection still E_BOUND; changed from whole-chat count to period-indexed message chunks with per-message idempotency markers and per-chat totals. Published guide jobs explicitly says busier chats need message paging. Evidence/scale-digest-job2.json, digest-paged-check.log, why-bound.txt. Owned scale PID29184 was identified at49363 and stopped; priorPID80819 also stopped.
- **agent-error** — 1789901030 M6 boundary correction for reporting: terminal authoring epoch1789899576 includes the checkpoint verifier authored after its first passing suite/choreography and before scale started. First-green evidence remains unchanged. No token stream available inside lane; record uses unavailable adapter, no estimates. Record-schema validator tools installed locally (Ajv8.17.1/formats3.0.1), source: model knowledge and frozen schema.
- **agent-error** — 1789901065 M8 final closure green after scale digest correction; evidence/scale-digest-job3.json state=done33949chunks580996writes; fresh real-time scheduled proof pass evidence/digest-proof.json. All requested scope implemented.

## Limits and gaps

- No product feature was struck from scope. M7 is intentionally deferred. No native simulator, device installation, APNs/FCM delivery, or hosted deployment is claimed. The exported native app uses the exact published Expo arm.
- Hidden scored probes, independent grader results, and platform binary qualification attestations were not available. Public probes are diagnostic only; no overall benchmark score is claimed.
- Harness-native token records were not provided within the permitted lane. Token totals/caps/charges are null; no estimates. The protocol base run record validates; the composed publication/grading record awaits external driver custody and grading.
- Active window/digest configs are deliberately shortened for grading. README.md documents switching to production windows and the 08:00 UTC daily schedule.
- The push seam is a durable effect log with a provider worker example. Exactly-once provider delivery requires provider idempotency; it is separate from the tested exactly-once per-period emission.
- Public profiles/posts/likes are replicated broadly. Scale probes measured authenticated server queries, not native acquisition latency or memory.
- One accidental empty /tmp placeholder was immediately removed; it contained no data. No sibling lane, prior build, or Snapback source repository was inspected.

## Hand-authored physical lines

Generated feed recipe, generated config/API/native output, copied UI/choreography, dependencies and build artifacts are excluded. Formatting is compact; counts are physical lines, not normalized complexity. Total 913 lines across 49 files.

| File | Lines |
|---|---:|
| app/[...path].tsx | 1 |
| app/_layout.tsx | 4 |
| app/index.tsx | 1 |
| scripts/acceptance.mjs | 25 |
| scripts/choreo.mjs | 4 |
| scripts/configure-digest.mjs | 2 |
| scripts/configure.mjs | 3 |
| scripts/coverage.mjs | 2 |
| scripts/custom-client-demo.mjs | 16 |
| scripts/debug-ui.mjs | 1 |
| scripts/digest-proof.mjs | 7 |
| scripts/expiry-proof.mjs | 6 |
| scripts/finalize.mjs | 17 |
| scripts/probe.mjs | 2 |
| scripts/push-worker.mjs | 4 |
| scripts/replay.mjs | 34 |
| scripts/scale-insights-proof.mjs | 1 |
| scripts/seed.mjs | 27 |
| scripts/serve-web.mjs | 2 |
| scripts/setup-identity.mjs | 2 |
| scripts/start-backend.mjs | 5 |
| scripts/start-scale.mjs | 2 |
| scripts/start-web.mjs | 4 |
| scripts/stop-owned.mjs | 4 |
| scripts/suite-m2.mjs | 17 |
| scripts/suite-m3.mjs | 8 |
| scripts/suite-m4.mjs | 8 |
| scripts/suite-m5.mjs | 9 |
| scripts/suite-m6.mjs | 7 |
| scripts/suite-m8.mjs | 7 |
| scripts/verify-scale.mjs | 20 |
| scripts/web-offline-proof.mjs | 2 |
| scripts/web-offline.mjs | 2 |
| scripts/window-proof.mjs | 2 |
| snapback/chat.q | 285 |
| snapback/digest.q | 51 |
| snapback/insights.q | 40 |
| snapback/schema.q | 125 |
| src/MediaViewer.tsx | 2 |
| src/Screen.tsx | 31 |
| src/Video.tsx | 3 |
| src/Video.web.tsx | 2 |
| src/chat.tsx | 41 |
| src/client.ts | 22 |
| src/insights.tsx | 2 |
| src/scroll.ts | 2 |
| src/search.tsx | 3 |
| src/session.tsx | 14 |
| src/social.tsx | 32 |

The experience essay was written before this tally: essay.md. Diary boundaries are in diary.md. Server cleanup is recorded in run-log.md and evidence/server-cleanup.json.

end=1789901119
