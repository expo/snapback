# Lane PUB — Snapback 4 0.4.53

COMPLETE THROUGH THE REQUESTED STOP POINT. Release source is landed and frozen; native/preparation/audits, Mac pre-Darwin, full Linux qualification, and the Mac tolerant dry run passed. Mac attempt 1 exited 0 in 11,327.394s; `dry-run-1.exit` is `done`. The gate finished successfully at 2026-11-04 08:40:14Z without an environment-invalid marker. All four staged artifacts passed final integrity/provenance verification. No finish, resume, npm publish, or records commit was run by this lane.

## Frozen source and changes

Release commit: `9da2c76fdf32b20f985c85fe6d33b507c09edd25`, parent `9346e1fa3717e0223de52720b005027a4016e0dc`.

`chore(sb4): prepare snapback4 0.4.53 release` was committed on `sb4-publish-0.4.53`, with the requested Claude Fable 5.1 coauthor trailer, and pushed to `origin/main` at github.com/expo/snapback. The last pre-push fetch found no main movement, so no rebase was needed. The pre-push hook deferred its selected drift gates under the normal policy; no strict/bypass environment variables were set. The owned Mac checkout is detached at this exact SHA. Later main commits are excluded.

Within `snapback4/`, the commit changes 16 files (28 insertions, 27 deletions):

- `Cargo.toml`, `Cargo.lock`, and `native-fixtures/following/Cargo.lock`.
- The package manifests for `snapback4`, `snapback4-expo`, `snapback4-darwin-arm64`, and `snapback4-linux-x64`, including platform optional dependencies.
- `editors/tree-sitter-quarry/{README.md,package.json,tree-sitter.json,keywords.generated.js}` and `editors/vscode/{package.json,syntaxes/quarry.tmLanguage.json}`. Generated stamps came from the real generator.
- `packages/snapback4/test/{device-version,sync-generation}.test.mjs` and `packages/snapback4/reference/CHANGELOG.md`.

The release announcement leads with LLP 3000.001.001 progressive acquisition: negotiated `progressive-acquisition-v1`, tier-1 horizonless tables first, horizoned groups at their horizon, supported foreground history prioritizing the open conversation, and `useAcquisition().usable` durable whole-table/floored-group coverage. It preserves the distinction between usability and complete acquisition/catch-up, legacy-peer fallback, and the prediction gate. This lane changes release pins and documentation, not product behavior.

The source diff was reviewed before and after preflight and remained identical: SHA256 `a0c4ddc8782f70d847b07872789020035af9f68f57ac49368a75c977e5faa97d`. The verified source bundle is `/Users/ccheever/sb4-pub-0453/release-evidence/frozen-release.bundle` (requires the parent commit).

## Locations

- Mac checkout: `/Users/ccheever/sb4-pub-0453-wt`.
- Mac kit and UTC chronology: `/Users/ccheever/sb4-pub-0453/STATUS.md`; assumptions: `CONTEXT.md`; live state: `ACTIVE.json`.
- Publication attempt receipts/logs: `/Users/ccheever/sb4-pub-0453-wt/snapback4/reports/20261104-publication-0.4.53/attempt-1-*`.
- Native witness records: `/Users/ccheever/sb4-pub-0453-wt/snapback4/reports/20261104-expo-0.4.53/`.
- Prepared client/Expo: `/Users/ccheever/sb4-pub-0453-wt/snapback4/target/publication/client-0.4.53/`.
- Linux host: `ccheever@100.65.137.99`; owned source: `/home/ccheever/sb4-intent/0453/source`; qualification: `/home/ccheever/sb4-intent/0453/linux-qualification-0.4.53`; kit and wrapper receipts: sibling `kit/` and `records/`.

## Completed evidence

Release preflight command, from the repository root, with Volta Node 24.18.0 and `SNAPBACK4_BIN` unset:

```text
node snapback4/scripts/affected.mjs --base origin/main --worktree --run
```

