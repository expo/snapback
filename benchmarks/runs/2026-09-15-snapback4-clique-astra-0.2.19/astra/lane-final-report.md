# Clique — final report

Lane **astra-clique-snapback4-full-20260913** · model **gpt-6-astra**, effort **medium**.

**M1, M2, M3, M4, M5, M6 and M8 are green. M7 was not run, as instructed.** The final fresh replay conforms to the combined manifest. All 16 builder-measured degradation gates pass. No milestone hit its four-hour safety limit.

## Raw clocks and milestone evidence

Run start: **1789457993**. Run end: **1789464306**. Gross session wall: **6313 seconds**.

The boundary clocks below record the continuous milestone sequence, including initial orientation in M1. Later source review, performance repair and final regressions are recorded separately below; they do not erase the first-green receipts. Replay clocks overlap some post-green authoring and must not be summed as exclusive phases.

| Milestone | Status | Start epoch | Boundary end epoch | Wall seconds | First web-green epoch | Suite coverage | Choreography |
|---|---|---:|---:|---:|---:|---:|---:|
| M1 | green | 1789457993 | 1789458514 | 521 | 1789458495.808 | 7/7 | 3/3 |
| M2 | green | 1789458514 | 1789459073 | 559 | 1789459047.043 | 22/22 | 9/9 |
| M3 | green | 1789459073 | 1789459672 | 599 | 1789459608.407 | 7/7 | 7/7 |
| M4 | green | 1789459672 | 1789459984 | 312 | 1789459958.455 | 5/5 | 5/5 |
| M5 | green | 1789459984 | 1789460885 | 901 | 1789460865.427 | 6/6 | 4/4 |
| M6 | green | 1789460886 | 1789461285 | 399 | 1789461136.629 | 5/5 | 1/1 |
| M8 | green | 1789461285 | 1789461914 | 629 | 1789461713.701 | 6/6 | 5/5 |
| M7 | not-run | — | — | — | — | — | — |

Final regression receipts: M6 **1789463603.76**, M8 **1789464236.216**. M8 post-green refinements included dense-feed performance, receipt membership seats, terminal pending labels and the initial sync barrier. Its gross start-to-final-validation span is 2951.216 seconds, including separately timed replay work; still below four hours.

Every latest suite maps all required assertion IDs to actual tests. JSONL receipts and coverage files are under [evidence](evidence/). M5's two implemented optional browser checks also passed. No instrument check was relabeled or skipped. Simulator supplemental records are explicitly not recorded; the environment required exports rather than simulator proofs.

## Scale replay and verification

Final fresh instance: `scale-instance-1789462500234`. Pins and runtime replay-mode flag are preserved there. A later query-only change adds the unread indication; the supplemental full-envelope process-device proof adopts that final query on an isolated copy. Replay mutations, stored schema, invariants and timed feed/search/insights operations are unchanged.

- Start **1789462500.234**, end **1789462904.209**.
- Gross wall **403.975 s**; checkpoint verification/probe pauses **187.396 s**; active replay **216.579 s**.
- **167243** authoritative actions: 86 starter + 167,157 scale; all 13 verbs, real registrations and media uploads.
- **1,008 users/profiles; 5,921 follow edges; 50,228 posts; 100,015 messages; 1,002 conversations; 2,053 memberships.** Exact per-user/per-chat/group counts and both checkpoint manifests passed. The busy group was paged through all 10,000 messages. Named profiles/assets/posts/messages/quotes/reactions/rosters were independently checked via public APIs.
- Write probes ran on stopped disposable copies, preserving the canonical corpus. Replay-mode suppressed notification and digest emission.
- The full-envelope published process device acquired 100 conversations in **235.696 ms**, reopened offline, searched cached messages and preserved/flushed a queued write across process restart. This is shared-interpreter evidence, not an iOS UI execution claim.

See [scale-result.json](evidence/scale-result.json), [final verification](evidence/scale-final-verification.json), [performance gates](evidence/performance-gates.json), and [per-action receipts](evidence/scale-settle-receipts.jsonl). Two failed attempts are retained: attempt 1 hit an idle HTTP reset during 10% verification; attempt 2 settled the complete corpus but its named verifier used the wrong reply/type mapping. Their raw clocks remain in `evidence/scale-attempt1/scale-result.json` and `evidence/scale-attempt2/scale-result.json`. No calibrated absolute O5 score or hidden probe execution is claimed.

## Native artifacts and package closure

