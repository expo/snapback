# Clique — final run report

Lane `astra-clique-snapback4-full-20260913`; model `gpt-6-astra`; effort `medium`. Exact public pins: `snapback4@0.4.10`, `snapback4-expo@0.4.10`, resolved host binary `snapback4-darwin-arm64@0.4.10`. Node 24.18.0, Expo 57.0.22, React 19.2.3. See [resolved dependency tree](evidence/resolved-pins.txt).

Overall start=1790830113; report end=1790839368; elapsed=9255s. No subagents, other lanes, prior implementations, or Snapback source checkout were used. Ports remained within 49360–49379.

The combined scale state verification passed. The public performance gate did **not** pass: search, Insights, and Trending exceeded their strict 50% linear-interpolation bounds. All full/10% and peer comparison 3× bounds passed. The 50-member browser probe delivered all messages but had a visible 4.16s p95 delay. These failures are retained rather than resampled away.

## Milestones and clocks

All seven requested milestones have a passing coverage-validated suite and frozen choreography receipt. M7 is `not-run` by instruction. Nothing is struck from scope. No instrument skips were needed.

| Milestone | Start epoch | Initial artifact-complete end | Initial wall s | First suite+choreography green epoch | Latest retained green epoch | Status |
|---|---:|---:|---:|---:|---:|---|
| M1 | 1790830113 | 1790830542 | 429 | 1790830541.890 | 1790838617.136 | green |
| M2 | 1790830542 | 1790831086 | 544 | 1790831078.139 | 1790839172.762 | green |
| M3 | 1790831086 | 1790831661 | 575 | 1790831651.131 | 1790838902.133 | green |
| M4 | 1790831661 | 1790832243 | 582 | 1790832163.377 | 1790837670.147 | green |
| M5 | 1790832243 | 1790832849 | 606 | 1790832823.100 | 1790838564.725 | green |
| M6 | 1790832849 | 1790833263 | 414 | 1790833148.045 | 1790838580.386 | green |
| M8 | 1790833263 | 1790834037 | 774 | 1790833831.691 | 1790838950.214 | green |
| M7 | — | — | — | — | — | not-run |

M8 was reopened for regressions after its initial green. Its final validation boundary is 1790839172.762, giving 5909.762s from M8 start. This interval includes earlier-feature hardening and overlaps the separately clocked replay; it must not be added to replay wall as sequential time. All milestone safety limits remained below four hours. First-green timestamps are retained historical observations, not claims that no later regression occurred.

## Suite and choreography evidence

| Milestone | Suite receipt | Choreography receipt | Browser checks |
|---|---|---|---|
| M1 | [suite-m1-1790838601204.json](evidence/suite-m1-1790838601204.json) | [choreo-m1-1790838601336.jsonl](evidence/choreo-m1-1790838601336.jsonl) | 3/3; 0 skipped |
| M2 | [suite-m2-1790838635390.json](evidence/suite-m2-1790838635390.json) | [choreo-m2-1790838986530.jsonl](evidence/choreo-m2-1790838986530.jsonl) | 9/9; 0 skipped |
| M3 | [suite-m3-1790838789126.json](evidence/suite-m3-1790838789126.json) | [choreo-m3-1790838789226.jsonl](evidence/choreo-m3-1790838789226.jsonl) | 7/7; 0 skipped |
| M4 | [suite-m4-1790836844369.json](evidence/suite-m4-1790836844369.json) | [choreo-m4-1790837619028.jsonl](evidence/choreo-m4-1790837619028.jsonl) | 5/5; 0 skipped |
| M5 | [suite-m5-1790838208482.json](evidence/suite-m5-1790838208482.json) | [choreo-m5-1790838208681.jsonl](evidence/choreo-m5-1790838208681.jsonl) | 4/4; 0 skipped |
| M6 | [suite-m6-1790838570788.json](evidence/suite-m6-1790838570788.json) | [choreo-m6-1790838570868.jsonl](evidence/choreo-m6-1790838570868.jsonl) | 1/1; 0 skipped |
| M8 | [suite-m8-1790838916139.json](evidence/suite-m8-1790838916139.json) | [choreo-m8-1790838916506.jsonl](evidence/choreo-m8-1790838916506.jsonl) | 5/5; 0 skipped |

