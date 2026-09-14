Clique completed M1 → M2 → M3 → M4 → M5 → M6 → M8. All seven milestones are green under the suite-plus-choreography bar. M7 is not-run, as instructed. No milestone exhausted its four-hour cap; no capability failures, aborted milestones, or blocked milestones occurred. The complete scale state verified, but the builder's strict search middle-checkpoint performance gate failed. No hidden-grader score is claimed.

Lane: astra-clique-snapback4-full-20260913. Model: gpt-6-astra; effort=medium. Backend pins were recorded before installation. The resolved public-registry packages are snapback4@0.2.12, snapback4-darwin-arm64@0.2.12, and snapback4-expo@0.2.4. There are no overrides or source builds. [Resolved dependency closure](evidence/resolved-pins.json).

Run start=1789407934; report end=1789413330; total elapsed=5396 seconds. Times below use logged milestone boundaries. “First green” is the first suite-bound, green instrument segment-summary timestamp; native exports were completed by milestone closure. M8 remained open for regression repairs and supplementary proofs after its first green. Scale execution overlapped M8 authoring on its separate clock; the table reports wall time without subtracting concurrent work.

| Milestone | Status | Start epoch | Closure epoch | Wall seconds | First green epoch |
|---|---|---:|---:|---:|---:|
| M1 | green | 1789407934 | 1789408334 | 400 | 1789408333.187 |
| M2 | green | 1789408334 | 1789408990 | 656 | 1789408964.849 |
| M3 | green | 1789408990 | 1789409460 | 470 | 1789409443.737 |
| M4 | green | 1789409460 | 1789409844 | 384 | 1789409831.385 |
| M5 | green | 1789409844 | 1789410421 | 577 | 1789410406.530 |
| M6 | green | 1789410421 | 1789411480 | 1059 | 1789411363.776 |
| M8 | green | 1789411480 | 1789412818 | 1338 | 1789411936.662 |
| M7 | not-run | — | — | — | — |

[Machine-readable milestone timing](evidence/final-milestones.json). The first-green M8 summary is preserved separately; current receipts include the final regression runs. M1–M6 historical summaries remain in evidence/milestones.json.

| Milestone | Suite tests passed | Required assertions covered | Choreography passed | Required unimplemented/skipped | Evidence |
|---|---:|---:|---:|---:|---|
| M1 | 6/6 | 7 | 3/3 (3 required) | 0 | [suite](evidence/m1-suite.json), [coverage](evidence/m1-coverage.json), [choreography](evidence/m1-choreography.jsonl) |
| M2 | 8/8 | 22 | 9/9 (9 required) | 0 | [suite](evidence/m2-suite.json), [coverage](evidence/m2-coverage.json), [choreography](evidence/m2-choreography.jsonl) |
| M3 | 5/5 | 7 | 7/7 (5 required) | 0 | [suite](evidence/m3-suite.json), [coverage](evidence/m3-coverage.json), [choreography](evidence/m3-choreography.jsonl) |
| M4 | 6/6 | 5 | 5/5 (5 required) | 0 | [suite](evidence/m4-suite.json), [coverage](evidence/m4-coverage.json), [choreography](evidence/m4-choreography.jsonl) |
| M5 | 5/5 | 6 | 4/4 (2 required) | 0 | [suite](evidence/m5-suite.json), [coverage](evidence/m5-coverage.json), [choreography](evidence/m5-choreography.jsonl) |
| M6 | 3/3 | 5 | 1/1 (1 required) | 0 | [suite](evidence/m6-suite.json), [coverage](evidence/m6-coverage.json), [choreography](evidence/m6-choreography.jsonl) |
| M8 | 3/3 | 6 | 5/5 (5 required) | 0 | [suite](evidence/m8-suite.json), [coverage](evidence/m8-coverage.json), [choreography](evidence/m8-choreography.jsonl) |

There are 36 passing suite tests, 58 suite-required assertion mappings, and 34 passing implemented choreography checks. Every current choreography summary's suite hash matches its current suite receipt. No required check was relabeled or skipped. The frozen harness records supplemental native evidence exactly as “not-recorded,” with reasons “M6 simulator evidence is recorded separately from web green” and “M8 simulator evidence is recorded separately from web green”; requiredForGreen=false. Simulator proofs were not requested. No structurally impossible required harness check was encountered.

