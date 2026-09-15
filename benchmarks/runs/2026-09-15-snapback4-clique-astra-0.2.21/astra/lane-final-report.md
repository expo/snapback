# Clique — final report

Lane: astra-clique-snapback4-full-20260913. Model: gpt-6-astra, effort=medium.

**M1, M2, M3, M4, M5, M6, and M8 are green under the instrument suite/choreography bar. M7 was not run, as instructed.** The final Quarry snapshot completed the full fixture replay, all checkpoint/final manifest checks, cold sync, and the builder's measured performance checks. Known gaps are below; no hidden-grader or simulator score is claimed.

## Raw clocks and milestone evidence

Run start=1789480667; report end=1789485793; elapsed=5126 seconds. These endpoints include orientation, verification, reporting, and separately recorded replay work. Parallel clock intervals must not be summed as authoring time. Phase and token charges are unavailable rather than estimated.

| Milestone | Status | Start epoch | Canonical green end epoch | Window seconds | First green epoch | First-green seconds | Suite | Choreography |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| M1 | green | 1789480667 | 1789481225.264 | 558.264 | 1789481140.381 | 473.381 | 7/7 | 3/3 |
| M2 | green | 1789481212 | 1789481550.897 | 338.897 | 1789481550.897 | 338.897 | 22/22 | 9/9 |
| M3 | green | 1789481656 | 1789481998.557 | 342.557 | 1789481998.557 | 342.557 | 7/7 | 7/7 |
| M4 | green | 1789482057 | 1789482183.431 | 126.431 | 1789482183.431 | 126.431 | 5/5 | 5/5 |
| M5 | green | 1789482243 | 1789483056.718 | 813.718 | 1789483056.718 | 813.718 | 6/6 | 4/4 |
| M6 | green | 1789483097 | 1789483485.99 | 388.99 | 1789483485.99 | 388.99 | 5/5 | 1/1 |
| M8 | green | 1789483590 | 1789484808.169 | 1218.169 | 1789484031.383 | 441.383 | 6/6 | 5/5 |
| M7 | not-run | — | — | — | — | — | — | — |

M1 orientation began at the run start; the explicit M1 start log is 1789480770. Its first observed green was 2026-09-15T14:05:40.381Z in the conversation tool receipt. The retained canonical rerun is later. M2 began after that earlier green, before the later M1 bookkeeping line. The table reports raw canonical windows, including that 13-second bookkeeping overlap. M8 first went green before the later identity-ledger audit; the final canonical green is shown separately. Post-green member-picker regression, final exports, scale probes, essay, and reporting continued afterward. Every milestone remained below the 14,400-second safety limit. No cap failure or abort occurred.

Canonical aggregate evidence: [M1](evidence/m1-summary.json), [M2](evidence/m2-summary.json), [M3](evidence/m3-summary.json), [M4](evidence/m4-summary.json), [M5](evidence/m5-summary.json), [M6](evidence/m6-summary.json), [M8](evidence/m8-summary.json). All seven aggregates have passing suites, valid retained suite-receipt hashes, and nonGreenCause=null. M3 includes 5 required and 2 additional checks; M5 includes 2 required and 2 additional checks. Every implemented check passed. No required browser check was skipped or relabeled. M6/M8 supplemental native records say `not-recorded`, requiredForGreen=false, exactly as the frozen harness specifies; these are not invented instrument skips.

Coverage: [coverage-manifest.json](coverage-manifest.json). Executable entry point: `npm run acceptance -- --milestone mN`. Starter segments m1/m2/m3 use `npm run seed -- --segment mN`; there are no starter files for later milestones. M1–M6 integrated regressions passed. The final member-picker change passed M3 choreography, and final typecheck/web/iOS exports passed.

## Scale replay and performance

Each run used its own fresh backend, all three starter logs, exact hash-pinned scale.log, sequential authoritative settlements, and published --replay mode. No fixture action class was skipped. The final store is retained stopped at `scale-final-instance`; its Quarry files are byte-identical to the delivered backend.