Coverage manifests: `evidence/coverage-m{1,2,3,4,5,6,8}.json`. Commands: `npm run acceptance -- --milestone mN`; `npm run seed -- --segment mN` for supplied starter segments M1–M3; `node scripts/choreo.mjs mN` supplies CHOREO_BASE_URL. Frozen executable harness and UI bytes match their instrument copies: [integrity](evidence/instrument-integrity.json).

Additional proofs: [server-only expiry](evidence/m5-expiry-server.json), [real scheduled digest across restart and inactive next period](evidence/digest-proof.json), [full browser restart offline with media/search/ordered durable queue](evidence/durable-cold-proof.json), [sample50 replay conformance](evidence/sample-50-conformance.json), [custom token-only client](evidence/m6-custom-client.json).

## Native artifacts

Every milestone exported an iOS Hermes bundle. These are build artifacts, not simulator proofs; simulator proofs were not required. Full hashes and sizes: [native artifact manifest](evidence/native-artifacts.json).

- M1: [artifacts/m1/ios/_expo/static/js/ios/entry-c83235d23aaa15657085c98c6674f7a1.hbc](artifacts/m1/ios/_expo/static/js/ios/entry-c83235d23aaa15657085c98c6674f7a1.hbc) — 3435463 bytes; SHA256 `411f28b1bca0333ae5d3fd8cc73ffc60e362ae1cb8a3c1f5eab84e59d850df40`.
- M2: [artifacts/m2/ios/_expo/static/js/ios/entry-8a06fd466fcc76073510a44cceae4cbf.hbc](artifacts/m2/ios/_expo/static/js/ios/entry-8a06fd466fcc76073510a44cceae4cbf.hbc) — 3460406 bytes; SHA256 `b7dc5547dc57bc6826968479d0ebfb537a5034d80e5f133a4317de3c0e7b32ad`.
- M3: [artifacts/m3/ios/_expo/static/js/ios/entry-785f4826bc595533e140d50e72b5ee0b.hbc](artifacts/m3/ios/_expo/static/js/ios/entry-785f4826bc595533e140d50e72b5ee0b.hbc) — 3481153 bytes; SHA256 `df59205b7c0b5daa192a7c4eab5d6bc77cf8de3c9e4993056053e26e133f5c2c`.
- M4: [artifacts/m4/ios/_expo/static/js/ios/entry-05edc6cf15ca8197142f27faf7208ec1.hbc](artifacts/m4/ios/_expo/static/js/ios/entry-05edc6cf15ca8197142f27faf7208ec1.hbc) — 3489173 bytes; SHA256 `7fb756f20228694270494a512bd3d4fcb209b3a1894b4420f4047fef575fc6cd`.
- M5: [artifacts/m5/ios/_expo/static/js/ios/entry-a41527b3e9ffb324621a27d1172aafb1.hbc](artifacts/m5/ios/_expo/static/js/ios/entry-a41527b3e9ffb324621a27d1172aafb1.hbc) — 3500040 bytes; SHA256 `86156a5cca019f34121592b2fbd7bbce43a5ac2186dafd1f7809bc1fb12c43ea`.
- M6: [artifacts/m6/ios/_expo/static/js/ios/entry-c365b7658edfa62a0fb7c6575e2a867e.hbc](artifacts/m6/ios/_expo/static/js/ios/entry-c365b7658edfa62a0fb7c6575e2a867e.hbc) — 3501718 bytes; SHA256 `789808d114ef83b6afca36a836d8d5004d17a6a2b73bfa728d552f15a7d0e24e`.
- M8: [artifacts/m8/ios/_expo/static/js/ios/entry-86346f9b6f77772f3c6811f136513ef0.hbc](artifacts/m8/ios/_expo/static/js/ios/entry-86346f9b6f77772f3c6811f136513ef0.hbc) — 3512336 bytes; SHA256 `cc7a9e3466f136edef06db5e4577f0e94de91abe49cb89ba9025b91aef7c51ea`.

## Scale replay

