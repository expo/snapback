# Clique final report

lane id astra-clique-snapback4-full-20260913
model gpt-6-astra
effort=medium
backend=snapback4-0.2.9
start=1789371827

M1 → M2 → M3 → M4 → M5 → M6 → M8 are green under the supplied environment's suite-plus-choreography bar. M7 was deliberately not run. No milestone reached the four-hour limit. This was a single-agent cold build in the assigned lane, using the public package surface; no source checkout, sibling lane, prior implementation, or prior benchmark was inspected.

## Milestone clocks and receipts

The end/first-green epoch is the first recorded milestone-green boundary, not a reconstructed earliest possible browser success. M1 includes bootstrap from the run start; its explicit milestone-start line was 1789371917. Post-green quote-navigation correction and final M8 revalidation are recorded separately in the run log.

| Milestone | Status | Start epoch | End / first green | Wall / time to first green (s) | Suite mapped assertions | Choreography |
|---|---|---:|---:|---:|---:|---:|
| M1 | green | 1789371827 | 1789372261 | 434 | 7 covered; pass | 3/3 pass |
| M2 | green | 1789372261 | 1789372724 | 463 | 22 covered; pass | 9/9 pass |
| M3 | green | 1789372724 | 1789373706 | 982 | 7 covered; pass | 7/7 pass |
| M4 | green | 1789373706 | 1789374176 | 470 | 5 covered; pass | 5/5 pass |
| M5 | green | 1789374176 | 1789375098 | 922 | 6 covered; pass | 4/4 pass |
| M6 | green | 1789375098 | 1789375749 | 651 | 5 covered; pass | 1/1 pass |
| M7 | not-run | — | — | — | — | — |
| M8 | green | 1789375749 | 1789376508 | 759 | 6 covered; pass | 5/5 pass |

Every covered milestone has an empty missing-coverage list. The final artifacts contain 58 mapped suite assertions and 34 passing choreography checks. No required choreography check was relabeled or skipped. The environment's native-artifact exception applies to simulator-tagged assertions; exports and supplemental web proofs are not presented as simulator proofs. Full clock, coverage, receipt, and native-hash metadata: [evidence/milestones.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/milestones.json).

M1: [evidence/m1-suite.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m1-suite.json) · [evidence/m1-coverage.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m1-coverage.json) · [evidence/m1-choreo.jsonl](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m1-choreo.jsonl).

M2: [evidence/m2-suite.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m2-suite.json) · [evidence/m2-coverage.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m2-coverage.json) · [evidence/m2-choreo.jsonl](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m2-choreo.jsonl).

M3: [evidence/m3-suite.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m3-suite.json) · [evidence/m3-coverage.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m3-coverage.json) · [evidence/m3-choreo.jsonl](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m3-choreo.jsonl).

M4: [evidence/m4-suite.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m4-suite.json) · [evidence/m4-coverage.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m4-coverage.json) · [evidence/m4-choreo.jsonl](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m4-choreo.jsonl).

M5: [evidence/m5-suite.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m5-suite.json) · [evidence/m5-coverage.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m5-coverage.json) · [evidence/m5-choreo.jsonl](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m5-choreo.jsonl).

M6: [evidence/m6-suite.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m6-suite.json) · [evidence/m6-coverage.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m6-coverage.json) · [evidence/m6-choreo.jsonl](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m6-choreo.jsonl).

M8: [evidence/m8-suite.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m8-suite.json) · [evidence/m8-coverage.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m8-coverage.json) · [evidence/m8-choreo.jsonl](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m8-choreo.jsonl).

Starter segments M1, M2, and M3 have idempotent <code>npm run seed -- --segment mN</code> entry points and settled receipts. Later milestones add no new starter segment. Run <code>npm run acceptance -- --milestone mN</code> and then <code>node scripts/choreo.mjs mN</code> serially; the latter supplies CHOREO_BASE_URL.

## Native artifacts and package provenance

