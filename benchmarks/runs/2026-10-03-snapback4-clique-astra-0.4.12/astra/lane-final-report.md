# Clique final report

Lane: astra-clique-snapback4-full-20260913. Model: gpt-6-astra, effort=medium. All requested continuous-session milestones are green. M7 was not attempted. No scope was struck.

Start epoch: 1791043189. End epoch: 1791051146. Total wall: 7957s, including the separately timed replay and reporting. The replay overlaps M6/M8 authoring; these clocks must not be added.

## Milestone evidence

| Milestone | Status | Start epoch | Boundary end epoch | Wall seconds | First suite/choreography green | Suite tests | Choreography | Hermes |
|---|---|---:|---:|---:|---|---:|---|---|
| M1 | green | 1791043189 | 1791043957 | 768 | 2026-10-03T16:12:00.250Z | 6 passed | green | [m1-ios](artifacts/m1-ios/) |
| M2 | green | 1791043957 | 1791045280 | 1323 | 2026-10-03T16:33:31.970Z | 11 passed | green | [m2-ios](artifacts/m2-ios/) |
| M3 | green | 1791045281 | 1791046126 | 845 | 2026-10-03T16:48:01.886Z | 5 passed | green | [m3-ios](artifacts/m3-ios/) |
| M4 | green | 1791046126 | 1791047019 | 893 | 2026-10-03T16:59:14.220Z | 4 passed | green | [m4-ios](artifacts/m4-ios/) |
| M5 | green | 1791047019 | 1791047901 | 882 | 2026-10-03T17:17:25.554Z | 6 passed | green | [m5-ios](artifacts/m5-ios/) |
| M6 | green | 1791047902 | 1791048647 | 745 | 2026-10-03T17:27:46.759Z | 4 passed | green | [m6-ios](artifacts/m6-ios/) |
| M8 | green | 1791048647 | 1791049502 | 855 | 2026-10-03T17:35:39.255Z | 4 passed | green | [m8-ios](artifacts/m8-ios/) |
| M7 | not-run | — | — | — | — | — | separate fresh session | — |

Boundary wall includes native exports and supplementary verification performed before the next milestone. `acceptanceGreenEpoch` separately preserves the neutral suite/choreography first-green boundary. Full test-to-assertion coverage is in [coverage-manifest.json](coverage-manifest.json); all suite-required IDs are mapped. Each `evidence/mN-choreo.jsonl` is the final green harness receipt, with prior attempts retained separately. Every implemented check passed; no instrument skip was used.

## Scale replay

Fresh instance: scale-instance, port 49362, published CLI --replay. Start=1791048438; end=1791050679; gross wall=2241s; checkpoint verification/probe exclusion=5.544s; replay wall=2235.456s. 167243 actions settled, comprising 86 starter actions plus 167157 scale actions. SHA-256: b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9. Verification: **PASS**.

Both marker checkpoints and final state passed manifest accounting and independent API samples, including all named O5 fixtures and full paging of the busy group. [scale-sql-verification.json](evidence/scale-sql-verification.json) independently checks full application-view totals, every user following/membership count, every chat message count, and every group roster count against the combined manifest. Authentication-user count is evidenced by settled registrations and distinct profiles; internal auth tables were not inspected. Detailed checkpoint latency samples are retained, but they are supplemental builder probes, not a hidden-grader O5 score.

After replay, the final M8 schema adopted additively on that corpus in 69027ms. Final-envelope Insights and Trending checks and 27 named-entity/media-hash checks passed; see evidence/scale-m8-probes.json. This adoption and supplementary verification are outside the recorded replay clock.

The supplied instrument leaves its pilot-calibrated replay cap unspecified. A 14400s execution safety limit was recorded; no calibrated O5 cap fraction or score is claimed. Replay setup includes the fresh starter baseline in its conservative clock.

## Packages and artifacts

- snapback4@0.4.12
- snapback4-expo@0.4.12
- snapback4-darwin-arm64@0.4.12

All resolve from the public npm registry; the Darwin arm64 optional binary is the installed host arm. The native client uses snapback4-expo, not a source build. [native-artifacts.json](native-artifacts.json) records every milestone Hermes path, byte size, and SHA-256. [API.md](API.md) and [custom-client-demo.mjs](scripts/custom-client-demo.mjs) document and exercise third-party bearer access.

## Additional proofs

- Server edit-window rejection and immediate tombstone asset revocation: evidence/m4-server-windows.json.
- Both clients closed at real expiry; server message, media, and search removal: evidence/m5-server-expiry.json.
- Token-only API operations and server logout refusal: evidence/m6-token-revocation.json.
- Supplementary browser cold-offline history/search: evidence/m6-cold-web.json.
- Durable queued messages across offline page closure, ordered flush, receipts, same-account edits/reactions: evidence/m8-durable-web.json.
- Real scheduled digest, all clients closed, exact counts, authorization/tombstone exclusions, inactivity and backend restart: evidence/m8-digest-proof.json.