The complete 50-action sample passes the frozen fixture validator, has one settled action receipt per action, and has all profile, follow, post variant, like/repost set/clear, reply, chat/member, message/media/view-once, quote, and reaction intents checked against actual API state. This is the builder conformance implementation, not a claim that hidden grader sampling was run. [Conformance](evidence/m6-sample-conformance.json), [settle receipts](evidence/replay-receipts.jsonl).

Supplementary proofs passed: server-enforced stale edit/delete refusal; disappearing-message absence after its deadline with no client opened before expiry; closed-client scheduled digest with a mid-period backend restart and no digest in the following quiet period; durable pending writes and offline search across process-device restart, ordered flush, and read receipts. [Window refusal](evidence/server-window-probe.json), [expiry](evidence/m5-server-expiry-probe.json), [digest](evidence/digest-proof.json), [durable replica](evidence/durable-offline-proof.json). The latter uses the published processDevice arm and is not an iOS simulator claim.

All milestones produced an iOS Hermes bundle:

| Milestone | Bundle | Bytes |
|---|---|---:|
| M1 | [entry-c4d85d00a16b8055ccce7d59b5b624dd.hbc](artifacts/m1-ios/_expo/static/js/ios/entry-c4d85d00a16b8055ccce7d59b5b624dd.hbc) | 2622784 |
| M2 | [entry-98533bb96b40e03cff7d4a4c7260334b.hbc](artifacts/m2-ios/_expo/static/js/ios/entry-98533bb96b40e03cff7d4a4c7260334b.hbc) | 2646413 |
| M3 | [entry-04d8ef7bd81cab13cfce6093d211bdb6.hbc](artifacts/m3-ios/_expo/static/js/ios/entry-04d8ef7bd81cab13cfce6093d211bdb6.hbc) | 2665784 |
| M4 | [entry-091e85ac38f45dccd51ce9969e7f68a6.hbc](artifacts/m4-ios/_expo/static/js/ios/entry-091e85ac38f45dccd51ce9969e7f68a6.hbc) | 2673200 |
| M5 | [entry-869372e53e2a696fa530e7e98fd0bef0.hbc](artifacts/m5-ios/_expo/static/js/ios/entry-869372e53e2a696fa530e7e98fd0bef0.hbc) | 2680025 |
| M6 | [entry-44a09dd5d764e1fa44baf75eba6732c1.hbc](artifacts/m6-ios/_expo/static/js/ios/entry-44a09dd5d764e1fa44baf75eba6732c1.hbc) | 2680194 |
| M8 | [entry-c71e5ac5cde80f6760e9df28d70208fd.hbc](artifacts/m8-ios/_expo/static/js/ios/entry-c71e5ac5cde80f6760e9df28d70208fd.hbc) | 2685867 |

SHA-256 values are in [native artifact inventory](evidence/native-artifacts.json). The final [web export](artifacts/m8-web/index.html) also builds. Final Quarry check: 29 tables, 17 synced, 50 operations, no problems, 13 advisory notes. TypeScript passes. Native execution uses the exact installed Expo arm; there is no native source substitution.

Scale execution used a fresh instance on port 49362, starter logs first, then the hash-pinned scale log, with replayEnabled=true and push disabled. Start=1789411480; end=1789411664; raw span=184s. Checkpoint verification/probe time inside that span=2744ms; execution excluding that work=181.256s, subject to the one-second precision of the recorded endpoints. Final verification/probes followed the execution end and took 6006ms. The chosen execution safety cap was 14,400s; no separately calibrated absolute cap was supplied. [Clock](evidence/scale-result.json).

All 167157 scale actions and 86 starter actions settled in sequence. The scale SHA-256 is b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9. Exact persisted-state verification passed at 10%, 50%, and final, including all entity counts, every per-user/per-chat map, named content, the 500-follow probe, five-follow comparison, celebrity graph and post counts, celebrity follower's exact edge list, and 50-member busy group. The final state contains 1,008 users, 5,921 follow edges, 50,228 posts, 1,002 conversations, 2,053 memberships, 100,015 messages, and 2,000 active reactions. It remains exact after M8 backfills. [Final invariant verification](evidence/scale-final-verification-after-m8.json).

Independent API paging traversed all 10,000 busy-group messages in 200 pages without duplicates and all 100 probe-user conversations. Initial deep-page probes were incomplete because a helper suppressed the continuation cursor; that defect was isolated and repaired, then the full API proof was run. Checkpoint snapshots received the same M8 schema and backfills for aggregate probes. Mutating write probes ran on a separate final-state clone, preserving the verified main replay instance.