Final fresh-instance replay start=1790835219; end=1790837912; wall=2693s. Settled 167243 actions, including 86 starter actions. Exact combined invariant verification passed at 10%, 50%, and final state. See [result](evidence/scale-result.json), [10%](evidence/scale-verify-10pct.json), [50%](evidence/scale-verify-50pct.json), [final](evidence/scale-verify-final.json).

Earlier fresh attempts: 1790834106→1790834334 (228s) and1790834484→1790834796 (312s), both stopped at 10% API verification. The second retained exact retryable `E_OFFLINE`/`ECONNRESET`. The final verifier retries only loading or explicitly retryable query refusals; actions still require settled server receipts. Original failures and stores remain preserved.

Cold acquisition: 7197.6ms for 100 conversations; Node peak 292388864 bytes, native peak 34880KiB. Celebrity write p95 ratio 1.384; following500/5 ratio 2.880; celebrity-follower/5 ratio 0.878; page50/page1 ratio 2.054. Busy 50-member remote render p95=4158.2ms: every send arrived, but this is visibly slow and is not claimed stall-free.

Published performance probes are reported separately from state correctness and are not a hidden-grader score. Full-corpus writes run on a database snapshot on 49364; the verified original state on49362 is unchanged.

- [scale-performance-summary](evidence/scale-performance-summary.json): retained; see exact measurements and pass/fail
- [scale-cold-sync](evidence/scale-cold-sync.json): retained; see exact measurements and pass/fail
- [scale-write-performance](evidence/scale-write-performance.json): retained; see exact measurements and pass/fail
- [scale-busy-ui](evidence/scale-busy-ui.json): retained; see exact measurements and pass/fail

## Corrections and limitations

There are 44 logged correction/error entries: environment=3, agent-error=27, ambiguous=14. These are log entries, not deduplicated root-cause counts. The full timestamped entries and evidence pointers are in [run-log](run-log.md) and [run-record](run-record.json). No confirmed Snapback4 defect is claimed.

- Important application corrections: route/hidden-composer handling; transient viewer ownership; receipt interval read/write phases; day-bucket arithmetic; quote scrolling; server-only ordinal assignment; batching reactions; avoiding idle searches and offline typing writes; preserving disabled actions on pending rows; complete profile replacement in the replay adapter.
- Intermittent reconnect history withdrawal occurred during development. Six consecutive independent navigation/convergence cycles and final choreography passed after removing unnecessary observations. Earlier failures remain preserved; this is a reliability risk to monitor under other device/load combinations.
- The public midpoint performance checks failed: search 10.400ms versus 10.055ms bound; Insights 2.366ms versus 1.912ms; Trending 10.934ms versus 3.497ms. Endpoint 3× ratios passed, but that does not waive the midpoint rule. Concurrent authoring may contribute noise; no causal exemption or passing O5 score is claimed.
- The query verifier observed retryable connection resets after synchronous SQL inspection. Their origin remains ambiguous; they are not silently counted as successful reads.
- Native runtime behavior was not exercised in a simulator. Web browser restart proofs supplement, but do not substitute for, the requested Hermes exports. The notification seam logs durable provider payloads; real APNs/FCM was outside scope.
- Video rendering uses the fixture-derived poster as a generic preview; arbitrary uploaded videos do not get a newly extracted thumbnail.
- The replay adapter now journals avatar upload handles per principal and action intent, preserving identical retry arguments. The long scale process had already loaded the earlier adapter revision; its frozen workload contains only one profile-set per actor, so the replacement fix does not change that workload. The current revision passes sample/replacement conformance separately.
- Early suite/setup aliases were mutable. Some historical receipt hashes no longer match; the index flags them. Final cited proofs use matching retained suite bytes and immutable input snapshots. A fully driver-stamped composed instrument record and native token-phase evidence are unavailable within this authorized lane. `run-record.json` is the validated base record only; tokens and unmeasured phases are null, with no fabricated efficiency score.
- No unsupported product feature was established as a confirmed platform gap. The final evidence covers the requested implementation, with the verification and reliability limits above.

## Hand-authored physical lines

Physical lines in hand-authored application, backend, scripts, and prose files. Generated API/configs, vendor kit/harness, lockfile, scaffold manifests, builds and binary assets excluded. Compact source is not normalized.