The selector receipt reports `complete: true`, `unchanged: true`, `ok: true`; all 32 effective checks passed. Evidence is `kit/release-evidence/affected-passed.json`, `affected.log`, and `affected.exit` (`0`). Actual output includes:

```text
-- client files: 1/1; failed 0; tests {"tests":9,"pass":9,"fail":0,"cancelled":0,"skipped":0,"todo":0}
-- client files: 492/492; failed 0; tests {"tests":8758,"pass":8725,"fail":0,"cancelled":0,"skipped":33,"todo":0}
-- client files: 2/2; failed 0; tests {"tests":89,"pass":89,"fail":0,"cancelled":0,"skipped":0,"todo":0}
ref-check: ok — 583 LLP docs, 13640 refs in 54710 files, 0 errors, 0 unchecked
Lean campaign: existing OPEN C2/W4 classification; raw exit 1; findings {"lean--continuation-next--next~no-next":5,"lean--next--next~no-next":8,"lean--prelude-code--E_RULE~NOT_FOUND":5}
```

The Lean campaign is explicitly an effective policy pass, not a raw-zero result: 18 findings match the existing classifier; `unclassified` is empty. The exact campaign report is preserved as `release-evidence/affected-lean-campaign-report.json`, SHA256 `7ceb5ea6d5568eb74326d041fb4d6f48b8b6a69c4ac5ae92bdc495081170a854`. No new waiver was introduced.

Preflight also ran the seven Rust crates, release/selector tests, editor grammar, generated artifacts, guide, root `node scripts/check-inventories.mjs`, packaged docs, typechecks, diagnostics, wasm measurement, Lean build and differential tests. Guide: 22 passed, 0 failed/skipped/preconditions, 121 inherited warnings. Inventories: 365 package tests, 35 script tests, 31 demos/catalog, 487 publication leaves, 162 guide pages and 1,937 snippets. Mac wasm: 2,450,051 raw / 749,050 gzip / 563,478 brotli bytes; gzip budget 749,531, over budget 0.

The three existing lifecycle-ticket test files (`dx12-serve`, `srv1-lifetime`, `ver1-loop`) also passed unchanged in isolation: 3/3 files, 38 tests, 37 passed, 1 platform skip, 0 failures. This is reproduction evidence, not a claim that those tickets' causes were fixed. Log: `kit/known-reds-initial.log`.

Mac native chain (`chain-gate-a2.sh` → `chain-a2.sh`, attempt 1) passed all 18 steps, with `native-1.exit = done` and gate `chain exit 0 (env-ok)`. The framework build took 147.193s; Expo Release build 77.84s; native witness step 25.301s. Offline witness passed in 9.610s and restart/relaunch in 13.314s, both exit 0 and artifact hashes verified. Simulator: `D2C67F7F-196C-439E-AEB9-3FDA4479761E` (iPhone 17 Pro / iOS 26.5), subsequently shut down. Native toolchain: Node 24.18.0, Bun 1.4.2, Rust 1.97.0, Xcode 27.2 (27B52), macOS 27.2, Apple M5 Max.

`post-native` passed; `ATTEMPT=1 bash publish.sh prepare` passed in 30.095s (`prepare-1.exit = done`). `expo-prep-check.py` printed `prepared Expo files 28 qualified 28 equal True`, now asserted rather than merely printed. Lean setup passed in 0.357s (`lean-1.exit = done`); the warm workspace test build passed in 692.429s (`warm-1.exit = done`).

Fresh stock web and Expo audits passed with zero vulnerabilities and zero warnings on Mac after preparation, Linux before qualification, and Mac immediately before the dry-run handoff. Mac receipts: `isolated/audit-mac-early/summary.json`, `isolated/audit-mac-pre-dry/summary.json`; wrapper exit files are `0`. Linux receipt: `records/attempt-1-linux-early-audit.json`, exit 0 (25.935s). These use the current frozen CLI and prepared artifacts.

The prepared transfer was verified on both hosts, including SHA256, SRI, and frozen source. The Linux qualifier consumes these Mac-prepared bytes; it does not repack the client.

