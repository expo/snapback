# Lane NS, round 0 — native smoke at every milestone

`npm run native:smoke` is generated for both Expo starters. It runs the existing
own-Release build and installed-app smoke without command arguments: it selects
only a tool-named simulator, reserves a free backend port, runs backend codegen,
installs the app and writes timestamped artifacts. Explicit UDID/port/artifact
flags remain available. Missing Xcode/runtime produces one actionable setup
message before compilation. The simulator identity is printed and recorded.

Both starters include the pinned Expo 57 UIScene plugin required by iOS 27 and
normal guest sign-in during smoke prime when no account is restored. Ordinary
launches and offline/restart never automatically create a guest. The generated
scripts, starter READMEs and client/witness guide cards put native smoke beside
Hermes export as the per-milestone check. Generic smoke proves local acquisition,
offline reopen and reconnect. It does **not** queue a write, so pending-write
replay still requires the documented deeper application scenario. Empty starter
holdings prove lifecycle, not nonempty application history, media, M6/M8 or
physical-device behavior.

The private native cache retains generated iOS/Pods and DerivedData; Xcode runs
and emits new JavaScript every time. Cached generated headers are audited after
CocoaPods repairs them. Metro's private cache is keyed by backend origin because
Expo CI disables its normal reset and otherwise retains the previous port in
inlined JavaScript. Repack remains withdrawn. The exact generated plain/social
Podfile and support-script forms join the bounded preparation audit.

The governing context was assembled with llp-orient from the sibling checkout
(the local skill symlink was uninitialized): LLP 3000#4 (the fence),
3000.030#3/#5/#8 (build provenance, process ownership and scope),
3000.007#20.10 (installed application assertions), 3000.019#3.4 (backend store
ownership), and 2000.000#12 (the measured loop). LLP 3000.030 remains in current.
No engine/client contract or meter changes were made.