| Replay snapshot | Start epoch | End epoch | Wall s | Verification/probe s | Replay-only s | Settlements | Verification |
|---|---:|---:|---:|---:|---:|---:|---|
| [scale](evidence/scale-result.json) | 1789483571 | 1789483770 | 199 | 7.953 | 191.047 | 167243 | pass |
| [scale-m8](evidence/scale-m8-result.json) | 1789484197 | 1789484436 | 239 | 7.876 | 231.124 | 167243 | pass |
| [scale-integrated](evidence/scale-integrated-result.json) | 1789484525 | 1789484768 | 243 | 7.958 | 235.042 | 167243 | pass |
| [scale-final](evidence/scale-final-result.json) | 1789484826 | 1789485118 | 292 | 8.844 | 283.156 | 167243 | pass |

Each total is 86 starter +167,157 scale actions. The combined expected state includes 1,008 users, 5,921 follows, 50,228 posts including 2,004 replies, 1,002 conversations, and 100,015 messages. Verification fully paged every chat, checked all per-user follow/conversation counts and group sizes, and checked named profiles, posts/media, reactions, quotes, and every named O5 fixture at 10%, 50%, and final. Corpus-wide expected counts are backed by per-action receipts; the independent actual-state checks are listed in each checkpoint JSON. Hidden deterministic grader samples were not available.

The first replay exposed a 4.31x Following ratio. The delivered strategy passed the final measured checks below. All read probes use 3 warmups and 20 measured sequential requests; the write probe used an isolated copy of the stopped final store, leaving the original manifest state unchanged.

| Diagnostic check | Measured value | Limit | Result |
|---|---:|---:|---|
| Following 500 / following 5 | 1.257 | 3 | pass |
| Celebrity follower / following 5 | 1.028 | 3 | pass |
| History page 50 / page 1 | 0.967 | 3 | pass |
| search final / 10% | 1.108 | 3 | pass |
| search 50% p95 under linear 10%-100% interpolation | 2.573 | 2.813 | pass |
| insights final / 10% | 2.224 | 3 | pass |
| insights 50% p95 under linear 10%-100% interpolation | 0.214 | 0.292 | pass |
| trending final / 10% | 1.214 | 3 | pass |
| trending 50% p95 under linear 10%-100% interpolation | 0.418 | 0.431 | pass |
| Celebrity writes / five-follower writes | 0.909 | 3 | pass |

Cold process-replica sync: 639.988 ms; 100 conversations; search returned a complete page. Node-process RSS after sync: 203456512 bytes. This is not a full process-tree peak-memory measurement. See [performance-summary.json](evidence/performance-summary.json), [scale-cold-sync.json](evidence/scale-cold-sync.json), and [scale-write-probe.json](evidence/scale-write-probe.json). These are builder diagnostics, not a rotated O5 score.

## Native and web artifacts

- [artifacts/m1-ios/_expo/static/js/ios/entry-5b34e9ee68c1c6da091f1243165c8e14.hbc](artifacts/m1-ios/_expo/static/js/ios/entry-5b34e9ee68c1c6da091f1243165c8e14.hbc) — 2668504 bytes; SHA-256 23d67a4d4df3aa0697c4e12ca9678c866a2147975a15acc84cef2ed24bd4fb95.
- [artifacts/m2-ios/_expo/static/js/ios/entry-439cc7bc4120aeb771c360af962aa0f5.hbc](artifacts/m2-ios/_expo/static/js/ios/entry-439cc7bc4120aeb771c360af962aa0f5.hbc) — 2692585 bytes; SHA-256 0c305561a8a94e4e92b5a312698c4fbc8445723fce19e6515ce432d8034b6367.
- [artifacts/m3-ios/_expo/static/js/ios/entry-2bd4e630566f7f2f37cedd746850d15f.hbc](artifacts/m3-ios/_expo/static/js/ios/entry-2bd4e630566f7f2f37cedd746850d15f.hbc) — 2712400 bytes; SHA-256 3f84eb70b51e2865a4e5b38ed68bef3dc613f5853d12bb81bfe7012b11baf10c.
- [artifacts/m4-ios/_expo/static/js/ios/entry-bf4107566c19d3edd699c0fefe4f31d2.hbc](artifacts/m4-ios/_expo/static/js/ios/entry-bf4107566c19d3edd699c0fefe4f31d2.hbc) — 2719154 bytes; SHA-256 fb393c2fe5eee6689af1acaa7ba8166d6365cb51ff6cda094e72a7f43e73393e.
- [artifacts/m5-ios/_expo/static/js/ios/entry-49c11da7e012e1de796277d0eb64faed.hbc](artifacts/m5-ios/_expo/static/js/ios/entry-49c11da7e012e1de796277d0eb64faed.hbc) — 2727755 bytes; SHA-256 f1851ef789cff4e2c3a7b67a918c1596b4bfaf1b0e9ed9570b469d1b0015bc57.
- [artifacts/m6-ios/_expo/static/js/ios/entry-fe43f0c8638d6d660272559b2cdb5779.hbc](artifacts/m6-ios/_expo/static/js/ios/entry-fe43f0c8638d6d660272559b2cdb5779.hbc) — 2727802 bytes; SHA-256 c6b1938da9e724e5b3855607b75c5ab4e6ac9da1a4f7321a1838a1363e1243da.
- [artifacts/m8-ios/_expo/static/js/ios/entry-865c74d7d947e6af766a88198fc94dcd.hbc](artifacts/m8-ios/_expo/static/js/ios/entry-865c74d7d947e6af766a88198fc94dcd.hbc) — 2732616 bytes; SHA-256 2fa832ec4e0088c7bbc7c644cf765cfa352c2888e2816da03d477802f003de61.

