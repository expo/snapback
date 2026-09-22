# Clique — final report

Lane `astra-clique-snapback4-full-20260913`; model `gpt-6-astra`, effort `medium`.

M1 → M2 → M3 → M4 → M5 → M6 → M8 are green under the required suite plus frozen choreography bar. M7 was not attempted, as instructed. No capability failure or instrument skip was used to waive required web behavior.

Raw lane start=1790104365; end=1790109098.537; elapsed=4733.537 seconds. Exact resolved pins: `snapback4@0.2.32`, `snapback4-expo@0.2.23` ([receipt](evidence/resolved-pins.json)).

## Milestone clocks and evidence

| Milestone | Status | Start epoch | First-green/end epoch | Wall s | Latest delivery verification |
|---|---|---:|---:|---:|---|
| M1 | green | 1790104365 | 1790104890.799 | 525.799 | 2026-09-22T19:21:30.799Z |
| M2 | green | 1790104908 | 1790105297.040 | 389.040 | 2026-09-22T19:28:17.040Z |
| M3 | green | 1790105314 | 1790105661.944 | 347.944 | 2026-09-22T19:34:21.944Z |
| M4 | green | 1790105720 | 1790105854.460 | 134.460 | 2026-09-22T19:37:34.460Z |
| M5 | green | 1790105894 | 1790106476.844 | 582.844 | 2026-09-22T19:47:56.844Z |
| M6 | green | 1790106517 | 1790106851.104 | 334.104 | 2026-09-22T19:59:42.017Z |
| M8 | green | 1790107210 | 1790107834.809 | 624.809 | 2026-09-22T20:15:02.478Z |
| M7 | not-run | — | — | — | Separate fresh session required |

First-green/end is the earliest neutral combined green receipt, not the later diary entry. Rechecks and delivery polish after first green remain in the raw lane wall. M6 scale execution overlapped independent M8 authoring; the clocks are reported separately and must not be summed as disjoint wall phases. M8 schema replay follows the original replay. Token totals and exact phase splits are null: no native usage tree was supplied inside this authorized lane, and none was estimated.

| Milestone | Suite | Required choreography | Hermes artifact |
|---|---|---|---|
| M1 | [pass](evidence/suite-m1.json) | [3 required; 3/3 total pass](evidence/choreo-m1.jsonl) | [1 bundle](artifacts/m1-ios/metadata.json) |
| M2 | [pass](evidence/suite-m2.json) | [9 required; 9/9 total pass](evidence/choreo-m2-1790105261698.jsonl) | [1 bundle](artifacts/m2-ios/metadata.json) |
| M3 | [pass](evidence/suite-m3.json) | [5 required; 7/7 total pass](evidence/choreo-m3-1790105622910.jsonl) | [1 bundle](artifacts/m3-ios/metadata.json) |
| M4 | [pass](evidence/suite-m4.json) | [5 required; 5/5 total pass](evidence/choreo-m4-1790105834262.jsonl) | [1 bundle](artifacts/m4-ios/metadata.json) |
| M5 | [pass](evidence/suite-m5.json) | [2 required; 4/4 total pass](evidence/choreo-m5-1790106138268.jsonl) | [1 bundle](artifacts/m5-ios/metadata.json) |
| M6 | [pass](evidence/suite-m6-1790106959333.json) | [1 required; 1/1 total pass](evidence/choreo-m6-1790107180000.jsonl) | [1 bundle](artifacts/m6-ios/metadata.json) |
| M8 | [pass](evidence/suite-m8-1790108095850.json) | [5 required; 5/5 total pass](evidence/choreo-m8-1790108095889.jsonl) | [1 bundle](artifacts/m8-ios/metadata.json) |

[Coverage manifest](coverage-manifest.json) maps every suite-required ID to a test. Each listed passing suite retains its choreography-bound hash. Hash mismatches: []. M6/M8 optional simulator receipts are explicitly `not-recorded`, requiredForGreen=false; the requested Hermes exports exist. Browser cold-offline restart is supplemental evidence, not a simulator substitute.

## Scale replay

Original fresh instance: start=1790107199.529; end=1790108075.777; wall=876.248s; verification/probes excluded=188.754s; replay=687.494s; verification=pass. [Raw result](evidence/scale-result.json).