`caffeinate -ims bash pre-darwin.sh` passed with `isolated/pre/pre.exit = 0`. It retained the original 49-file selection, serial runner, required Lean, published fence, and resource gates. Actual summary:

```text
-- client files: 49/49; failed 0; tests {"tests":947,"pass":928,"fail":0,"cancelled":0,"skipped":19,"todo":0}
```

Logs: `kit/isolated/pre/pre.log`, `pre-darwin.out`, and `chain-pre-a2.log`. No retry was needed.

The official Linux attempt-1 source suite passed. Its retained `archives/linux-attempt-1/suite.log` contains:

```text
-- rust inventory: 493 test binaries, 1211 executions; at most 24 concurrent processes
-- rust target: workspace doctests (3.3 s)
-- ok: cargo test (947 s)
-- client files: 1/1; failed 0; tests {"tests":9,"pass":9,"fail":0,"cancelled":0,"skipped":0,"todo":0}
-- client files: 487/487; failed 0; tests {"tests":8717,"pass":8659,"fail":0,"cancelled":0,"skipped":58,"todo":0}
-- client files: 2/2; failed 0; tests {"tests":89,"pass":89,"fail":0,"cancelled":0,"skipped":0,"todo":0}
== 0 failure(s) in 3051 s
```

Linux attempt 1 subsequently failed during installed-consumer qualification because historical fixture files had been archived. After the environment recovery below, attempt 2 repeated the entire source suite and passed: `== 0 failure(s) in 2818 s`, with the same Rust/fixture/client/model counts (Rust worker 882s; doctests 3.3s).

**Linux attempt 2 fully passed.** `node scripts/qualify-linux.mjs --client target/publication/client-0.4.53/snapback4-0.4.53.tgz --expo target/publication/client-0.4.53/snapback4-expo-0.4.53.tgz --out /home/ccheever/sb4-intent/0453/linux-qualification-0.4.53` ran under `linux-a2.sh` with required Lean, `SNAPBACK4_BIN` unset, fresh attempt-specific npm cache, and the supported recovered-fixture override. Qualification exit 0, 5,286.178s. The official receipt records 12/12 frontend proofs, 6/6 starter proofs, Ubuntu 24.04 / Node 24.13.1 and Alpine / Node 24.18.1 via `proot`, and a static x86_64 ELF (`interpreter: null`, `needed: []`). DX5, proof-kit, client/rule recipes and the remaining installed-consumer checks passed.

The staged `clean-install-linux.sh` passed in 3.329s; both `linux-2.exit` and `run-2.exit` are `0`. Actual output includes:

```text
snapback4 0.4.53
init rc=0
check rc=0
installed binary SHA256 matches Linux receipt: d6a13a532fcc7a6f3f30625df84cafac4adabd355b636ebd34ab87ba7a6c3bf0 bytes 46593152
STAGED CLEAN INSTALL PASS (registry install remains post-publication)
```

`assemble-records.sh` exited 0 and printed `ASSEMBLE RECORDS: retained pre-publication snapshot (original logs unchanged)`. The snapshot and failed-attempt archive were copied to the Mac publication report's `linux/` directory (transfer exit 0); dependency/cache trees, tarballs, and the diagnostic-only unpacked binary are excluded from that Mac records copy. Original remote evidence remains untouched.

The transfer guard checked remote successful exit files, source, and SHA256; downloaded complete files outside the incoming directory; invoked the official validator with the exact prepared client/Expo integrity; then atomically exposed the tarball and receipt (receipt last). The chain independently printed:

```text
LINUX READY: successful receipt, exact client/Expo/platform integrity and source verified
```

Linux receipt SHA256: `8dff4020a2d2db86753ae86423017568178d38ae985ac47ea1e57dd9207a8c2b` (72,929 bytes). Linux package: 19,074,830 bytes. Evidence: `kit/linux-transfer-verified.json`, `linux-transfer-validation.log`, `linux-ready-a2.log`, `linux-assemble-records.{log,exit}`, and `linux-records-transfer.{log,exit}`. The post-recovery fresh Mac audit repeat also passed with zero findings/warnings for web and Expo (`audit-mac-pre-dry-after-linux-recovery.exit = 0`).