All Mac commands used `~/np-tools/node/bin:~/np-tools/bun/bin` on PATH and
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`. No xcode-select or
system setting was changed. `SNAPBACK4_SMOKE_DEVICE_PREFIX=sb4-ns-` isolated this
lane; `mini-verify-iphone` was never used. The installed CLI shim used
`SNAPBACK4_BIN` to select this unpublished branch's binary. Package dependencies
were installed normally, then the two Snapback packages were replaced with
locally packed source candidates (including the freshly built XCFramework).
Their version remains 0.4.9; the registry lock alone does not describe these
candidate bytes. The tarball hashes, host/toolchain and exact source inventory
are retained alongside this report. Nothing was published.

The measured command is exactly `npm run native:smoke`. Cold means a fresh
starter, no generated iOS tree, empty private Pods/DerivedData/Metro caches and
a newly created simulator. Xcode/runtime and JavaScript dependency installation
are prerequisites, excluded from command timing; global host caches were not
flushed. Warm runs keep that same application, private native cache and simulator.
Each chooses a free port and creates new immutable receipts. `measure.py` records
wall time and host load every five seconds. `collect.py` checks each successful
manifest, all artifact hashes and proof/build binding before preserving complete
receipts/logs compressed under `receipts/`. The installed app and xcresult remain
in the exact local artifact paths listed in `receipt-index.json`.

Development attempts are retained, including unsuccessful ones:

| Attempt/check | Classification | Result and disposition |
| --- | --- | --- |
| Initial guide check | Ours | Four failures: client word budget, witness example ordering, new artifact path allowlist, and updated simulator diagnostic definition. Fixed; whole guide 106/106 passed. |
| `cold-attempt-1` | Ours, starter integration gap | Plain Expo generated Podfile/support forms were absent from the bounded adapter; refused before Xcode. Added exact inspected forms. |
| Initial cold (`cold`) | Passed development control | 186.404 s, all three segments. Superseded by the final cold sample below. |
| `warm-1` | Ours | Cached Pods header links were inventoried between dependency snapshot and regeneration; ENOENT. Inventory moved to the post-Pods stage with a reproducing regression. |
| First new cache regression | Ours, test fixture | The fake prebuild copied relative symlinks as absolute targets. Fixed the fixture to preserve relative links; all 13 preparation tests pass. |
| `social-preflight` | Ours, starter integration gap | The social starter's exact module-provider script was not yet admitted. Added the inspected generated form. |
| `warm-fixed` | Ours | Reused CI Metro transforms retained the previous port; prime timed out at 120 s. The two build receipts had identical JS hashes despite different origins. Origin-keyed Metro cache fixes it. |
| `warm-origin-fixed` | Passed development control | 87.985 s, all three segments with the new origin; final code. |

No failed invocation is counted as a passed warm sample. No timeout, assertion,
engine budget, or full-suite count was relaxed. The original failed receipts and
logs remain in `receipts/`; the final sample is explicitly labeled `qualified-*`.

The final measured series uses one freshly generated `init --expo` starter at
`/Users/ccheever/sb4-np/ns-qualified`, with no source edits between runs. The host
is an 18-core Apple M5 Pro / 64 GiB mini, Xcode 27.0 (27A266a), iOS 27.0,
Node 24.18.0, npm 11.16.0 and CocoaPods 1.17.0. Host-wide one-minute load is
sampled throughout each invocation; it includes this command and other sessions.

| Final sample | Wall seconds | 1-minute load min / median / max | Result |
| --- | ---: | --- | --- |
| `qualified-cold` | 221.724 | 3.61 / 18.24 / 61.41 | All three segments passed |
| `qualified-warm-1` | 84.566 | 4.89 / 5.67 / 7.22 | All three segments passed |
| `qualified-warm-2` | 82.009 | 4.32 / 4.90 / 5.39 | All three segments passed |
| `qualified-warm-3` | 83.511 | 3.21 / 3.68 / 6.13 | All three segments passed |
| Social starter, separate control | 186.191 | 14.62 / 23.47 / 47.52 | All three segments passed |

Cold median is **221.724 s (n=1)**; warm median is **83.511 s (n=3)**,
range 82.009–84.566 s. The social control is not part of the warm sample.
The earlier cold development run saw a load median of 116.4 and maximum of
231.37, so comparing all attempts as though this were a quiet host would be
misleading. “About 3 minutes warm” remains approximate builder guidance, not a
latency promise. The qualified measurements here are faster.

Cold CocoaPods preparation took 93.174 s versus warm 13.775 / 11.143 / 11.639 s;
Xcode took 43.915 s versus 28.914 / 29.375 / 29.274 s. Stable generated iOS,
Pods and DerivedData paths are reused. Xcode is still invoked, with 82
`CompileC`/`SwiftCompile` log entries on every sample; no claim of zero native
compilation is made. Each port and emitted JavaScript hash differs. Successful
prime/offline/restart proves that the origin-cache repair reaches the native
runtime, not merely the build receipt.

The final cold selected and created `sb4-ns-1790751789343-32355`, UDID
`9B126451-3726-4571-A8C8-F1C334B35ECC`, runtime
`com.apple.CoreSimulator.SimRuntime.iOS-27-0`; all three warms and the social
control reused it. The command prints this identity and every run receipt
records it. All three devices created during development and qualification
have been deleted by their exact UDIDs; `simulator-cleanup.json` records their
absence. No other device was selected or changed.

`receipt-index.json` locates every original artifact directory and records
verified hashes for eleven attempts, seven successful. Complete receipts,
preparation inventories/logs, video and screenshots are retained under
`receipts/<sample>/`; JSON/log text is gzip-compressed without changing its
bytes. Decompress with `gzip -dc`. Top-level command logs are also preserved as
lossless `.log.gz` files; `check-logs.json` binds their original bytes. Large app and xcresult directories remain
at their recorded local paths; their full inventories are in the build receipt.
The final plain starter is intentionally empty; these are installed Release,
local-store and lifecycle observations, not populated-chat or replay results.
The social starter supplies an independent Router/UIScene build-and-launch
control, also without a seeded application scenario.

Final affected checks, run after the origin-cache repair on this Mac:

- `cargo test -p snapback4 --test init --test witness`: **22 + 32 passed**.
  Fake simctl tests cover prior prefix reuse, other-session and near-prefix
  exclusion, creation on the newest available numeric runtime, a lane-specific
  prefix, and one-message Xcode/runtime failures before preparation/backend.
- `cargo test -p snapback4 --bin snapback4 witness::`: **10 passed**.
- `node --test packages/snapback4/test/periphery.test.mjs`: **19 passed**
  after correcting the full-suite exact-config assertion described below.
- Helper, preparation and native-smoke Node tests: **36 passed**. These cover
  the actual installed Expo template migration, guest restoration boundary,
  generated-iOS warm preservation, the cached-header regression, fresh JS,
  existing output/script provenance guards and smoke failure cases.
- `cargo test -p snapback4-lang --test guide`: **106 passed**. Client remains
  114 lines / 1,198 words, witness 399 lines, package README 300 lines; no line
  or word budget was raised.
- The client build, native XCFramework build, `ref-check --verbose` and
  `git diff --check` pass. Detailed logs remain beside the measurements.

The single complete `scripts/test.sh` invocation runs in the isolated
`/home/ccheever/sb4-intent/lane-ns-verify` worktree on eb1000. It uses base
`2cb2b5f141befd4c5dfd6afdc6c0725867f3c747` plus `suite-source.json`'s exact
file inventory, Node 24.13.1, Bun 1.3.14 and Cargo 1.97.0. Its initial host-wide
load was 103.18 / 75.18 / 62.37 on 96 CPUs. The suite began before the last
Metro-origin repair: the only subsequent executable delta is the origin-keyed
`TMPDIR` and its explanatory comment in `prepare.mjs`. One README follow-up
line also changes the repeat instruction to `npm run native:smoke`; LLP and
report text subsequently record final results. The suite also exposed one
stale exact-config assertion in `periphery.test.mjs`, corrected afterward to
expect the new plugin while preserving comparison of all other config fields. Final affected checks
above and all four qualified native runs cover that final delta. The full
suite is evidence for its recorded source snapshot, not an assertion that
it ran on the final helper bytes. The final source inventory separately
records the committed implementation. The inherited nominal 60-second suite
bar is exceeded; no count, timeout or assertion was relaxed.

The exact full-suite summary is:

```text
== 1 failure(s) in 1665 s
   client tests