| Milestone | iOS Hermes bundle | Bytes |
|---|---|---:|
| M1 | [artifacts/m1-ios/_expo/static/js/ios/entry-a91bee124b93035083c83b55fce964ab.hbc](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/artifacts/m1-ios/_expo/static/js/ios/entry-a91bee124b93035083c83b55fce964ab.hbc) | 2614514 |
| M2 | [artifacts/m2-ios/_expo/static/js/ios/entry-76d42ea1ccc2b9d95c88f41ea24d63c0.hbc](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/artifacts/m2-ios/_expo/static/js/ios/entry-76d42ea1ccc2b9d95c88f41ea24d63c0.hbc) | 2625210 |
| M3 | [artifacts/m3-ios/_expo/static/js/ios/entry-06eda42c94ef1759f32956d4ed88877e.hbc](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/artifacts/m3-ios/_expo/static/js/ios/entry-06eda42c94ef1759f32956d4ed88877e.hbc) | 2644482 |
| M4 | [artifacts/m4-ios/_expo/static/js/ios/entry-c47b0f43991abfbaeda5b0447387e01a.hbc](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/artifacts/m4-ios/_expo/static/js/ios/entry-c47b0f43991abfbaeda5b0447387e01a.hbc) | 2662177 |
| M5 | [artifacts/m5-ios/_expo/static/js/ios/entry-55305000be695842441f85db019cc97b.hbc](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/artifacts/m5-ios/_expo/static/js/ios/entry-55305000be695842441f85db019cc97b.hbc) | 2670827 |
| M6 | [artifacts/m6-ios/_expo/static/js/ios/entry-01911617eddba6f36f366c86c13639e7.hbc](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/artifacts/m6-ios/_expo/static/js/ios/entry-01911617eddba6f36f366c86c13639e7.hbc) | 2672515 |
| M8 | [artifacts/m8-ios/_expo/static/js/ios/entry-dbedd79eb6e19845f210da08ae660fc9.hbc](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/artifacts/m8-ios/_expo/static/js/ios/entry-dbedd79eb6e19845f210da08ae660fc9.hbc) | 2677218 |

Both requested pins were recorded before installation. The resolved public-registry packages are:

- <code>snapback4@0.2.9</code> — [registry artifact](https://registry.npmjs.org/snapback4/-/snapback4-0.2.9.tgz)
- <code>snapback4-expo@0.2.2</code> — [registry artifact](https://registry.npmjs.org/snapback4-expo/-/snapback4-expo-0.2.2.tgz)
- <code>snapback4-darwin-arm64@0.2.9</code> — [registry artifact](https://registry.npmjs.org/snapback4-darwin-arm64/-/snapback4-darwin-arm64-0.2.9.tgz)

Integrity strings are in [evidence/resolved-pins.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/resolved-pins.json) and the lockfile. The native application imports the installed Expo arm, not a source substitute. Runtime/build commands used the absolute Node 24.18.0 executable after the PATH version mismatch was found. Final TypeScript and Quarry checks pass; the compiler retains advisory residency/bounds notes.

## Scale replay and invariant verification

The final instance was fresh and compiled with replay mode enabled. Push and digest emissions were disabled. Starter actions and scale actions used the same application mutations and uploads, with sequential acknowledgements and stable mutation IDs. The sample conformance run exercised all 13 verbs and checked resulting media, relationships, replies, quotes, and reactions.

| Attempt | Start epoch | End epoch | Wall (s) | Excluded checkpoint time (s) | Replay time (s) | Settled actions | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| 1 | 1789376529.589 | 1789376682.273 | 152.684 | 0.000 | 152.684 | 24863 | failed; preserved |
| 2 | 1789376792.657 | 1789376970.097 | 177.440 | 46.271 | 131.169 | 28090 | failed; preserved |
| 3 | 1789377095.551 | 1789377896.758 | 801.207 | 43.252 | 757.955 | 167243 | verified |

Attempt 1 exited during concurrent administrative inspection (server exit 138, then ECONNREFUSED). Attempt 2 lost its connection after another overlapping CLI inspection. Their underlying cause remains ambiguous. Attempt 1 did not separately capture the failed checkpoint interval; its replay-time field conservatively includes that interval. The final runner stops only its recorded scale PID for administrative inspection and test-post cleanup, restarts it before API work, and excludes each whole checkpoint interval. Instrumentation was corrected after M6 conformance and during the failed attempts; the final attempt used the corrected frozen replay/checkpoint runner. These are local viability observations, not a cross-backend speed ranking or a hidden-holdout score.

The successful attempt acknowledged 167157 scale actions plus 86 starter actions (167243 total). Its SHA-256 is <code>b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9</code>, matching the frozen log. Exact verification passed at 10%, 50%, and 100%. It checked every entity-count class, every per-chat message count, every user's follow and conversation counts, every group size, the named O5 fixtures, full paging of the busy chat, and named profiles/posts/messages/conversations. Authentication receipts account for the user total; public administrative application views and independently paged APIs check actual stored state.

Final corpus: 1,008 users/profiles; 5,921 follow edges; 50,228 posts including 2,004 replies; 5,008 active likes; 1,004 active reposts; 1,002 conversations; 2,053 memberships; 100,015 messages including 910 media messages and 2,736 quoted replies; 2,000 active reactions. A second audit after probe cleanup and the cold client passed, so performance-test posts did not remain in the corpus. Evidence: [evidence/scale-run.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/scale-run.json), [evidence/scale-settles.jsonl](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/scale-settles.jsonl), [evidence/scale-verify-100.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/scale-verify-100.json), [evidence/scale-final-audit.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/scale-final-audit.json), [evidence/scale-fixture-validation.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/scale-fixture-validation.txt).

## Scale observations

Each API probe used three warm-ups and twenty measured requests, sequentially. These are builder-authored anchors, not the secret rotated probes.

| Probe p95 (ms) | 10% | 50% | 100% |
|---|---:|---:|---:|
| following500 | 21.95 | 9.82 | 8.86 |
| following5 | 7.83 | 4.59 | 4.23 |
| celebrityFollowing | 5.49 | 4.37 | 4.48 |
| historyPage1 | 35.63 | 28.66 | 24.12 |
| historyPage50 | — | — | 25.58 |
| insights | 3.39 | 3.09 | 2.94 |
| trending | 4.61 | 3.21 | 3.31 |
| celebrityWrite | 5.56 | 4.56 | 3.72 |
| ordinaryWrite | 4.86 | 3.97 | 3.11 |
| globalSearch | 64.01 | 39.07 | 36.37 |

Full-corpus ratios: deep-history page 50/page 1 = 1.06×; 500-follow/5-follow feed = 2.09×; celebrity/ordinary create acknowledgement = 1.20×. The ordinary writer was selected from the actual five-follower authors. Insights and Trending stayed below their first-checkpoint measurements; both return server-computed bounded results rather than downloading the corpus. Trending's card is bounded to the requested ten rows and therefore not an exhaustive-corpus card.

The raw server <code>search.all</code> probe returned zero rows with <code>complete:false</code> at every checkpoint. Its elapsed values above are **not successful search measurements**. The compiler's N_NEVER_COMPLETE warning explains the per-conversation authorization limitation. The actual application uses the local replica: after a fresh full sync it returned 50 search rows online and 50 with backend access blocked. A comparable three-checkpoint local-search latency curve was not captured, so that degradation claim is not established.

Fresh web client: authenticated UI ready in 10.13 s, 13356 snapshot events, 100 visible chat rows, and completed snapshot. Observed JS heap remained around 19.8 MB over the recorded samples; this excludes some wasm backing storage and whole-browser RSS, so it is not a comprehensive memory bound. Cold proof epochs: 1789377963.956 → 1789377981.331. [evidence/scale-cold-web.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/scale-cold-web.json) and [evidence/scale-probes.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/scale-probes.json) retain raw observations.

## Corrections and substantive proof

Normalized protocol correction loops: environment=2, agent-error=17, snapback4-defect=1, ambiguous=1. First-pass compile fixes are excluded; two scale inspection losses are one loop with two iterations. Initial documentation discovery and the unchanged-rerun offline flake remain recorded but are not counted as completed-work revisions. Operational log labels are preserved.

| Attribution | Correction / retained issue | Evidence |
|---|---|---|
| environment | Node PATH mismatch | [run-log.md](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/run-log.md) |
| agent-error | Generated module API references | [evidence/m2-acceptance-retry.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m2-acceptance-retry.txt) |
| environment | Frozen default fixture path | [evidence/m2-choreo-console.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m2-choreo-console.txt) |
| agent-error | Feed navigation from subsidiary screens | [evidence/m2-choreo-console.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m2-choreo-console.txt) |
| agent-error | Retryable Argon2 slot pressure | [scripts/auth-probe.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/auth-probe.mjs) |
| agent-error | Group title/slug route mismatch | [evidence/m3-choreo-retry2.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m3-choreo-retry2.txt) |
| agent-error | Overlapping suite/choreography and unstable seed comparison | [evidence/m3-acceptance-final.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m3-acceptance-final.txt) |
| agent-error | Uncreated DM route and duplicate group identities | [evidence/m3-choreo-retry3.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m3-choreo-retry3.txt) |
| agent-error | Queued per-keystroke typing and stray whitespace | [evidence/m3-choreo-retry4.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m3-choreo-retry4.txt) |
| snapback4-defect / defect | Retained history plus horizon disappears; unbounded sync workaround | [evidence/m3-retention-probe7.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m3-retention-probe7.txt) |
| agent-error | Required additive tombstone column failed adoption | [evidence/m4-window-console.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m4-window-console.txt) |
| agent-error | Empty-string JSX guard warnings | [evidence/m4-media-probe.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m4-media-probe.txt) |
| agent-error | Media authoritative settlement and video close control | [evidence/m4-acceptance-retry2.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m4-acceptance-retry2.txt) |
| agent-error | Offline link banner lag; shorter documented poll wait | [evidence/m5-choreo-console.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m5-choreo-console.txt) |
| agent-error | Premature M6 choreography launch before suite receipt | [evidence/m6-choreo-console.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m6-choreo-console.txt) |
| agent-error | Live presence read disabled send prediction | [evidence/m6-send-why.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m6-send-why.txt) |
| agent-error | Home chat rows for cross-device unread check | [evidence/m8-choreo-console.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m8-choreo-console.txt) |
| ambiguous (not a normalized loop) | Dual-offline intermittent timeout; unchanged retry and independent probe passed | [evidence/m8-choreo-final.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m8-choreo-final.txt) |
| ambiguous | Scale instance lost during concurrent administrative inspection; two iterations, stopped-server workaround | [evidence/attempt1-scale-run.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/attempt1-scale-run.json) |
| agent-error | Checkpoint celebrity post-count assumption | [evidence/scale-o5-exact-console.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/scale-o5-exact-console.txt) |
| agent-error | Deep quote navigation needed repeated taps | [evidence/deep-quote-proof.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/deep-quote-proof.json) |
| agent-error | Cold probe elapsed field mislabeled; value preserved and renamed | [evidence/scale-cold-web-original.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/scale-cold-web-original.json) |
| ambiguous (not a normalized loop) | Schedule module target refusal; root declaration workaround | [evidence/m8-check3.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m8-check3.txt) |
| snapback4-defect / knowledge-gap (not a normalized loop) | Undocumented processDevice directory signature | [evidence/process-device-preflight.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/process-device-preflight.txt) |
| agent-error (not a normalized loop) | First-pass Quarry syntax/index/type refusals (not protocol correction loops) | [evidence/event-ledger.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/event-ledger.txt) |
| environment (not a normalized loop) | Read-only copied file modes and missing shared harness helper | [lib/json-schema.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/lib/json-schema.mjs) |

The full ledger is [evidence/corrections.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/corrections.json) and [run-log.md](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/run-log.md). Additional proofs include real elapsed server edit-window refusal ([evidence/m4-window-probe.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m4-window-probe.json)), expiry and asset refusal with clients closed ([evidence/m5-expiry-probe.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m5-expiry-probe.json)), a scheduled digest through a backend restart and a quiet next period ([evidence/m8-digest-proof.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m8-digest-proof.json)), browser-process durable queue restart ([evidence/m8-durable-web-proof.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m8-durable-web-proof.json)), same-account edits/reactions ([evidence/m8-same-account-edit.txt](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/m8-same-account-edit.txt)), and one-tap deep quote paging ([evidence/deep-quote-proof.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/deep-quote-proof.json)).

## Hand-authored files

Counts are physical lines, not formatter-normalized statements. Several timed-build files are compact; bytes are included to make that visible. Vendored kit/harness, fixture files, node_modules, lockfile, generated types/config, binary assets, copied proof schemas, and build/state artifacts are excluded. Handwritten test and failed diagnostic scripts are included. Full per-file metadata, including documentation and this report, is [evidence/hand-authored-lines.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/evidence/hand-authored-lines.json).

| Code/config file | Lines | Bytes |
|---|---:|---:|
| [app.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/app.json) | 1 | 223 |
| [app/[...path].tsx](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/app/[...path].tsx) | 1 | 36 |
| [app/_layout.tsx](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/app/_layout.tsx) | 7 | 694 |
| [app/index.tsx](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/app/index.tsx) | 1 | 36 |
| [babel.config.js](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/babel.config.js) | 1 | 86 |
| [choreo-adapter.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/choreo-adapter.json) | 10 | 267 |
| [lib/json-schema.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/lib/json-schema.mjs) | 3 | 377 |
| [package.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/package.json) | 33 | 843 |
| [scripts/acceptance.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/acceptance.mjs) | 28 | 4831 |
| [scripts/auth-probe.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/auth-probe.mjs) | 1 | 749 |
| [scripts/browser-probe.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/browser-probe.mjs) | 2 | 476 |
| [scripts/checkpoint-exact-watch.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/checkpoint-exact-watch.mjs) | 1 | 1615 |
| [scripts/choreo.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/choreo.mjs) | 3 | 684 |
| [scripts/configure.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/configure.mjs) | 12 | 1265 |
| [scripts/correction-ledger.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/correction-ledger.mjs) | 29 | 3500 |
| [scripts/custom-client-demo.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/custom-client-demo.mjs) | 2 | 1085 |
| [scripts/deep-quote-proof.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/deep-quote-proof.mjs) | 1 | 1400 |
| [scripts/digest-proof.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/digest-proof.mjs) | 3 | 3130 |
| [scripts/dual-probe.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/dual-probe.mjs) | 1 | 1756 |
| [scripts/durable-queue-proof.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/durable-queue-proof.mjs) | 1 | 2739 |
| [scripts/expiry-probe.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/expiry-probe.mjs) | 1 | 1474 |
| [scripts/group-probe.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/group-probe.mjs) | 1 | 677 |
| [scripts/m2-tests.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/m2-tests.mjs) | 11 | 5059 |
| [scripts/m3-tests.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/m3-tests.mjs) | 10 | 3156 |
| [scripts/m4-tests.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/m4-tests.mjs) | 8 | 2928 |
| [scripts/m5-tests.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/m5-tests.mjs) | 9 | 3154 |
| [scripts/m6-tests.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/m6-tests.mjs) | 8 | 3194 |
| [scripts/m8-tests.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/m8-tests.mjs) | 7 | 3769 |
| [scripts/media-probe.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/media-probe.mjs) | 1 | 1102 |
| [scripts/offline-search-probe.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/offline-search-probe.mjs) | 1 | 836 |
| [scripts/prepare-scale.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/prepare-scale.mjs) | 1 | 1107 |
| [scripts/push-worker.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/push-worker.mjs) | 9 | 900 |
| [scripts/replay-lib.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/replay-lib.mjs) | 10 | 4502 |
| [scripts/replay.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/replay.mjs) | 1 | 450 |
| [scripts/report-metadata.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/report-metadata.mjs) | 5 | 3604 |
| [scripts/retention-probe.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/retention-probe.mjs) | 1 | 2335 |
| [scripts/same-account-edit-probe.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/same-account-edit-probe.mjs) | 1 | 2501 |
| [scripts/scale-cold-web.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/scale-cold-web.mjs) | 1 | 3017 |
| [scripts/scale-cold.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/scale-cold.mjs) | 1 | 807 |
| [scripts/scale-final-audit.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/scale-final-audit.mjs) | 1 | 1164 |
| [scripts/scale-run.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/scale-run.mjs) | 16 | 3871 |
| [scripts/scale-server.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/scale-server.mjs) | 1 | 1516 |
| [scripts/scale-verify.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/scale-verify.mjs) | 23 | 6257 |
| [scripts/seed.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/seed.mjs) | 7 | 2803 |
| [scripts/signed-probe.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/signed-probe.mjs) | 1 | 570 |
| [scripts/trending-expiry-proof.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/trending-expiry-proof.mjs) | 3 | 1637 |
| [scripts/visual-proof.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/visual-proof.mjs) | 1 | 832 |
| [scripts/window-probe.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/window-probe.mjs) | 1 | 925 |
| [scripts/wire.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/wire.mjs) | 7 | 1105 |
| [scripts/write-report.mjs](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/scripts/write-report.mjs) | 16 | 13450 |
| [setup-identity.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/setup-identity.json) | 49 | 1103 |
| [snapback/analytics.q](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/snapback/analytics.q) | 61 | 2108 |
| [snapback/chat.q](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/snapback/chat.q) | 231 | 9518 |
| [snapback/digest.q](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/snapback/digest.q) | 26 | 593 |
| [snapback/media.q](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/snapback/media.q) | 45 | 1995 |
| [snapback/schema.q](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/snapback/schema.q) | 66 | 3031 |
| [snapback/search.q](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/snapback/search.q) | 5 | 382 |
| [snapback/settings.q](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/snapback/settings.q) | 35 | 1646 |
| [snapback/social.q](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/snapback/social.q) | 162 | 5362 |
| [src/Analytics.tsx](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/src/Analytics.tsx) | 5 | 1594 |
| [src/App.tsx](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/src/App.tsx) | 22 | 6173 |
| [src/Chat.tsx](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/src/Chat.tsx) | 22 | 12955 |
| [src/Search.tsx](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/src/Search.tsx) | 3 | 2142 |
| [src/Social.tsx](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/src/Social.tsx) | 22 | 5262 |
| [src/Video.tsx](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/src/Video.tsx) | 3 | 273 |
| [src/Video.web.tsx](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/src/Video.web.tsx) | 2 | 233 |
| [src/client.ts](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/src/client.ts) | 4 | 321 |
| [src/device.ts](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/src/device.ts) | 4 | 251 |
| [src/device.web.ts](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/src/device.web.ts) | 3 | 287 |
| [src/id.ts](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/src/id.ts) | 2 | 218 |
| [src/poster.ts](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/src/poster.ts) | 2 | 162 |
| [tsconfig.json](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/tsconfig.json) | 1 | 152 |

## Candid gaps and limits

- Retained history combined with a horizon reproduced disappearing retained rows. The application uses unbounded conversation history sync. The full cold account worked here, but larger retained populations remain a storage/acquisition risk.
- Raw server-wide message search is incomplete under the current authorization plan; the app's fully synced local search works. Third-party clients cannot assume the raw endpoint is exhaustive.
- One dual-offline choreography rerun timed out. Subsequent unchanged and post-fix runs, plus independent probes, passed; the transient cause is unresolved.
- Administrative CLI inspection overlapping a scale server was followed by two connection-loss failures. Stopped-server inspection made the final run complete; the root cause is not proven.
- The README mentions <code>processDevice()</code> without the required directory signature; the no-argument call threw <code>dataDir.replace</code> on undefined. The browser arm provided the cold-scale proof instead.
- iOS Hermes exports are build artifacts. No simulator/physical-device proof, whole-process memory measurement, hidden grader execution, or production-hosting validation is claimed. M7 remains for its separate fresh session.
- Later instrumentation corrections and post-green UI verification are visible in the log rather than concealed inside first-green times. The qualitative essay was initially written before the numerical tally, with a later replay addendum.

[README.md](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/README.md) documents startup, grading config, worker, seed, acceptance, and replay entry points. [API.md](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/API.md) is the custom-client contract. [diary.md](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/diary.md) contains every milestone boundary; [essay.md](/Users/ccheever/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/essay.md) contains the qualitative comparison.

Only listening ports 49320, 49321, and 49322 were used. Every server PID and each scale restart is recorded in the run log. The final listener check is empty; only recorded owned PIDs were signaled. Overall recorded wall to report generation: 6876 s.

end=1789378703