| Milestone | Hermes artifact | Bytes |
|---|---|---:|
| M1 | [bundle](artifacts/m1-ios-final/_expo/static/js/ios/entry-20a5a61952bda74ba1b60caee0b52011.hbc) | 2652797 |
| M2 | [bundle](artifacts/m2-ios-final/_expo/static/js/ios/entry-d7225da4023dbf4952e711a5e098cded.hbc) | 2676231 |
| M3 | [bundle](artifacts/m3-ios-final/_expo/static/js/ios/entry-967df4ebea013093752cdc462032fa01.hbc) | 2696499 |
| M4 | [bundle](artifacts/m4-ios-final/_expo/static/js/ios/entry-4b61d693d96a3db8c58bba2ccd3600fc.hbc) | 2704674 |
| M5 | [bundle](artifacts/m5-ios-final/_expo/static/js/ios/entry-3e352f4f7f962296ac916ee0d44fec89.hbc) | 2713394 |
| M6 | [bundle](artifacts/m6-ios-final/_expo/static/js/ios/entry-3e352f4f7f962296ac916ee0d44fec89.hbc) | 2713393 |
| M8 | [bundle](artifacts/m8-ios-final/_expo/static/js/ios/entry-b4b78d732bf4e7366a4c25876e7bfe5b.hbc) | 2718933 |

SHA-256 hashes: [native-artifacts.json](evidence/native-artifacts.json). Exact backend pins: **snapback4@0.2.19**, **snapback4-expo@0.2.10**. Resolved Expo **57.0.22**, React Native **0.86.3**, Expo Router **57.0.21**. Full closure is pinned by package-lock.json; top-level resolutions are in [resolved-packages.json](evidence/resolved-packages.json).

## Corrections and attribution

28 grouped correction episodes: 25 agent-error, 2 environment, 1 ambiguous; **0 demonstrated snapback4 defects**. Related compiler iterations are grouped under their originating design change, not inflated into separate completed-work loops. First-pass syntax errors remain timestamped in run-log.md.

- **agent-error** — M1 routing/scaffold integration, watch mode, and retained duplicate screens. Evidence: [evidence/m1-acceptance.log](evidence/m1-acceptance.log).
- **agent-error** — M1 edit form initialized before profile hydration. Evidence: [evidence/m1-failure.txt](evidence/m1-failure.txt).
- **environment** — Copied choreography needed sibling support directories and Node24 path correction. Evidence: [run-log.md](run-log.md).
- **agent-error** — M2 index ambiguity corrected by published mechanical fix. Evidence: [evidence/m2-check-fix.log](evidence/m2-check-fix.log).
- **environment** — Harness default fixture directory assumed its original repository layout. Evidence: [evidence/adapter.json](evidence/adapter.json).
- **agent-error** — Feed tabs were not reachable from profile/thread navigation. Evidence: [evidence/m2-choreo.jsonl](evidence/m2-choreo.jsonl).
- **agent-error** — Concurrent suite writes displaced the choreography feed target; serialized execution. Evidence: [evidence/m2-attempt2/](evidence/m2-attempt2/).
- **agent-error** — Membership mutation admission lost to full-page navigation; keepalive control path. Evidence: [evidence/m3-member-smoke.log](evidence/m3-member-smoke.log).
- **agent-error** — Send completion cleared a subsequent draft. Evidence: [evidence/m4-failure.txt](evidence/m4-failure.txt).
- **agent-error** — Media viewer selector root mounted after async asset acquisition. Evidence: [evidence/m4-choreo.jsonl](evidence/m4-choreo.jsonl).
- **agent-error** — M5 suite expected title case while kit uppercased headings. Evidence: [run-log.md](run-log.md).
- **agent-error** — Isolated expiry setup omitted required profiles. Evidence: [run-log.md](run-log.md).
- **agent-error** — Notification block initially attached to wrong mutation. Evidence: [run-log.md](run-log.md).
- **agent-error** — Filtered recipient list lacked complete-page proof; original membership iteration required. Evidence: [evidence/guide-effects.txt](evidence/guide-effects.txt).
- **agent-error** — Push rerun ignored documented 35-second presence grace. Evidence: [run-log.md](run-log.md).
- **agent-error** — Quarry authoring used JavaScript optional chaining. Evidence: [run-log.md](run-log.md).
- **agent-error** — Insights reload assertion ran before hydration. Evidence: [evidence/m8-acceptance.log](evidence/m8-acceptance.log).
- **ambiguous** — Long-running Node25 Metro graph error and memory exhaustion; Node24 restart and watcher exclusions. Evidence: [evidence/m8-metro-crash.txt](evidence/m8-metro-crash.txt).
- **agent-error** — Literal JSX whitespace and avoidable import cycles. Evidence: [evidence/web-restart.log](evidence/web-restart.log).
- **agent-error** — Replay HTTP client lacked retry for an idle pooled ECONNRESET. Evidence: [evidence/scale-attempt1/](evidence/scale-attempt1/).
- **agent-error** — Wide feed merge exceeded measured 500-versus-5 ratio; dense-reader path and canonical syntax refinements. Evidence: [evidence/feed-optimization-equivalence.json](evidence/feed-optimization-equivalence.json).
- **agent-error** — Named replay verifier confused reply category and text media kind. Evidence: [evidence/scale-attempt2/](evidence/scale-attempt2/).
- **agent-error** — Receipt obligations needed membership identity across leave/rejoin. Evidence: [evidence/receipt-membership-proof.json](evidence/receipt-membership-proof.json).
- **agent-error** — Pending social label needed terminal onWrite handling. Evidence: [src/PostCard.tsx](src/PostCard.tsx).
- **agent-error** — Online route could expose composer before local acquisition; explicit sync barrier. Evidence: [evidence/m8-regression-miss/](evidence/m8-regression-miss/).
- **agent-error** — Report preview raced receipt rewriting; final generation waits for completed choreography and reads archived first greens. Evidence: [run-log.md](run-log.md).
- **agent-error** — Unread indication counted ordinal gaps; incoming visible-message predicate replaces arithmetic. Evidence: [evidence/unread-proof.json](evidence/unread-proof.json).
- **agent-error** — Seed-idempotence test counted independently expiring non-fixture messages. Evidence: [evidence/m6-final-regression-miss/](evidence/m6-final-regression-miss/).