## Corrections and attribution

environment: 3; agent-error: 20; ambiguous: 2. This is a count of logged correction/error episodes, not model tokens or a normalized efficiency score. No confirmed snapback4 defect was established. Full timestamped entries and evidence pointers are in [run-log.md](run-log.md) and [run-details.json](run-details.json).

- **environment**: 1791043299 error attribution=environment evidence=PATH node resolved v22.23.2 despite ENVIRONMENT; workaround use /Users/ccheever/.volta/tools/image/node/24.18.0/bin explicitly
- **environment**: 1791043594 error/retry attribution=environment source=diagnostic evidence=evidence/choreography-install.log copied read-only mode; chmod lane copies only
- **agent-error**: 1791043695 error attribution=agent-error evidence=evidence/m1-types.txt FeedTabs prop corrected value to active before completion claim
- **agent-error**: 1791043777 correction-loop attribution=agent-error evidence=evidence/m1-acceptance.log,evidence/m1-screen.png root route unmatched; replace unsupported optional catchall with index and catchall
- **environment**: 1791043845 error/retry attribution=environment source=diagnostic evidence=evidence/m1-choreo.log copied choreography has adjacent module dependencies; copy instrument modules into lane
- **agent-error**: 1791043905 correction-loop attribution=agent-error evidence=evidence/m1-choreo-2.log export replaced web directory during choreography setup; serialize exports and browser runs
- **agent-error**: 1791044350 correction-loop attribution=agent-error evidence=evidence/m2-acceptance.log pagination test assumed Alice Following had 20+ items; establish 20+ visible fixture posts through follows before checking pages
- **agent-error**: 1791044381 correction-loop attribution=agent-error source=package README/guide evidence=evidence/m2-acceptance-2.log,evidence/guide-feeds.txt suite assumed synchronous follower fan-out; await documented eventual feed delivery
- **agent-error**: 1791044559 correction-loop attribution=agent-error evidence=evidence/m2-choreo.log harness switches feed tabs directly from profiles; keep feed navigation tabs in persistent shell
- **agent-error**: 1791044607 correction-loop attribution=agent-error evidence=evidence/m2-choreo.log repost briefly lacked attribution while actor loaded; render attribution shell immediately
- **agent-error**: 1791044843 correction-loop attribution=agent-error evidence=evidence/m2-navigation.png,evidence/m2-choreo-2.log feed selection state reset on route remount; encode selected tab in route URL
- **agent-error**: 1791045163 bookkeeping correction attribution=agent-error evidence=milestones.json use retained green summary timestamp for terminal wall, preserve later reportedAt separately
- **agent-error**: 1791045434 error/rewrite attribution=agent-error source=diagnostic evidence=evidence/m3-check.txt,evidence/why-self-equality.txt compiler caught inner-row self-equality; applied its named-key rewrite
- **ambiguous**: 1791045992 error/retry attribution=ambiguous evidence=evidence/m3-choreo.log,evidence/m3-group-probe.log group read missed 10s once; focused three-client reproduction immediately read; retry without concurrent export
- **agent-error**: 1791046388 error/rewrite attribution=agent-error source=diagnostic evidence=evidence/m4-check.txt,evidence/m4-check-2.txt write rules cannot traverse reference; mutation pins membership, read-through pins reads
- **agent-error**: 1791046660 correction-loop attribution=agent-error evidence=evidence/m4-acceptance.log composer held busy until write settlement and could clear newer draft; capture/clear draft at dispatch, release on durable admission
- **agent-error**: 1791046660 correction-loop attribution=agent-error evidence=evidence/m4-choreo.log media viewer selector appeared only after bytes; mount stable viewer wrapper through loading
- **agent-error**: 1791047142 milestone=M5 correction-loop attribution=agent-error source=diagnostic evidence=evidence/m5-check.txt E_QUARRY_TYPE optional chat setting; coalesce after membership guard
- **agent-error**: 1791047242 milestone=M5 correction-loop attribution=agent-error source=diagnostic evidence=evidence/m5-acceptance.log global search legitimately finds same seeded text in two chats; test selects first and checks group headers
- **agent-error**: 1791048238 milestone=M6 correction-loop attribution=agent-error source=diagnostic evidence=evidence/sample-replay.log,evidence/m6-types.txt notification used unset optional fields of inserted row (E_FIELD missing field photo); derive preview from operation args; nullable reaction picker normalized
- **agent-error**: 1791048333 milestone=M6 correction-loop attribution=agent-error source=diagnostic evidence=evidence/sample-replay-2.log,evidence/replay-write-aliases.json original terminal E_FIELD receipt is durable; new explicit repair intent for failed sample action after schema fix, preserving entity ID and previous successful action IDs
- **agent-error**: 1791048438 milestone=M6 correction-loop attribution=agent-error source=diagnostic evidence=evidence/m6-acceptance.log push test assumed pre-choreography display name; compare live sender profile. Initial scale launch wrong working directory refused before process start; corrected workdir.
- **ambiguous**: 1791049149 milestone=M8 error attribution=ambiguous source=diagnostic evidence=evidence/m8-durable-web.log supplementary restart probe observed queued persistence and ordered arrival but read receipt wait timed out; capturing receiver visibility on repeat
- **agent-error**: 1791049504 timing correction attribution=agent-error source=diagnostic evidence=milestones.json milestone end uses actual boundary epoch (including native export and supplementary verification), acceptanceGreenEpoch preserves earlier suite/choreography first-green instant
- **agent-error**: 1791050878 correction-loop attribution=agent-error source=diagnostic evidence=evidence/scale-sql-verification.log expensive full-corpus inspection-view join canceled by exact recorded PID=33458; replace with grouped counts and join small maps in verification client, preserving complete manifest checks. Added actual binary grandchildren to PID ledger before cleanup.