[Native artifact manifest](native-artifacts.json). [Web export](artifacts/web/index.html). [Scale web export](artifacts/scale-web/index.html) was served and verified against ten scale-user profile counts and the Insights screen, with no page errors; see [scale-web-proof.json](evidence/scale-web-proof.json). EXPO_PUBLIC_CLIQUE_BACKEND_URL selects the backend at build/start time. Every milestone produced iOS Hermes bytecode using the pinned native package. No simulator launch, physical-device run, or native cold-start UI proof is claimed. Additional process-replica proofs: [offline restart](evidence/offline-restart.json), [cache revocation](evidence/replica-revocation.json).

## Scheduled and trust-boundary proofs

[Digest proof](evidence/digest-proof.json): with all clients closed, exact period payloads, private-chat exclusion, inactive-user suppression, and no duplicate after restart or in an empty following period. [Trust checks](evidence/trust-check.json): cross-user refusal, view-once refusal, delete/expiry asset revocation, server edit/delete windows, and logout invalidation. [Intent proof](evidence/intent-proof.json): stale set retry does not undo a later clear, and repeated message IDs do not duplicate sends.

## Resolved package pins and environment

- node_modules/snapback4: **0.2.21**; sha512-7BW8pQO/yDg1tNtB/v+s+OgAIUsR6vfBKZITFoQjQAUH83g/H5lziSITcDI6FH9nQ8AUg2QCG/Og+Ofx1zb6EQ==
- node_modules/snapback4-darwin-arm64: **0.2.21**; sha512-9FfS1gYZjifhJU9dwJYCMEcfCjVQnGb+LG85SZ/O2o642hrfNV7vChVXEyCBPHh1s4/rO2doO9pFSPkbk46uag==
- node_modules/snapback4-expo: **0.2.12**; sha512-HjveK4d6A1TlBlB0W046hFzFYq1jpNiATQnZtv3xI1pbJ40a3Ft7MIVxLWzUdkUh+jV31jiadt2iZMaS7zdz/w==

Public npm packages only; no Snapback source checkout or sibling lane was inspected. Backend: Quarry plus the provider logging worker. Client: Expo Router, web replica, and installed native replica arm. Actual PATH runtime was Node v25.9.0 rather than the environment overlay's claimed 24.18.0; the actual value is recorded in setup identity. Expo 57.0.22, React 19.2.3, React Native 0.86.3, Playwright 1.62.1. Only ports 49360–49379 were used.

## Corrections and attribution

- environment: 2 logged correction/error entries
- agent-error: 19 logged correction/error entries
- ambiguous: 2 logged correction/error entries
- snapback4-defect: 1 logged correction/error entries

[correction-loops.json](correction-loops.json) preserves the exact timestamped entries and evidence pointers. These are explicit log-entry counts, not reconstructed semantic-action or recovery-episode scores. The Snapback-attributed item is a documented provider-policy gap, not a demonstrated runtime corruption defect.