| Qualified staged package | SHA256 |
|---|---|
| snapback4 | `9902f0e6a46640c06717b52ace44ac2f8616a7cecfbd9649f3913ef6fdac77f2` |
| snapback4-expo | `32c78340ebb6607e65539b4a09aaf447378656783824328a48e718b59222ff6f` |
| snapback4-darwin-arm64 | `6028e015d2c3ed73f47e72c42218fc8cbd5a8f48c3ba019f9e3542b06417fb8a` |
| snapback4-linux-x64 | `b0716e005775ec4a0623c36cccba0e3a43ed6fcd940fbb63cf03fc7e9ffdf314` |

The complete Mac dry-run source suite passed. Actual output:

```text
-- rust inventory: 493 test binaries, 1211 executions; at most 2 concurrent processes
-- rust target: workspace doctests (2.4 s)
-- ok: cargo test (2517 s)
-- client files: 1/1; failed 0; tests {"tests":9,"pass":9,"fail":0,"cancelled":0,"skipped":0,"todo":0}
-- client files: 487/487; failed 0; tests {"tests":8716,"pass":8683,"fail":0,"cancelled":0,"skipped":33,"todo":0}
-- client files: 2/2; failed 0; tests {"tests":89,"pass":89,"fail":0,"cancelled":0,"skipped":0,"todo":0}
== 0 failure(s) in 10694 s
```

The actual dry-run command was the retained `gate-tolerant.sh` flow with `ATT=1`, `RUSTPROCS=2`, and `COMMIT=9da2c76fdf32b20f985c85fe6d33b507c09edd25`. Its receipt records the following publisher invocation from the frozen `snapback4/` directory, under Volta Node 24.18.0, the codesign relay PATH, `CARGO_INCREMENTAL=0`, required Lean, serial client files, and the recovered fixture-root override:

```text
node scripts/publish.mjs --dry-run --linux-receipt target/incoming/linux-0.4.53/receipt.json --linux-tarball target/incoming/linux-0.4.53/snapback4-linux-x64-0.4.53.tgz
```

`SNAPBACK4_BIN` was explicitly unset. Both pre-dry and post-suite npm cache refreshes passed 6/6 online and prefer-offline resolutions. The gate entered on AC with the lid open and 1,087 GiB free; its log contains no battery transition, sleep or environment-invalid event. Actual final gate output:

```text
2026-11-04T05:30:46Z starting dry run attempt 1 (100%;)
2026-11-04T08:40:14Z attempt 1 finished: done after 11368 s
```

The publisher completed at `2026-11-04T08:39:33.548Z`; its metric records `dry: true` and `publish_s: 11326.9`. The raw wrapper receipt records exit 0 and 11,327.394s. The foreground chain session also returned exit 0. No Mac retry or test repair was needed.

Darwin production build, installed-binary equality/version checks, and Developer ID signature verification passed. Binary: 35,045,344 bytes, SHA256 `aeb2d9c4c18d940f6471bd4f7c161ba55433300f3bc5b9f8b894e1dec8b311d6`; authority `Developer ID Application: Charles Cheever (UD2ZVW5WU5)`. As in 0.4.52, `notarized` is false; this is not a notarization claim. All six starters passed typecheck/build, all 12 frontend proofs passed, adapted web/Expo and negative proofs passed, and the proof-kit, staging, security, and day-five proofs report `passed`.

The complete dry metric/proof object is retained as `reports/20261104-publication-0.4.53/dry-run-record.json` and in the original attempt log and appended metric row. The durable stage is:

```text
/Users/ccheever/sb4-pub-0453-wt/snapback4/target/publication/snapback4-darwin-arm64-0.4.53/resume.json
```