## Scope and remaining limits

- All requested milestones/features were implemented. The native iOS behavior is wired through the exact published Expo module and exports successfully, but no simulator lifecycle/media proof was run.
- The provider seam is a durable Quarry effect log; real APNs/FCM delivery was out of scope. Built-in presence retains a documented 35-second disconnect grace, so immediate post-close sends may still see the recipient as connected.
- Dense Following uses an indexed global-event filter. It passed equivalence and scale probes, but unusually sparse activity among a large follow list can still exhaust the published query meter; this is an application design limit, not a universal performance claim.
- Removed-member history is device-retained; a fresh device cannot reconstruct history after removal. This matches the retained-local-copy model.
- Video playback works, but the feed/composer poster uses a fixture still rather than an extracted video frame.
- Delivery watermarks represent active-client acquisition. The chat list uses a bounded incoming-visible-message predicate for its New indication. Digest unread counts use the separate authorized visible-message sweep and were independently verified.
- Tested posture is local development, not a hosted production deployment. Hidden grader scoring and harness-native token accounting remain external. The base run record validates; a composed efficiency scorecard is not fabricated from unavailable harness custody metadata.
- No prior Snapback/Exact/Clique/Coterie checkout or benchmark was inspected. No Snapback source was read or substituted.

## Hand-authored line counts

Physical lines after formatting, by retained authored/edited source, test, utility and app-config file. Generated API, generated Quarry config, copied fixture configs/UI/instrument, package lock, bundles and evidence outputs are excluded. Copied UI source: 3671 lines. Total retained authored/edited source: **4303 lines in 60 files**. These are ceremony counts, not token or complexity estimates.