| Builder probe | Result |
|---|---|
| Page 50 / page 1 p95 | 1.003×; pass |
| Following 500 / Following 5 p95 | 0.094×; pass |
| Celebrity-follower read / Following 5 p95 | 0.517×; pass |
| Celebrity post write / five-follower author p95 | 1.039×; pass |
| Busy-group send acknowledgement p95 | 2.641ms; no stall observed |
| Cold 100-conversation replica | 634.460ms; completed without timeout/OOM |
| Search full / 10% p95 | 1.312×; endpoint passes |
| Search 50% midpoint | 2.397ms > 2.185ms bound; **fail** |
| Insights growth | Endpoint and midpoint pass |
| Trending growth | Endpoint and midpoint pass |

[Read/aggregate probes](evidence/scale-extension.json), [write probes](evidence/scale-write-probe.json), [cold replica](evidence/scale-cold-sync.json). Measurements use local binary/localhost HTTP, 20 sequential samples after three warmups. The search miss remains a miss; no timing was padded or discarded to turn it green. These are builder diagnostics, not the rotated hidden O5 probes. Cold memory accounting records the Node host before/after, not a full process-tree memory profile.

Correction accounting uses literal correction-loop entries in run-log.md, not a retroactively normalized defect count: 13 entries; agent-error=10, snapback4-defect=2, ambiguous=1. One cursor episode was first labeled ambiguous and later isolated as a platform defect; both records remain. Initial compiler/input errors are recorded separately in the run log. [Full correction ledger](evidence/correction-ledger.json).

| Episode | Attribution | Resolution/evidence |
|---|---|---|
| Profile save forwarded row metadata | agent-error | Exact argument projection; m1-suite |
| Web asset resolver | agent-error | Browser URL/native resolver split; m2 acceptance |
| Feed navigation and retained hidden routes | agent-error | Shared tabs and Slot; m2 choreography retries |
| Virtualized pagination assertion | agent-error | Scroll to actual next-page content; acceptance-m2 |
| Admin write interrupted by navigation | agent-error | Authenticated keepalive mutation transport; m3-choreo |
| Empty-string RN child and video modal container | agent-error | Boolean condition and stable viewer wrapper; m4 evidence |
| Enum/TTL, expiry index, explicit emit fields, fixture job prefix | agent-error | Exact Quarry types/indexes and explicit fields; check logs |
| Presence recipe versus prediction classification | snapback4-defect | why chat.send reports connected as Server and predicts never; durable request plus service-only dispatcher; m6-send-why |
| Service read-rule workaround | agent-error | E_SYNC refused non-invertible audience; reverted broad reads |
| Redundant horizon read suppressed prediction | agent-error | Removed guard; stable mutation IDs and installation receipts |
| Receipt helper early return cleared outer cursor | snapback4-defect | Accumulated state preserves cursor; paging diagnostic original/fixed consoles |
| Reaction summary authoring | agent-error | Complete capped page and corrected variable/cap placement; m8-reaction-cache-check logs |
| Seed retry and predictive media test race | agent-error | Installed-segment receipts; await authoritative media settlement; regression-m4 |
| Write-probe baseline actor collision | agent-error | Explicit operation labels; invalid original measurement retained |
| Read-only copied harness/config files, missing metering neighbor | environment / agent-error handling | Changed lane copies only; preserved existing config on reconfiguration |

The remaining limitations and deviations are explicit:

- The strict builder search midpoint gate failed. No calibrated cross-backend latency or hidden-grader score is claimed.
- Native Hermes exports are present; simulator execution is not recorded. The separate durable process-device proof cannot replace a simulator proof.
- Presence prediction and helper-return/cursor interactions required the documented workarounds above. Original diagnostics are retained; no package source or earlier Snapback checkout was inspected.
- Broad public sync and the potential wide message-search merge produce advisory notes. The tested envelope completed; unbounded future growth is not claimed. Digest chunks also remain subject to published row/work ceilings.
- This is a local production-shaped build with a logged push seam. Real APNs/FCM delivery is outside the brief. The active config intentionally uses grading's shortened windows and digest period.
- The login shell selected Node 25.9.0 although the supplied environment described Node 24.18.0 first on PATH. Actual versions are recorded truthfully in setup identity; no silent claim of the intended Node version is made.
- One attempted kill used an unrecorded PID and returned ESRCH; no process was signaled. One empty temporary file was accidentally created outside the lane and immediately removed. Both deviations are logged.
- Some knowledge lookups were logged retrospectively; exact per-lookup timestamps cannot be recovered from run-log.md. Launcher PIDs were recorded at launch; surviving platform child PIDs were additionally recorded before cleanup. Cleanup signaled only recorded PIDs and left no listeners on ports 49360–49379.