Final read-only command `/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node /Users/ccheever/sb4-pub-0453/verify-dry-handoff.mjs` exited 0. It used the official artifact/Linux validators, checked every packed manifest/SRI/byte count, matched client/Expo to preparation and Linux to the incoming receipt/tarball, checked the Darwin binary hash, verified the successful consumer-proof bindings and both cache refreshes, and confirmed detached frozen source plus exactly one appended dry metric. It did not import or invoke the publisher. Output: `kit/handoff-verification.log`; full evidence: `kit/handoff-verified.json`; exit: `kit/handoff-verification.exit`. Stage receipt SHA256: `35ad3e79fa5397e3efb2023e7cdc008907b53109733748e612c58f3b8fbf8315`.

Staged package sizes: client 1,285,090 bytes (386 packed files), Expo 7,754,752 bytes, Darwin 16,669,580 bytes, Linux 19,074,830 bytes. All four tarballs are retained beside `resume.json`; SHA256 values are in the table above and complete SRI values are in `handoff-verified.json`.

The Mac dry-run progressive-acquisition file completed in 46.605s: 34 tests, 33 passed, 1 skipped, 0 failed. The existing skipped test is `browser React hooks and IndexedDB close/reopen`, whose TAP reason is `not run (sandbox): react.test.mjs and witness/idb.mjs SIGABRT; supervisor owns browser validation`. This lane does not claim that skipped browser check ran. Its completed-file excerpt is `kit/release-evidence/mac-dry-progressive-acquisition.log`, SHA256 `68320493847cfc0078ce020c1e1a3f8486cb9d9099b8cdf8714e578724218779`.

## Assumptions and irregularities

Linux attempt 1 stopped at `snapback4/scripts/publication-dx5-upgrade.mjs:99`, symbol `proveDX5Upgrades`, with `ENOENT` reading `/home/ccheever/sb4-loop/wave21/apps`. Both `linux-1.exit` and `run-1.exit` are `1`; no success receipt was issued. The original Wave 21 apps had been archived, and the Mac default path was also absent. This is an environment recovery, not a flake waiver or product-code repair.

The supported `SNAPBACK4_WAVE21_ROOT` override now points to lane-owned copies. The original `/home/ccheever/sb4-loop/wave21/archive.tar.zst` supplied only the two required lanes' authored `snapback`, `scripts`, and compatibility-baseline files (32 files, 210,930 bytes; stores, generated files, dependencies, symlinks and credential files excluded). Both original script SHA256 values match the published 0.4.52 proof record. Archive SHA256: `d8d30eeea8c7dfb9da2d24a3689a310c245a65300bb83e140d0cb7c450a249a4`. Linux per-file manifest: `records/wave21-fixture-manifest.json`; identical Mac copy and manifest: `kit/fixtures/wave21/`.

The first recovery diagnostic could not start because the failed qualifier had already cleaned up its temporary platform tarball; that exit/log remains unchanged. A diagnostic-only tarball was then packed from the already-built production binary. The second diagnostic ran the actual `proveDX5Upgrades(..., {evidenceOnly:true})` function and printed:

```text
WAVE21 ENVIRONMENT CHECK PASS: unchanged historical acceptance 80/80 and foreground prod:serve 8 users; not publication qualification
```

That diagnostic passed in 26.8s. It is not used as qualification or a Linux handoff. The failed full attempt is archived under `/home/ccheever/sb4-intent/0453/archives/linux-attempt-1/`, with hashes checked before and after the move; wrapper receipts/logs remain under `records/attempt-1-*`. New attempt-2 scripts and output paths preserve every previous log. Mac `publish-lowpar.sh` uses the same supported fixture-root override; `kit/wave21-recovery-kit.diff` records the reviewed script changes. The supervisor-only `finish.sh` also carries that override because resume re-runs the installed-consumer proofs; its original is archived, `finish-fixture-override.diff` contains the reviewed one-line change, and `bash -n` exited 0. It was not executed. Frozen source and prepared client/Expo bytes are unchanged.