| File | Lines |
|---|---:|
| [app.json](app.json) | 28 |
| [app/_layout.tsx](app/_layout.tsx) | 5 |
| [app/[...route].tsx](app/[...route].tsx) | 3 |
| [app/index.tsx](app/index.tsx) | 3 |
| [babel.config.js](babel.config.js) | 4 |
| [config/runtime.json](config/runtime.json) | 1 |
| [metro.config.js](metro.config.js) | 6 |
| [package.json](package.json) | 53 |
| [scripts/acceptance-m2.mjs](scripts/acceptance-m2.mjs) | 227 |
| [scripts/acceptance-m3.mjs](scripts/acceptance-m3.mjs) | 104 |
| [scripts/acceptance-m4.mjs](scripts/acceptance-m4.mjs) | 79 |
| [scripts/acceptance-m5.mjs](scripts/acceptance-m5.mjs) | 108 |
| [scripts/acceptance-m6.mjs](scripts/acceptance-m6.mjs) | 146 |
| [scripts/acceptance-m8.mjs](scripts/acceptance-m8.mjs) | 125 |
| [scripts/acceptance.mjs](scripts/acceptance.mjs) | 131 |
| [scripts/choreo.mjs](scripts/choreo.mjs) | 19 |
| [scripts/config.mjs](scripts/config.mjs) | 17 |
| [scripts/custom-client-demo.mjs](scripts/custom-client-demo.mjs) | 55 |
| [scripts/digest-proof.mjs](scripts/digest-proof.mjs) | 138 |
| [scripts/evidence-summary.mjs](scripts/evidence-summary.mjs) | 17 |
| [scripts/expiry-proof.mjs](scripts/expiry-proof.mjs) | 87 |
| [scripts/feed-optimization-proof.mjs](scripts/feed-optimization-proof.mjs) | 66 |
| [scripts/final-report.mjs](scripts/final-report.mjs) | 39 |
| [scripts/format-authored.cjs](scripts/format-authored.cjs) | 18 |
| [scripts/http-client.mjs](scripts/http-client.mjs) | 77 |
| [scripts/inspect.mjs](scripts/inspect.mjs) | 14 |
| [scripts/log.mjs](scripts/log.mjs) | 2 |
| [scripts/member-smoke.mjs](scripts/member-smoke.mjs) | 24 |
| [scripts/offline-dual-debug.mjs](scripts/offline-dual-debug.mjs) | 2 |
| [scripts/offline-web-debug.mjs](scripts/offline-web-debug.mjs) | 2 |
| [scripts/performance-gates.mjs](scripts/performance-gates.mjs) | 6 |
| [scripts/profile-smoke.mjs](scripts/profile-smoke.mjs) | 20 |
| [scripts/receipt-membership-proof.mjs](scripts/receipt-membership-proof.mjs) | 38 |
| [scripts/record-processes.mjs](scripts/record-processes.mjs) | 28 |
| [scripts/replay.mjs](scripts/replay.mjs) | 183 |
| [scripts/scale-device-proof.mjs](scripts/scale-device-proof.mjs) | 2 |
| [scripts/scale-probes.mjs](scripts/scale-probes.mjs) | 154 |
| [scripts/scale-run.mjs](scripts/scale-run.mjs) | 138 |
| [scripts/scale-verify.mjs](scripts/scale-verify.mjs) | 176 |
| [scripts/seed-idempotence.mjs](scripts/seed-idempotence.mjs) | 15 |
| [scripts/seed.mjs](scripts/seed.mjs) | 132 |
| [scripts/setup-identity.mjs](scripts/setup-identity.mjs) | 59 |
| [scripts/test-backend.mjs](scripts/test-backend.mjs) | 50 |
| [scripts/unread-proof.mjs](scripts/unread-proof.mjs) | 30 |
| [snapback/chat.q](snapback/chat.q) | 305 |
| [snapback/digest.q](snapback/digest.q) | 48 |
| [snapback/insights.q](snapback/insights.q) | 51 |
| [snapback/schema.q](snapback/schema.q) | 45 |
| [snapback/social.q](snapback/social.q) | 153 |
| [src/Button.tsx](src/Button.tsx) | 17 |
| [src/Chat.tsx](src/Chat.tsx) | 424 |
| [src/client.ts](src/client.ts) | 29 |
| [src/client.web.ts](src/client.web.ts) | 21 |
| [src/Clique.tsx](src/Clique.tsx) | 214 |
| [src/Insights.tsx](src/Insights.tsx) | 55 |
| [src/Media.tsx](src/Media.tsx) | 53 |
| [src/PostCard.tsx](src/PostCard.tsx) | 48 |
| [src/Search.tsx](src/Search.tsx) | 49 |
| [src/Social.tsx](src/Social.tsx) | 147 |
| [tsconfig.json](tsconfig.json) | 13 |

## Delivery

[README](README.md) contains launch, seed, acceptance and replay commands. [API.md](API.md) and [custom-client-demo.mjs](scripts/custom-client-demo.mjs) provide the external client path. [diary.md](diary.md) records milestone experience; [essay.md](essay.md) was written after M8 before the final tally. [run-record.json](run-record.json) validates against the frozen base schema. All owned servers are stopped using only their recorded PIDs; cleanup evidence is in run-log.md.

end=1789464306