- 1789480770 — **environment**: error/retry source=diagnostic attribution=environment evidence=choreography-install.log; copied read-only permissions required chmod on lane copy; evidence choreography-install.log.
- 1789481023 — **environment**: error/workaround source=fixture attribution=environment evidence=evidence/m1-choreo-startup.log; reconstructed lane-local harness import layout and supplied missing JSON-schema helper with pinned AJV; frozen choreography unchanged; evidence evidence/m1-choreo-startup.log.
- 1789481059 — **agent-error**: correction-loop attribution=agent-error evidence=evidence/web.log; moving harness directory under running Metro crashed watcher; exclude non-app trees and restart. Harness symlink invocation did not execute main; use canonical path.; evidence evidence/web.log.
- 1789481136 — **agent-error**: correction-loop attribution=agent-error source=diagnostic evidence=evidence/m1-debug-live.log; existing profile form copied avatar/id/principal into mutation args; E_INPUT saveProfile takes no argument avatar; restrict form values to five text fields.; evidence evidence/m1-debug-live.log.
- 1789481443 — **agent-error**: M2 error/retry attribution=agent-error source=diagnostic evidence=scripts/suites/m2.mjs; pagination assertion used post IDs rather than feed event IDs; original/repost legitimately share post ID.; evidence scripts/suites/m2.mjs.
- 1789481514 — **ambiguous**: correction-loop attribution=ambiguous source=fixture evidence=evidence/m2-choreo.log harness toggleFollow leaves profile then directly selects feed tabs; add persistent feed navigation tabs on secondary routes without changing harness; evidence evidence/m2-choreo.log.
- 1789481883 — **agent-error**: correction-loop attribution=agent-error source=diagnostic evidence=evidence/m3-debug.log DM route selected a group with same second member; require isGroup=false when resolving counterpart route; bubble action wrapper now owns contractual bubble ID; evidence evidence/m3-debug.log.
- 1789481961 — **agent-error**: correction-loop attribution=agent-error source=fixture evidence=evidence/m3-choreo.log Harness progress witness opens a new Alice-Dave DM; counterpart route now invokes real deduplicated creation path if absent; evidence evidence/m3-choreo.log.
- 1789482404 — **agent-error**: error-retry attribution=agent-error source=fixture evidence=evidence/m5-suite.log Search kit uppercases group labels; suite should compare case-insensitively. Choreography started with failed suite linkage and will need a full rerun.; evidence evidence/m5-suite.log.
- 1789483464 — **agent-error**: M6 correction source=diagnostic attribution=agent-error evidence=evidence/m6-suite.log; random mintId not necessarily valid handle; fixture setup now uses explicit handle alphabet and asserts profile receipt; evidence evidence/m6-suite.log.
- 1789483475 — **agent-error**: M6 correction source=diagnostic attribution=agent-error evidence=evidence/m6-suite-retry.log; exact failure was empty optional URL E_INPUT; corrected fixture link to null; evidence evidence/m6-suite-retry.log.
- 1789483504 — **agent-error**: M6 error attribution=agent-error source=diagnostic; attempted scale command with not-yet-created cwd; no command executed; directory now created; evidence run-log.md:49.
- 1789483756 — **agent-error**: M8 correction attribution=agent-error source=diagnostic evidence=evidence/m8-typecheck.txt; TrendingRow requires FeedCard props rather than children; shared PostCard now passes those props; evidence evidence/m8-typecheck.txt.
- 1789483794 — **agent-error**: M8 error attribution=agent-error source=diagnostic; test backend launch used relative path for intended child cwd from lane root, redirection refused before launch; corrected explicit cwd, no outside files written; evidence run-log.md:56.
- 1789483928 — **ambiguous**: M8 correction source=fixture attribution=ambiguous evidence=evidence/m8-choreo.log; harness expects DM rows on base URL; added web chat sidebar to feed dashboard. Receipt read stalled at 57 with delivered 58; use explicit sequence ordering and retry read acknowledgement while conversation visible.; evidence evidence/m8-choreo.log.
- 1789483974 — **agent-error**: M8 suite correction source=diagnostic attribution=agent-error evidence=evidence/m8-suite-retry.log; seeded Alice post tied with synthetic trending posts because test inserted seed midway; move seed before independent old-window clock setup; evidence evidence/m8-suite-retry.log.
- 1789484023 — **agent-error**: M8 correction source=diagnostic attribution=agent-error evidence=evidence/m8-debug-home.log; prior string edit added imports but did not match formatted Feed JSX, leaving sidebar absent; corrected checked replacement. Receipt retry passed second choreography.; evidence evidence/m8-debug-home.log.
- 1789484066 — **agent-error**: M8 correction attribution=agent-error source=diagnostic evidence=evidence/scale-final.json; M6 Following500/Following5 p95 ratio=4.31 exceeds 3x. Added dense-follow global-index scan path at 100 follows; sparse accounts retain lane merge. Exact filtering remains server-side and metered; revalidate on fresh full replay.; evidence evidence/scale-final.json.
- 1789484288 — **agent-error**: M8 correction attribution=agent-error source=model-knowledge evidence=snapback/schema.q; strengthened set-state retry identity with per-principal intent ledger, including stale retry after later clear; send now reuses stable message IDs authoritatively. Prior set-state operations were consecutive-repeat safe but did not retain argument-level retry IDs.; evidence snapback/schema.q.
- 1789484482 — **agent-error**: M8 isolated-suite correction attribution=agent-error source=model-knowledge; allocate a fresh test store per invocation so dev clock offsets from a prior run cannot leave future rows after restart; evidence run-log.md:76.
- 1789484594 — **agent-error**: M8 correction source=diagnostic attribution=agent-error evidence=evidence/why-send-final.txt,evidence/offline-restart-final.log; duplicate-message guard read absence through horizon, suppressing offline prediction. Moved identity check to own synced no-horizon sentMessages ledger; server transactions still enforce unique message IDs.; evidence evidence/why-send-final.txt,evidence/offline-restart-final.log.
- 1789484744 — **snapback4-defect**: M8 audit platform-gap attribution=snapback4-defect source=package-README/guide,diagnostic evidence=evidence/auth-unicode-policy.json,evidence/guide-auth-final.txt; built-in auth enforces 8 UTF-8 bytes, accepts two emoji (2 code points). Brief asks 8 characters. UI now enforces 8 code points; published built-in server auth exposes no stricter character-count policy. Instrument M1 success assertion remains satisfied, server-policy gap disclosed.; evidence evidence/auth-unicode-policy.json,evidence/guide-auth-final.txt.
- 1789485096 — **agent-error**: Final UI audit correction attribution=agent-error source=model-knowledge evidence=src/Chats.tsx; group member picker was limited to first 50 profiles. Added server prefix search and paging so scale users remain selectable; Quarry snapshot unchanged.; evidence src/Chats.tsx.
- 1789485118 — **agent-error**: Reporting correction attribution=agent-error source=model-knowledge evidence=scripts/choreo.mjs; added automatic timestamped JSONL archives before reruns. Original M3 successful aggregate remains in m3-summary.json but its first full JSONL was replaced by the member-search regression run; canonical rerun and first failed attempt remain.; evidence scripts/choreo.mjs.