| File | Lines |
|---|---:|
| `API.md` | 58 |
| `README.md` | 32 |
| `app/_layout.tsx` | 12 |
| `app/chat/[id]/index.tsx` | 1 |
| `app/chat/[id]/settings.tsx` | 1 |
| `app/conversation/[handle].tsx` | 1 |
| `app/conversation/group/[group]/index.tsx` | 1 |
| `app/conversation/group/[group]/settings.tsx` | 1 |
| `app/index.tsx` | 1 |
| `app/insights.tsx` | 1 |
| `app/new-chat.tsx` | 1 |
| `app/post/[id].tsx` | 1 |
| `app/profile/[handle].tsx` | 1 |
| `app/profile/edit.tsx` | 1 |
| `app/search.tsx` | 1 |
| `app/settings.tsx` | 1 |
| `diary.md` | 33 |
| `essay.md` | 27 |
| `run-log.md` | 118 |
| `scripts/accept-m2.mjs` | 14 |
| `scripts/accept-m3.mjs` | 8 |
| `scripts/accept-m4.mjs` | 7 |
| `scripts/accept-m5.mjs` | 9 |
| `scripts/accept-m6.mjs` | 7 |
| `scripts/accept-m8.mjs` | 6 |
| `scripts/acceptance.mjs` | 24 |
| `scripts/check-performance-origin.mjs` | 1 |
| `scripts/check-receipt-api.mjs` | 1 |
| `scripts/choreo.mjs` | 6 |
| `scripts/cleanup.mjs` | 4 |
| `scripts/configure.mjs` | 9 |
| `scripts/custom-client-demo.mjs` | 3 |
| `scripts/debug-convergence-cycles.mjs` | 40 |
| `scripts/debug-convergence.mjs` | 36 |
| `scripts/debug-delete.mjs` | 4 |
| `scripts/debug-route.mjs` | 3 |
| `scripts/debug-scale-api.mjs` | 1 |
| `scripts/debug-video.mjs` | 2 |
| `scripts/digest-proof.mjs` | 5 |
| `scripts/durable-cold-proof.mjs` | 5 |
| `scripts/finalize-report.py` | 42 |
| `scripts/fixture-server.mjs` | 2 |
| `scripts/offline-check.mjs` | 2 |
| `scripts/performance-server.mjs` | 3 |
| `scripts/prepare-choreo.mjs` | 3 |
| `scripts/progress.mjs` | 2 |
| `scripts/replay-adapter.mjs` | 26 |
| `scripts/report-evidence.py` | 35 |
| `scripts/scale-busy-ui.mjs` | 4 |
| `scripts/scale-cold-sync.mjs` | 2 |
| `scripts/scale-performance-summary.mjs` | 8 |
| `scripts/scale-replay.mjs` | 2 |
| `scripts/scale-spots.mjs` | 7 |
| `scripts/scale-verify.mjs` | 14 |
| `scripts/scale-write-probe.mjs` | 2 |
| `scripts/seed.mjs` | 22 |
| `scripts/serve-web.mjs` | 3 |
| `scripts/verify-expiry.mjs` | 2 |
| `snapback/schema.q` | 473 |
| `snapback/workers/push.mjs` | 3 |
| `src/NativeVideo.tsx` | 2 |
| `src/chat.tsx` | 17 |
| `src/client.ts` | 10 |
| `src/feed.tsx` | 10 |
| `src/insights.tsx` | 3 |
| `src/media.tsx` | 5 |
| `src/screens.tsx` | 24 |
| `src/search.tsx` | 34 |

Hand-authored source/test total excluding prose: 982 physical lines in 63 files. Counts are not formatting-normalized. The frozen UI, generated API/configuration, dependencies, lockfile, and artifacts are excluded.

Mixed or retained scaffold/configuration files have separate whole-file counts in [scaffold file lines](evidence/scaffold-file-lines.json); these are excluded from the hand-authored total.

Qualitative comparison was written before the tally: [essay](essay.md). Milestone reflections: [diary](diary.md). Process cleanup evidence: [cleanup](evidence/process-cleanup.json).

end=1790839368
