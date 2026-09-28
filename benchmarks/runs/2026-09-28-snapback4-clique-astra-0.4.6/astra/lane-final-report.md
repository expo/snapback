# Clique final report

Lane astra-clique-snapback4-full-20260913; model gpt-6-astra; effort medium.

All requested continuous-session milestones are green. M7 was not attempted, as required. A supplemental full-corpus probe later exposed an early-send acquisition race; the final local-device client waits for initial acquisition before opening the workspace, then remains usable offline. Original first-green times remain unchanged, with the post-green correction and regressions recorded separately. Scale invariants passed. The strict Insights mid-curve performance rule missed; supplemental web attempts and their final outcome are reported below, including earlier send/render and acquisition failures. Green means the passing coverage-mapped suite and frozen choreography receipt; native proof here is an exported iOS Hermes bundle, not a simulator run.

start=1790550910

Milestone first-green clocks end at M8 1790561347.396; final functional choreography ends at 1790565777.735. Report/cleanup end=1790566285.574. Raw lane wall through report/cleanup is 15375.574 seconds. Post-M8 wall outside the separate replay is 2542.078 seconds, including additional code corrections, regression tests, supplemental probes, essay, reporting, and cleanup; its finer phase split is unmeasured. The gap between milestones and post-build reporting remains in the overall raw chronology; replay has its own clock below.

## Milestones

| Milestone | Status | Start epoch | End / first-green epoch | Wall seconds | Suite tests | Choreography passed / implemented | Native artifact |
|---|---|---:|---:|---:|---:|---:|---|
| M1 | green | 1790550910 | 1790551455.21 | 545.210 | 6 | 3/3 | artifacts/m1-ios |
| M2 | green | 1790551458 | 1790552420.584 | 962.584 | 10 | 9/9 | artifacts/m2-ios |
| M3 | green | 1790552513 | 1790554212.285 | 1699.285 | 5 | 7/7 | artifacts/m3-ios |
| M4 | green | 1790554225 | 1790557838.913 | 3613.913 | 5 | 5/5 | artifacts/m4-ios |
| M5 | green | 1790557893 | 1790558941.263 | 1048.263 | 5 | 4/4 | artifacts/m5-ios |
| M6 | green | 1790558962 | 1790560228.332 | 1266.332 | 4 | 1/1 | artifacts/m6-ios |
| M8 | green | 1790560305 | 1790561347.396 | 1042.396 | 4 | 5/5 | artifacts/m8-ios |
| M7 | not-run | — | — | — | — | — | Separate fresh session |

Post-green functional regressions are retained in [final-regressions](evidence/final-regressions.json); the refreshed M8 Hermes artifact is current, with its original preserved at artifacts/m8-ios-first-green. Exact ISO first-green times, suite timestamps, hashes, and receipt paths: [final-boundaries](evidence/final-boundaries.json). No milestone exhausted its four-hour cap. No required implemented choreography assertion was relabeled or skipped. Supplemental simulator evidence is not required by this environment.

## Scale replay and probes

Replay start=1790561513.006; replay last action=1790563875.931; verification end=1790563909.106; wall=2396.0999999046326s; excluded checkpoint/final verification and probe wall=72.89399981498718s; execution=2323.2060000896454s. Settled actions=167243; invariant verification=PASS. Fresh instance: scale-instance. Exact result: [scale-result](evidence/scale-result.json).

The adapter uses real authenticated writes and uploads, settles each action, never backdates timestamps, and suppresses replay effects/schedules through the published CLI flag. The verifier reads actual authorized state: every profile, post, message, membership roster, quote, follow edge, like, repost and reaction; it compares checkpoint/final entity counts and named fixtures, and hashes fetched bytes for named ordinary media. View-once media is not consumed merely to verify the manifest.

Read-path degradation results: [scale-degradation](evidence/scale-degradation.json). Rules are reported exactly, including failures; they do not alter authoring milestone status. Absolute ceilings remain uncalibrated in this instrument, so no numeric O5 band or cross-backend speed ranking is claimed.