## Hand-authored lines

1003 physical lines across 48 authored/adapted source, test, and configuration files. Copied UI, generated files, package locks, artifacts, prose, and runtime state are excluded. Entire adapted files are counted; compact formatting makes this a physical-line measure, not a complexity measure. The detailed methodology is in [hand-authored-lines.json](hand-authored-lines.json).

| File | Lines |
|---|---:|
| app.json | 25 |
| app/[...path].tsx | 1 |
| app/_layout.tsx | 4 |
| app/index.tsx | 1 |
| choreography-adapter.json | 10 |
| package.json | 47 |
| scripts/acceptance.mjs | 37 |
| scripts/boundary.mjs | 4 |
| scripts/build-report.mjs | 23 |
| scripts/choreo.mjs | 4 |
| scripts/cleanup.mjs | 5 |
| scripts/configure.mjs | 8 |
| scripts/custom-client-demo.mjs | 6 |
| scripts/finalize-scale.mjs | 4 |
| scripts/probe-api-token.mjs | 2 |
| scripts/probe-cold-offline.mjs | 2 |
| scripts/probe-digest.mjs | 13 |
| scripts/probe-durable-web.mjs | 4 |
| scripts/probe-expiry.mjs | 2 |
| scripts/probe-group.mjs | 3 |
| scripts/probe-windows.mjs | 2 |
| scripts/replay.mjs | 23 |
| scripts/sample-replay.mjs | 2 |
| scripts/scale-final-probes.mjs | 11 |
| scripts/scale-replay.mjs | 9 |
| scripts/seed.mjs | 42 |
| scripts/serve.mjs | 3 |
| scripts/setup-identity.mjs | 3 |
| scripts/test-m2.mjs | 23 |
| scripts/test-m3.mjs | 14 |
| scripts/test-m4.mjs | 10 |
| scripts/test-m5.mjs | 10 |
| scripts/test-m6.mjs | 8 |
| scripts/test-m8.mjs | 8 |
| scripts/verification-server.mjs | 2 |
| scripts/verify-replay.mjs | 12 |
| scripts/verify-scale-sql.mjs | 10 |
| snapback/schema.q | 421 |
| snapback/workers/push.mjs | 13 |
| src/Chats.tsx | 66 |
| src/Feed.tsx | 34 |
| src/Insights.tsx | 2 |
| src/Search.tsx | 10 |
| src/Shell.tsx | 41 |
| src/Video.native.tsx | 2 |
| src/Video.tsx | 2 |
| src/Video.web.tsx | 2 |
| src/client.ts | 13 |

## Candid limitations

- No simulator execution is claimed; every milestone has the Hermes bundle artifact required by ENVIRONMENT. Browser restart proofs are explicitly supplementary.
- New media uploads require connectivity. The durable replica retains ordinary viewed media and text/interaction intents; once media is never retained. Search outside acquired history is labeled partial.
- The push seam logs an idempotent local provider receipt; APNs/FCM integration is outside the brief.
- Independent hidden authorization/performance grading was not run by this builder. No grading score, latency SLO, or token estimate is invented. The base run-record schema validates; driver-stamped metering/grading extension fields await the orchestrator.
- The runtime is a local development deployment, not a hosted production rollout. Populated-store aggregate adoption was atomic and took about 69 seconds; deployment planning must account for that pause. There were two unresolved intermittent browser timing observations (M3 group opening and a supplementary M8 receipt wait); focused/unchanged-code reruns passed, so their attribution remains ambiguous.
- The sample adapter preserves one explicit repaired write-ID alias after an application E_FIELD refusal. The full scale corpus uses its original stable entity/action IDs and no action class is skipped.

Read [essay.md](essay.md) for the qualitative comparison and [diary.md](diary.md) for milestone experience. Server shutdown evidence is in evidence/process-cleanup.json; only recorded owned PIDs are signaled.

end=1791051146