At 10%, 50%, and final, independent read-only SQL verified every published entity count, every per-user following and conversation count, every per-chat message count, every group roster count, and named celebrity/busy-chat fixtures. API probes paged the busy chat to its complete count and exercised Following, search and deep history. All 13 action verbs used the normal authenticated write path; media was uploaded and actions settled sequentially.

M8 fresh-instance replay: start=1790108105.998; end=1790109006.696; wall=900.698s; excluded=197.256s; replay=703.442s; verification=pass. [Raw result](evidence/m8-scale-result.json). Celebrity write probes add posts only after the final invariant verification.

Local probes use 3 warmups and 20 retained sequential samples. These are envelope checks, not cross-backend speed comparisons. No calibrated O5 absolute ceiling or independent grader score is invented.

| Degradation check | Outcome | Details |
|---|---|---|
| history page50/page1 | pass | {"ratio": 1.0187, "limit": 3} |
| 500-follow/5-follow | pass | {"ratio": 1.032, "limit": 3} |
| global search full/10% | pass | {"ratio": 0.8094, "limit": 3} |
| global search 50% curve | pass | {"observed": 16.4635, "limit": 19.8358} |
| Insights full/10% | pass | {"ratio": 0.7512, "limit": 3} |
| Insights 50% curve | pass | {"observed": 1.6636, "limit": 2.1463} |
| Trending full/10% | pass | {"ratio": 0.9797, "limit": 3} |
| Trending 50% curve | pass | {"observed": 2.0031, "limit": 2.6915} |
| celebrity following/5-follow | pass | {"ratio": 1.1137, "limit": 3} |
| celebrity write/5-follower write | pass | {"ratio": 0.6565, "limit": 3} |
| cold sync under 30s | pass | {"milliseconds": 5173.7553} |

[Raw measurements and checks](evidence/degradation-checks.json). Any failed degradation condition remains a scale gap even though authoring milestones are green.

## Focused verification

- [Scheduled digest](evidence/digest-proof.json): actual two-minute schedule, all clients closed, exact authorized counts, tombstone exclusion, quiet persona omitted, restart without duplicate, and empty following period without emission.
- [Server expiry](evidence/expiry-no-clients.jsonl): clients closed through expiry; history absent and asset access refused.
- [Full-corpus cold device](evidence/cold-scale-proof.json): separately sampled Node and owned interpreter RSS, complete acquisition and 100-conversation inbox under 30 seconds.
- [Cold-offline browser restart](evidence/offline-restart-proof.json): pending queue persisted, reopened offline, then flushed in order and reached read.
- [Same-account edit/reaction stream](evidence/same-account-proof.json): independent sessions observe sends, edits and arbitrary-emoji reactions live.
- [Final typecheck](evidence/typecheck-final.log), [Quarry check](evidence/check-delivery.log), and [production configuration compile](evidence/check-production-config.log).
- [Custom-client documentation](API.md) and [headless demo](scripts/custom-client-demo.mjs).

## Correction loops and attribution