The isolated full-corpus celebrity write probe passed the ≤3× rule: ratio 1.190. It compares 900 versus exactly five followers, k=20 after three warmups. [Receipt](evidence/scale-celebrity-write.json).

The isolated production-web 50-member receipt probe using the named 100-conversation user u0500 failed; fresh browser to acquired=9812.719625ms (includes login/navigation), send/render p95=unavailable, all-peer read convergence p95=unavailable. The probe failed during warmup because the next message did not settle within its 30-second window; zero of the intended 20 measured samples completed. [Receipt](evidence/scale-receipt-render.json). These probe writes leave the verified original fixture untouched.

**Performance qualification:** insights failed the strict mid-curve rule: observed 1.8170409998856485 ms, limit 1.809166777756117 ms. The strict read-performance gate therefore did not fully pass. No rerun was used to replace this result. Supplemental web receipt attempts and fixes are retained separately, including the central-account acquisition timeout.

Cold synchronization completed with acquired=true at all checkpoints: 10pct 2251.205 ms, 50pct 3829.388 ms, full 3917.596 ms. The full native replica sampled RSS is retained separately in evidence/scale-full-sync-memory.json; runner memory includes its verification model and is not mislabeled as replica memory. The unfiltered original-store census also passed: evidence/scale-global-counts.json.

## Corrections and evidence limits

- agent-error: 27 grouped correction loops.
- environment: 2 grouped correction loops.
- ambiguous: 4 grouped correction loops.
- snapback-defect: 0 grouped correction loops.

[Correction-loop ledger](evidence/correction-loops.json) links each issue to the timestamped append-only log. Multiple iterations of one underlying issue are grouped. First-pass compile errors, package setup errors, and mistyped diagnostic filenames remain logged without inflating this loop total. No platform defect is established; “ambiguous” remains unresolved attribution.

## Resolved pins and artifacts

- snapback4: 0.4.6
- snapback4-expo: 0.4.6
- snapback4-darwin-arm64: 0.4.6
- expo: 57.0.22
- react: 19.2.3
- react-native: 0.86.3

Both Snapback packages were installed from the public npm registry at exact 0.4.6 pins. The package lock retains complete resolution and integrity. Original setup hashes identify installed package metadata; evidence/package-provenance.json separately verifies registry tarball integrity and records archive hashes. Backend authoring is Quarry; generated types and bundles are excluded from hand-authored counts. [API](API.md), [README](README.md), [diary](diary.md), and [pre-tally essay](essay.md) describe operation and tradeoffs.

## Candid gaps and qualifications

- An earlier named 100-conversation web receipt attempt failed before measured samples with a 38595.963375 ms send/render warmup. It is retained at evidence/scale-receipt-before-workspace-ready.json; the final attempt is reported above. The strict Insights mid-curve performance rule missed by approximately 0.008 ms; it remains a failed observation, not a passing scale gate. The supplementary 1000-conversation central-account web acquisition also exceeded its 90-second readiness limit; this remains a recorded performance gap on that revision (evidence/scale-central-1000-acquisition.json), distinct from the named 100-conversation probe; no final-revision 1000-conversation success is claimed. No unmet milestone expressibility requirement was established. This is a local production-shaped build, not a hosted deployment.
- APNS/FCM delivery is a logged provider seam as specified; no real external notification was sent.
- Native artifacts compile to Hermes for each milestone; simulator proofs were not required and were not claimed.
- Native token accounting, exact phase splits, driver orientation bytes/first-edit receipt, and complete compaction timestamps were not retained. Token fields are null, token caps are not adjudicated, and the run is ineligible for efficiency claims.
- The base protocol record validates. Its diagnostic social-messenger extension is explicitly not a complete composed efficiency/grading record; no independent grader session or holdout score is fabricated.
- Ordinary choreography uses its documented 30-second observation setting. Hard typing limits remained two/five seconds. Earlier timing misses are retained.
- Full public interaction-key summaries are synced to establish negative knowledge offline; that trades replica size for complete local post state. Offline search explicitly states its retained horizon.
- The main development backend clock was advanced by window tests; isolated expiry and digest proofs use controlled instances/real closed-client waiting. Config remains the fixture-shortened configuration, with a documented production switch.
- M7 remains untouched. Last ordinal and unread aggregates already exist; they are disclosed for the later fresh-session migration exercise.