## Hand-authored lines by file

Physical lines including blanks in authored or substantially edited application, Quarry, tests, tooling, and root configuration. Excludes copied frozen UI, dependencies, generated types/config, artifacts/evidence, source snapshots, and three derived copies of the scale driver. Includes the original hand-authored scale driver. Whole-file count for edited scaffold adapters. Total: **5229 lines in 72 files**. Frozen shared UI: 3694 lines, excluded from the authored total. Generated/source-snapshot copies are excluded. [Machine-readable breakdown](hand-authored-lines.json).

| File | Lines |
|---|---:|
| app.json | 29 |
| app/_layout.tsx | 9 |
| app/chats.tsx | 1 |
| app/conversation/[...route].tsx | 6 |
| app/index.tsx | 1 |
| app/insights.tsx | 1 |
| app/new-chat.tsx | 1 |
| app/post/[id].tsx | 6 |
| app/profile/[handle].tsx | 47 |
| app/profile/edit.tsx | 1 |
| app/search.tsx | 1 |
| app/settings.tsx | 14 |
| babel.config.js | 4 |
| metro.config.js | 9 |
| package.json | 48 |
| scripts/acceptance-m1.mjs | 126 |
| scripts/acceptance.mjs | 62 |
| scripts/boundary.mjs | 21 |
| scripts/build-report.mjs | 54 |
| scripts/choreo.mjs | 31 |
| scripts/configure-digest.mjs | 11 |
| scripts/configure.mjs | 10 |
| scripts/custom-client-demo.mjs | 71 |
| scripts/debug-chat.mjs | 17 |
| scripts/debug-home.mjs | 12 |
| scripts/debug-live.mjs | 33 |
| scripts/digest-proof.mjs | 216 |
| scripts/intent-proof.mjs | 54 |
| scripts/m8-seed-check.mjs | 94 |
| scripts/note.mjs | 5 |
| scripts/offline-restart.mjs | 108 |
| scripts/performance-summary.mjs | 2 |
| scripts/replay.mjs | 211 |
| scripts/replica-revocation.mjs | 85 |
| scripts/scale-cold-sync.mjs | 52 |
| scripts/scale-web-proof.mjs | 66 |
| scripts/scale.mjs | 239 |
| scripts/screenshots.mjs | 18 |
| scripts/seed.mjs | 146 |
| scripts/serve-export.mjs | 39 |
| scripts/suites/m2.mjs | 265 |
| scripts/suites/m3.mjs | 134 |
| scripts/suites/m4.mjs | 98 |
| scripts/suites/m5.mjs | 97 |
| scripts/suites/m6.mjs | 107 |
| scripts/suites/m8.mjs | 155 |
| scripts/test-backend.mjs | 63 |
| scripts/trust-check.mjs | 162 |
| scripts/update-m4-ui.py | 30 |
| scripts/validate-report.mjs | 12 |
| scripts/write-probe.mjs | 68 |
| snapback/chat.q | 196 |
| snapback/digest.q | 38 |
| snapback/ephemeral.q | 41 |
| snapback/insights.q | 50 |
| snapback/media.q | 61 |
| snapback/schema.q | 67 |
| snapback/social.q | 148 |
| snapback/worker.mts | 6 |
| src/Chats.tsx | 694 |
| src/Insights.tsx | 45 |
| src/Posts.tsx | 279 |
| src/Root.tsx | 232 |
| src/Search.tsx | 78 |
| src/client.ts | 19 |
| src/device.ts | 9 |
| src/device.web.ts | 4 |
| src/media.tsx | 25 |
| src/media.web.tsx | 33 |
| src/picker.ts | 20 |
| src/picker.web.ts | 14 |
| tsconfig.json | 18 |