[Cleanup receipt](evidence/cleanup.json), [server PID ledger](evidence/server-pids.jsonl), [run log](run-log.md), [milestone diary](diary.md), [essay written before tally](essay.md), [restart instructions](README.md).

Hand-authored physical line counts follow. They include blanks and compact/long TSX lines, so they are not normalized logical LOC. Copied UI/choreography/metering/instrument files, dependencies, generated types/config helpers, lockfile, build outputs, database state, and duplicate checkpoint schema copies are excluded. The unique paging-diagnostic additions in the scale instance are counted separately. The machine-readable inventory is evidence/hand-authored-lines.json.

| File | Hand-authored lines |
|---|---:|
| `API.md` | 43 |
| `README.md` | 31 |
| `app.json` | 1 |
| `app/_layout.tsx` | 7 |
| `app/chats.tsx` | 2 |
| `app/conversation/[...path].tsx` | 2 |
| `app/index.tsx` | 4 |
| `app/insights.tsx` | 2 |
| `app/new-chat.tsx` | 2 |
| `app/post/[id].tsx` | 2 |
| `app/profile/[handle].tsx` | 2 |
| `app/profile/edit.tsx` | 2 |
| `app/search.tsx` | 2 |
| `app/settings.tsx` | 2 |
| `babel.config.cjs` | 1 |
| `diary.md` | 20 |
| `essay.md` | 23 |
| `package.json` | 39 |
| `run-log.md` | 124 |
| `scripts/acceptance-m2.mjs` | 14 |
| `scripts/acceptance-m3.mjs` | 10 |
| `scripts/acceptance-m4.mjs` | 10 |
| `scripts/acceptance-m5.mjs` | 11 |
| `scripts/acceptance-m6.mjs` | 7 |
| `scripts/acceptance-m8.mjs` | 5 |
| `scripts/acceptance.mjs` | 19 |
| `scripts/boundary.mjs` | 2 |
| `scripts/browser-check.mjs` | 2 |
| `scripts/choreo.mjs` | 3 |
| `scripts/cleanup.mjs` | 1 |
| `scripts/cold-sync-probe.mjs` | 2 |
| `scripts/configure-digest.mjs` | 1 |
| `scripts/configure.mjs` | 2 |
| `scripts/custom-client-demo.mjs` | 6 |
| `scripts/digest-proof.mjs` | 4 |
| `scripts/durable-offline-proof.mjs` | 2 |
| `scripts/expiry-probe.mjs` | 3 |
| `scripts/offline-debug.mjs` | 2 |
| `scripts/paging-diagnostic.mjs` | 1 |
| `scripts/probe-conversation.mjs` | 2 |
| `scripts/probe-login.mjs` | 2 |
| `scripts/probe-nav.mjs` | 2 |
| `scripts/push-worker.mjs` | 3 |
| `scripts/replay.mjs` | 26 |
| `scripts/report.mjs` | 97 |
| `scripts/reset-dave.mjs` | 1 |
| `scripts/scale-extension.mjs` | 3 |
| `scripts/scale-probes.mjs` | 3 |
| `scripts/scale.mjs` | 7 |
| `scripts/seed.mjs` | 28 |
| `scripts/server.mjs` | 6 |
| `scripts/setup.mjs` | 3 |
| `scripts/verify-sample.mjs` | 5 |
| `scripts/verify-scale.py` | 47 |
| `scripts/window-probe.mjs` | 1 |
| `scripts/write-scale-probe.mjs` | 1 |
| `snapback/chat.q` | 304 |
| `snapback/client.q` | 12 |
| `snapback/insights.q` | 92 |
| `snapback/reaction-cache.q` | 32 |
| `snapback/schema.q` | 33 |
| `snapback/seed.q` | 13 |
| `snapback/social.q` | 174 |
| `snapback/test-fixtures.q` | 8 |
| `src/chat.tsx` | 16 |
| `src/device.ts` | 4 |
| `src/device.web.ts` | 4 |
| `src/feed-nav.tsx` | 4 |
| `src/session.tsx` | 20 |
| `src/social.tsx` | 6 |
| `tsconfig.json` | 1 |
| `scale-instance/snapback/client.q (diagnostic additions only)` | 11 |
| `final-report.md` | 182 |

end=1789413330