- The 0.4.52 announcement does not list known gaps, so the two 2026-11-03 starter tickets are omitted from this release entry.
- No literal 0.4.52 integration entry was found in the current JOURNAL; the prior publication REPORT and exact release commit supplied that integration record.
- The old following fixture lock still pinned 0.4.49; it was advanced to 0.4.53 with the rest of the release pins. Initial setup refusals (that stale pin and missing fresh-tree build/inventory prerequisites) remain in the logs; prerequisites were built before the complete green preflight. No failed test receipt was rewritten.
- The rendered kit copied 66 code/helper files, not logs/archives. All 570 changed diff lines were reviewed; shell/Python syntax and Node checks passed. Inherited `a2` filenames still execute attempt 1. Added guards refuse previous log/receipt paths, unset `SNAPBACK4_BIN`, assert Expo equality, retain the foreground process tree, and recheck disk at dry-run entry. Bare grep calls use `/usr/bin/grep`.
- Homebrew GNU `timeout` 9.11 is available on this Mac despite the prompt's warning, so the inherited pre-Darwin bound is retained. Publication Node remains explicitly Volta 24.18.0 rather than ambient Node 25.9.0. Linux uses its existing Node 24.13.1 and Bun 1.4.2.
- The original Linux clean-install script installs an already-published registry version. It is retained as `clean-install-linux-registry.sh`. The active pre-publication clean-install script installs the exact prepared client and qualified Linux tarballs, checks version/init/check, and verifies the installed binary against the receipt. Registry installation belongs after publication.
- Mac was on battery before native entry. The unchanged power gate waited; native ran only after AC returned, with lid open and >45 GiB free. No native environment-invalid receipt was produced. The warm chain also waited for load to fall before pre-Darwin.
- Source work is confined to the assigned checkout. Linux uses an owned clone under the designated 0453 area. No stash, reset-hard, cargo clean, target deletion, primary-checkout edit, or publication command was used.

## Raw step receipts and final state

Every completed wrapper step, including the retained Linux red and failed recovery diagnostic, is indexed with its exact command, timestamps, raw exit, duration, and absolute receipt path in `kit/step-evidence-final.json`. Raw exits are shown below; the failed Linux attempt was superseded by a complete green attempt 2, not reclassified as passed.