```

Exit status **1**. All failures: **ours 1, baseline 0, environmental 0**.
The sole failure was `Expo starter copies reference pins, parses configs, and
carries both client tiers` at `packages/snapback4/test/periphery.test.mjs:158`:
its exact app.json expectation lacked the newly required `snapback4-expo/plugin`.
The assertion now expects the reference config plus that plugin and still
compares every other field. The complete affected file passes **19/19** on the
final tree (`periphery-qualified.log.gz`). This is a corrected test expectation
for an intentional config change, not a removed assertion or relaxed behavior.
The full suite was run exactly once and is **not** relabeled green after this
focused rerun.

Rust: **4,365 passed, 33 declared ignored**. Client pool: **5,309 passed,
1 failed, 10 existing skipped**. Fixtures: **9 passed**. Serial models:
**79 passed**, including both complete 5,000-sequence session walks and the
3,000-sequence online-client walk. There were no cancellations or reduced
counts. `full-suite.log.gz`, `full-suite.exit` and `full-suite-host.txt` retain the
complete original run. Linux wasm is **1,978,828 B raw / 593,225 B gzip**, 494 B
under the unchanged ratchet.

`bash scripts/build-wasm.sh` on the Mac measures **1,977,951 B raw /
593,592 B gzip**, below the unchanged **593,719 B** ratchet by **127 B**.
No wasm code or budget was changed. The full-suite Linux measurement is
reported above; there is no cross-host byte-identity claim.

This branch is committed locally with the requested co-author trailer.
Nothing is pushed or published.