- **environment** — 1790104588 server PID=41258 port=49361; correction attribution=environment evidence=evidence/install-choreography.log copied permissions repaired; agent-error shell removal rejected, moved starter worker instead
- **agent-error** — 1790104656 error/retry attribution=agent-error source=diagnostic evidence=evidence/seed-m1.jsonl E_WRITE_ID; fixed seed to mintId. Environment PATH is Node25 contrary overlay; verify Node24 executable.
- **agent-error** — 1790104793 error/retry attribution=agent-error source=diagnostic evidence=evidence/debug.png Expo optional catchall unmatched; added index and supported catchall.
- **environment** — 1790104890 correction attribution=environment evidence=evidence/choreo-m1.log harness copy requires sibling metering/observations.mjs; copied frozen support directory.
- **environment** — 1790105183 error/retry attribution=environment source=fixture evidence=evidence/choreo-m2.log frozen harness default media root mismatches flattened instrument; added authorized fixture adapter.
- **agent-error** — 1790105261 correction attribution=agent-error evidence=evidence/choreo-m2-retry.log follow test requires reachable tabs while on profile; added persistent feed navigation tabs to secondary screens.
- **agent-error** — 1790105622 correction attribution=agent-error source=diagnostic evidence=evidence/choreo-m3.log empty words search cannot enumerate add-member candidates; added explicit all-profile page for blank query.
- **agent-error** — 1790105831 M4 error/retry attribution=agent-error evidence=evidence/acceptance-m4.log test read raced local pending UI; wait for authoritative media settlement before assertions.
- **ambiguous** — 1790106122 error/retry attribution=ambiguous evidence=evidence/acceptance-m5.log Metro served stale generated API lacking search; clear cache restart PID=72752 port=49361 Node24
- **ambiguous** — 1790107198 M6 correction attribution=ambiguous intermittent offline choreography timeout; unchanged repeat passed. Not claimed fixed. evidence=evidence/choreo-m6-final.log,evidence/choreo-m6-retry.log
- **agent-error** — 1790107578 M8 correction attribution=agent-error invalid query : server and rule predicate spelling; followed diagnostic, used online-only maintains and exists terms; evidence=evidence/check-m8-first.log,evidence/check-m8-fourth.log
- **snapback4-defect** — 1790107578 M8 correction attribution=snapback4-defect generated nullable-object array type rendered object | null[]; avoided nullable row with required point lookup; evidence=run-log.md generated api prior revision declaration insights.trending
- **agent-error** — 1790107578 M8 correction attribution=agent-error suite awaited nonexistent RN Web button role; screenshot showed correct UI; switched to visible exact text; evidence=evidence/acceptance-m8-first.log,evidence/acceptance-m8-second.log
- **agent-error** — 1790107938 M8 correction attribution=agent-error cold route waited for sent createDM result even with cached pair; query cached pair first; acquisition flag now gates offline composer; evidence=src/Chat.tsx,evidence/offline-restart-proof.json
- **ambiguous** — 1790107938 M8 correction attribution=ambiguous frozen live/offline timeouts repeated despite focused three-context proofs passing; latest complete choreography passes after acquisition and route changes, causal diagnosis not proven; evidence=evidence/choreo-m8-first.log,evidence/choreo-m8-second.log,evidence/choreo-m8-third.log
- **agent-error** — 1790107938 M8 correction attribution=agent-error digest proof assumed main-instance token file existed in fresh instance; issued store-specific observer token through CLI; evidence=evidence/digest-proof.log,evidence/digest-proof-retry.log
- **agent-error** — 1790107938 M8 correction attribution=agent-error web restart proof checked read before stream settled; replaced immediate assertion with observable wait; evidence=evidence/offline-restart-proof-retry.log,evidence/offline-restart-proof-final.log
- **agent-error** — 1790108310 delivery correction attribution=agent-error pending-state UI follow-up: RN uses accessibilityLiveRegion, fixed import and overbroad text replacement; typecheck clean; evidence=evidence/typecheck-pending.log,evidence/typecheck-pending-retry.log

These are retained observed correction episodes, not estimated tool-call or token counts. Failed runs and unchanged retries remain on disk.

## Hand-authored lines by file

Raw physical lines after formatting; generated API, exports, dependencies, fixture/UI/harness copies and duplicate instance schemas are excluded. The feed recipe is compared to a fresh generation from the same published package and flags; only its one added index line counts. Compiled window/digest constants and copied fixture configuration are generated/copied, not hand-authored. Edited application configuration is counted as whole files, with scaffold attribution.