| Host / receipt | Raw exit | Seconds |
|---|---:|---:|
| Linux / `attempt-1-linux-source-install.json` | 0 | 1.062 |
| Linux / `attempt-1-linux-source-build.json` | 0 | 48.925 |
| Mac / `attempt-1-bun-install.json` | 0 | 0.2 |
| Mac / `attempt-1-xcframework-build.json` | 0 | 147.193 |
| Mac / `attempt-1-native-prepare.json` | 0 | 0.544 |
| Mac / `attempt-1-cargo-build.json` | 0 | 10.361 |
| Mac / `attempt-1-wasm-build.json` | 0 | 23.527 |
| Mac / `attempt-1-client-package-build.json` | 0 | 3.275 |
| Mac / `attempt-1-simulator-boot.json` | 0 | 0.911 |
| Mac / `attempt-1-simulator-ready.json` | 0 | 4.101 |
| Mac / `attempt-1-chat-backend-check.json` | 0 | 8.239 |
| Mac / `attempt-1-expo-ios-regenerate.json` | 0 | 0.024 |
| Mac / `attempt-1-expo-release-build.json` | 0 | 77.84 |
| Mac / `attempt-1-root-hook-dependencies.json` | 0 | 0.281 |
| Mac / `attempt-1-simulator-uninstall.json` | 0 | 0.471 |
| Mac / `attempt-1-simulator-install.json` | 0 | 2.297 |
| Mac / `attempt-1-native-link-verification.json` | 0 | 0.344 |
| Mac / `attempt-1-native-witness.json` | 0 | 25.301 |
| Mac / `attempt-1-native-qualification-verification.json` | 0 | 0.139 |
| Mac / `attempt-1-simulator-shutdown.json` | 0 | 3.16 |
| Mac / `attempt-1-publication-prepare-client.json` | 0 | 30.095 |
| Mac / `attempt-1-lean-setup.json` | 0 | 0.357 |
| Mac / `attempt-1-test-warm.json` | 0 | 692.429 |
| Linux / `attempt-1-linux-early-install.json` | 0 | 0.066 |
| Linux / `attempt-1-linux-early-cli.json` | 0 | 0.237 |
| Linux / `attempt-1-linux-early-audit.json` | 0 | 25.935 |
| Linux / `attempt-1-linux-bun-install.json` | 0 | 0.02 |
| Linux / `attempt-1-linux-lean-setup.json` | 0 | 11.276 |
| Linux / `attempt-1-linux-qualify.json` | 1 | 3990.415 |
| Linux / `attempt-2-linux-wave21-environment-check.json` | 1 | 0.74 |
| Linux / `attempt-2-linux-wave21-diagnostic-pack.json` | 0 | 2.522 |
| Linux / `attempt-2-linux-wave21-environment-check-2.json` | 0 | 26.761 |
| Linux / `attempt-2-linux-early-install.json` | 0 | 0.021 |
| Linux / `attempt-2-linux-early-cli.json` | 0 | 14.984 |
| Linux / `attempt-2-linux-early-audit.json` | 0 | 25.023 |
| Linux / `attempt-2-linux-bun-install.json` | 0 | 0.02 |
| Linux / `attempt-2-linux-lean-setup.json` | 0 | 0.144 |
| Linux / `attempt-2-linux-qualify.json` | 0 | 5286.178 |
| Linux / `attempt-2-linux-clean-install.json` | 0 | 3.329 |
| Mac / `attempt-1-publication-dry-run.json` | 0 | 11327.394 |

The non-wrapper gates also passed: affected selector exit 0 (32 effective passes, including the explicitly described existing Lean classification); post-native and Expo equality checks exit 0; all fresh audit wrappers exit 0; pre-Darwin exit 0; Linux assembly and records transfer exit 0; final handoff verification exit 0. `native-1.exit`, `prepare-1.exit`, `lean-1.exit`, `warm-1.exit`, and `dry-run-1.exit` are all `done`. Linux attempt-2 wrapper exits are both `0`. Exact raw logs remain at the locations above.

The checkout remains detached at the frozen SHA. Its only tracked modification is `snapback4/metrics/publish.jsonl`, containing exactly one appended, verified dry-run metric; it is deliberately preserved for the records commit. The native witness rows were preserved before source-clean qualification as `/Users/ccheever/sb4-pub-0453/witness.jsonl.native-0453.diff` and must accompany the later records commit. No later main commits were included.

## Supervisor handoff — not executed

The requested lane work is complete. The publish step remains:

```bash
ATTEMPT=1 bash ~/sb4-pub-0453/finish.sh
```

`finish.sh` has the same supported Wave21 fixture override as qualification, and its reviewed one-line adjustment passes `bash -n`. It has not been executed. The durable stage, prepared pair, imported Linux receipt, native evidence, failed-attempt archives, and exact frozen source are retained.

The copied `start-finish-guarded.sh` additionally expects both-host staged foreground SSH smokes, fresh final audits, `linux-prefinish-green.json`, and an npm identity check. Those post-dry prefinish checks were not run by this lane because the requested stopping point is the green dry run; do not infer they passed from this report. The supervisor owns those checks if using the equivalent guarded 0.4.52 finish path, publication, post-publication registry/byte/foreground-SSH verification, and the records commit. The records commit should include the preserved native rows, the dry and eventual publication metric rows, reports, kit/evidence snapshots, and the retained Linux failure/recovery lineage; tarballs, dependency caches and videos stay outside Git.

No deterministic qualification failure remains. The explicit source-suite skip and the effective Lean classification above remain limitations of the recorded evidence, not newly waived failures. No package upload or registry installation proof was attempted by this lane.