## Candid gaps and evidence limitations

- Built-in auth enforces eight UTF-8 bytes, not eight Unicode characters. The app requires eight code points, but direct SDK signup can bypass that stricter UI policy. The published auth surface exposes no character-count override; [exact accepted-two-emoji diagnostic](evidence/auth-unicode-policy.json).
- The broad-follow scan is metered and reports N_SPARSE_FILTER. A broad follow set with mostly inactive authors can return an incomplete page. The committed dense-follow envelope passed; this is not an unlimited feed architecture. Other bounded queries and sync metadata also have finite costs.
- Native evidence is Hermes export plus process-replica diagnostics, not simulator UI proof. Native video playback is wired; native poster fallback is the app graphic rather than an extracted video frame.
- The frozen harness snapshot omitted its JSON-schema helper and assumed its original import layout. The lane copied its metering tree and supplied a standard AJV helper; browser assertions and aggregation were unchanged. Qualified binary/wrapper claims remain explicit nonclaims.
- Original first M1 and first successful M3 full JSONL were replaced during reruns; canonical aggregate evidence, current full receipts, and relevant failed-attempt evidence remain. Automatic archival now protects reruns. M1 first-green timing is supported by the conversation tool result, not the replaced JSONL.
- Harness-native token/phase accounting and the complete driver-stamped joined record are unavailable within this lane. [run-record.json](run-record.json) validates the base schema and clearly declares pending driver join. No efficiency, hidden-grader, overall rubric, or token-cap score is fabricated.
- Development posture is loopback Snapback dev, not a deployed production service. The push seam logs payloads; it is not an APNs integration.
- M7 was deliberately not attempted. Existing per-chat sequence markers are ordering/receipt state, not an M7 visible-message-count implementation.

## Delivery and cleanup

[README](README.md) gives install/start/seed/config instructions; [API.md](API.md) documents the custom-client protocol; [diary.md](diary.md) records each milestone; [essay.md](essay.md) was written before this tally. All started servers and workers were stopped by recorded PID only. [remaining-listeners.txt](evidence/remaining-listeners.txt) is empty for this lane's port range. No process-name kills were used.

end=1789485793