| File | Raw lines | Hand-authored lines counted |
|---|---:|---:|
| `src/client.ts` | 59 | 59 |
| `src/following.ts` | 36 | 36 |
| `src/Chat.tsx` | 557 | 557 |
| `src/Insights.tsx` | 101 | 101 |
| `src/Search.tsx` | 84 | 84 |
| `src/Shell.tsx` | 324 | 324 |
| `src/Social.tsx` | 244 | 244 |
| `src/Video.native.tsx` | 12 | 12 |
| `src/Video.tsx` | 12 | 12 |
| `app/[...path].tsx` | 1 | 1 |
| `app/_layout.tsx` | 4 | 4 |
| `app/index.tsx` | 1 | 1 |
| `scripts/acceptance-m2.mjs` | 183 | 183 |
| `scripts/acceptance-m3.mjs` | 112 | 112 |
| `scripts/acceptance-m4.mjs` | 99 | 99 |
| `scripts/acceptance-m5.mjs` | 108 | 108 |
| `scripts/acceptance-m6.mjs` | 159 | 159 |
| `scripts/acceptance-m8.mjs` | 155 | 155 |
| `scripts/acceptance.mjs` | 157 | 157 |
| `scripts/build-shell.mjs` | 19 | 19 |
| `scripts/capture-product.mjs` | 22 | 22 |
| `scripts/choreo.mjs` | 30 | 30 |
| `scripts/cold-scale-proof.mjs` | 82 | 82 |
| `scripts/configure.mjs` | 14 | 14 |
| `scripts/custom-client-demo.mjs` | 76 | 76 |
| `scripts/debug-choreo-like.mjs` | 64 | 64 |
| `scripts/debug-multidevice.mjs` | 60 | 60 |
| `scripts/debug-offline.mjs` | 49 | 49 |
| `scripts/digest-proof.mjs` | 171 | 171 |
| `scripts/expiry-proof.mjs` | 63 | 63 |
| `scripts/m8-scale-probes.mjs` | 97 | 97 |
| `scripts/offline-restart-proof.mjs` | 115 | 115 |
| `scripts/record-boundary.mjs` | 53 | 53 |
| `scripts/replay.mjs` | 227 | 227 |
| `scripts/run-m8-scale.mjs` | 84 | 84 |
| `scripts/run-scale.mjs` | 81 | 81 |
| `scripts/same-account-proof.mjs` | 61 | 61 |
| `scripts/seed.mjs` | 121 | 121 |
| `scripts/serve-web.mjs` | 52 | 52 |
| `scripts/validate-record.mjs` | 46 | 46 |
| `scripts/verify-scale.mjs` | 162 | 162 |
| `scripts/author-m8.py` | 3 | 3 |
| `scripts/cleanup-servers.py` | 18 | 18 |
| `scripts/finalize-report.py` | 74 | 74 |
| `scripts/log-m8-progress.py` | 5 | 5 |
| `snapback/chat.q` | 156 | 156 |
| `snapback/digest.q` | 38 | 38 |
| `snapback/feed.q` | 258 | 1 |
| `snapback/insights.q` | 51 | 51 |
| `snapback/media.q` | 51 | 51 |
| `snapback/push.q` | 7 | 7 |
| `snapback/schema.q` | 32 | 32 |
| `snapback/search.q` | 23 | 23 |
| `snapback/social.q` | 100 | 100 |
| `package.json` | 49 | 49 |
| `app.json` | 34 | 34 |
| `babel.config.js` | 4 | 4 |
| `metro.config.js` | 8 | 8 |
| `tsconfig.json` | 17 | 17 |

Counted source/test/tool lines: 4828 across 59 files. [Machine-readable accounting](evidence/line-counts.json). Documentation is separate: README.md: 62 lines, API.md: 39 lines, diary.md: 26 lines, essay.md: 25 lines.

## Gaps and limits

- No iOS simulator, signed app, hosted deployment, or external APNs/FCM delivery claim. The native deliverables are Hermes exports; push delivery is the required durable logged seam.
- Intermittent M6/M8 choreography timeouts were observed. Later complete passes follow acquisition/cached-routing improvements, but causal attribution for every earlier timeout remains ambiguous.
- A generated nullable-object array type produced an incorrect TypeScript union shape; requiring the post reference before shaping avoided it. No generated package code was edited.
- Public social tables and inherited replicated aggregates have a substantial cold-device footprint. See the cold-sync probe before extrapolating beyond this corpus.
- Digest work is exact inside one recipient transaction and subject to the package job meter; explicit membership/chat-count guards refuse excess instead of silently truncating. Larger combined recipient work can still hit `E_BOUND`.
- The fixture group-title route returns the first matching visible title and has compiler completeness notes; ordinary app navigation uses stable conversation IDs.
- Early login shells selected Node 25.9.0 despite the overlay. Work switched to the pinned Node 24.18.0; the original setup receipts remain, with the discrepancy documented.
- `run-record.json` is a builder evidence record valid against the base shape only. Full composed driver/grader custody, native token join, independent scoring and M7 are pending external instrumentation; none is fabricated. The essay was written before the final tally.

All work and evidence remain in this lane. Servers are stopped by recorded exact PIDs; see [cleanup receipt](evidence/server-cleanup.json).

end=1790109098