## Hand-authored physical lines

Physical lines of authored/modified source, test, operational scripts and configuration. Copied frozen UI/instrument/metering, dependencies, generated API/builds, untouched CLI intents/Metro/Babel/entry scaffolds, fixture/config copies, and documentation excluded. Dense lines make this only a ceremony proxy.

| File | Lines |
|---|---:|
| app.json | 28 |
| app/[...path].tsx | 1 |
| app/_layout.tsx | 6 |
| app/index.tsx | 1 |
| choreo-adapter.json | 6 |
| package.json | 45 |
| scripts/acceptance.mjs | 30 |
| scripts/boundary.mjs | 2 |
| scripts/browser-retention-exact.mjs | 2 |
| scripts/browser-retention-probe.mjs | 2 |
| scripts/choreo.mjs | 5 |
| scripts/cleanup.mjs | 6 |
| scripts/clone-scale-for-receipts.mjs | 2 |
| scripts/configure.mjs | 2 |
| scripts/custom-client-demo.mjs | 11 |
| scripts/delete-probe.mjs | 2 |
| scripts/expiry-probe.mjs | 3 |
| scripts/finalize-report.mjs | 34 |
| scripts/implement-m5.py | 18 |
| scripts/implement-m6.py | 38 |
| scripts/inspect-social.mjs | 2 |
| scripts/inspect.mjs | 2 |
| scripts/m2-suite.mjs | 27 |
| scripts/m3-suite.mjs | 15 |
| scripts/m4-suite.mjs | 10 |
| scripts/m5-suite.mjs | 10 |
| scripts/m6-suite.mjs | 8 |
| scripts/m8-suite.mjs | 13 |
| scripts/offline-post-probe.mjs | 2 |
| scripts/once-revocation-probe.mjs | 3 |
| scripts/package-provenance.mjs | 2 |
| scripts/poster.mjs | 4 |
| scripts/proof-instance.mjs | 7 |
| scripts/push-worker.mjs | 5 |
| scripts/quote-diagnostic.mjs | 4 |
| scripts/quote-probe-30.mjs | 4 |
| scripts/quote-probe.mjs | 4 |
| scripts/receipt-state.mjs | 1 |
| scripts/replay.mjs | 54 |
| scripts/retention-probe.mjs | 7 |
| scripts/scale-global-counts.mjs | 2 |
| scripts/scale-probes.mjs | 7 |
| scripts/scale-receipt-probe.mjs | 10 |
| scripts/scale-run.mjs | 5 |
| scripts/scale-summary.mjs | 5 |
| scripts/scale-write-probes.mjs | 28 |
| scripts/seed.mjs | 32 |
| scripts/serve-web.mjs | 3 |
| scripts/setup.mjs | 6 |
| scripts/start.mjs | 7 |
| scripts/typing-probe.mjs | 4 |
| scripts/validate-coverage.mjs | 3 |
| scripts/verify.mjs | 8 |
| scripts/watch-scale-sync.mjs | 6 |
| snapback/schema.q | 519 |
| src/Chat.tsx | 60 |
| src/Clique.tsx | 39 |
| src/Insights.tsx | 5 |
| src/OnceViewer.tsx | 14 |
| src/Search.tsx | 11 |
| src/Social.tsx | 36 |
| src/VideoPlayer.tsx | 4 |
| src/client.ts | 11 |
| src/credentialStorage.native.ts | 3 |
| src/credentialStorage.ts | 1 |
| src/intent-store.native.ts | 8 |
| src/intent-store.ts | 2 |
| src/intent-store.web.ts | 7 |
| src/navigation.tsx | 5 |
| src/receipts.ts | 82 |
| tsconfig.json | 13 |

Total 1374 lines across 71 files.

Cleanup records only explicitly owned PIDs in run-log.md and evidence/cleanup.json.

end=1790566285.574
