# Integration 17 — Mac Studio verification

Required host: `ccheever@macstudio-charlie-apt101-a`; dedicated scratch only: `~/sb4-ws-integ17`. Xcode 27.0, pinned Node v24.13.1, Bun 1.4.2. No publication worktree, `target/publication/`, black M5, signing or publication operation was used. All commands had bounded outer execution; child processes have explicit Python timeouts. Every Cargo process inherited `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`.

Final source binding is `fc7a63ea0f`: all **3,531** transferred tracked source and include-fixture files match their Git blob hashes exactly (`evidence/final-source-binding.json`). The initial snapshot was `999598649f`; overlays are recorded under `evidence/source-overlays.json`. The final test snapshot before the sole deploy-card prose overlay was `d9b90af4fb`. Source manifests and exact execution scripts are in `scripts/` inside the archive.

## Results and custody

| Scope | Result | Input custody |
|---|---|---|
| Core unit | 371 passed, 3 ignored | Earlier `c588ed5f0c` pass retained; no core source delta through final `fc` |
| Device unit and `readauth` | 64 + 88 passed | Earlier `c588ed5f0c` pass retained; no device source delta through final `fc` |
| Lang unit/front/security/custody/histories/observers/wave16 | 35 + 5 + 16 + 1 + 3 + 12 + 2 passed | Final `d9` snapshot; final prose-only deploy fix does not alter these inputs |
| Guide | 126 passed | Rerun after final `fc` deploy prose fix; replaces earlier guide reds |
| Sim unit and `clique` | 17 + 254 passed, 1 ignored | Final `d9`; repaired missing read-only benchmark include fixtures before this green rerun |
| CLI unit/check/check_notes/cli_friction/init/lifecycle/run_admission | 480 + 105 + 14 + 40 + 51 + 29 + 28 passed, 5 ignored | Final `d9`; includes failed-security-check note acknowledgement regression; `fc` rebuilt CLI with final guide |
| Final client pool | 55/55 files, 904 passed, 8 skipped | Single final `d9` pool; zero failures/cancellations |
| Four timing client files | 162 passed, 6 skipped | Earlier same-input passes retained: export-background, maintenance-evidence, test-file-runner, test-signals; explicit rationale in `evidence/final/reused-timers.json` |
| Extra platform files | 2/2 files, 31 passed | `init-typecheck`, `export-maintenance-wakeup`; final scope inputs |
| Docs budget | Passed | Final `fc` snapshot |
| Installed Darwin packs | proof-kit, staging, security all passed | Fresh client npm pack and fresh final CLI Darwin debug pack, installed consumers only |
| Native | Fresh XCFramework, Release Expo app, offline and restart witnesses all passed | Final `fc` CLI and unchanged merged device sources; dedicated iOS 27.0 simulator |

The client union is **61 files, 1,111 tests: 1,097 passed, 14 normal skips, no failures/cancellations**. It includes every client test file containing Darwin/platform guards, plus the integration-touched client files. Earlier failed attempts remain verbatim in the archive; their fixes and successful superseding results are explicit above. In particular, missing benchmark includes were a scratch-copy precondition, and earlier guide/registry/fixture reds were rerun after the integration fixes. No red is treated as green.

## Native commands and outcomes

After final `fc` overlay:

```sh
cargo build -p snapback4
cargo test -p snapback4-lang --test guide --no-fail-fast
node scripts/docs-budget.mjs
bash scripts/build-xcframework.sh
target/debug/snapback4 check  # cwd apps/chat
bun x expo run:ios --configuration Release --device D30B59A4-4BDF-42B4-8D6E-0726A5EC0DF6 --no-bundler --no-build-cache  # cwd apps/chat-expo
WITNESS_UDID=D30B59A4-4BDF-42B4-8D6E-0726A5EC0DF6 WITNESS_PORT=26933 WITNESS_ARTIFACTS=<scratch>/evidence/native/witness node witness/expo.mjs
```

The scripts supply the Cargo environment above, `CI=1`, `EXPO_NO_TELEMETRY=1`, and `EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:26933`. They create and boot the dedicated simulator, assert the built Release `main.jsbundle` contains that URL, and shut down that simulator afterward. `evidence/native/bundle.json` binds the Release bundle SHA-256. Both installed-app scenarios returned `exitStatus: 0`: backend refusal while offline, pending mutation, reconnection, and offline relaunch in the restart segment. The witness receipts identify preparation as unknown because that CLI does not attest preparation; the separately captured fresh XCFramework/build/install commands and bundle hash establish this run's preparation. Expo Release build had zero errors and four ordinary build warnings. See `evidence/native/results.json` and the complete native command stdout logs.

`witness/expo.mjs` appends two success records to tracked `metrics/witness.jsonl`. Those generated records were captured separately and the unchanged source fixture restored before final source-hash comparison; see `evidence/native/generated-output-note.json`. The actual receipts and logs remain captured.

## Packed checks

`scripts/integ17-mac-packed.py` invokes `npm pack --ignore-scripts --json` on the client and a scratch Darwin-arm64 package containing the final debug CLI, then invokes `proveProofKit`, `proveStaging`, and `proveSecurity` from their actual checked-out publication helpers. All three pass. Proof-kit runs the literal installed day-two recipe and clock/reset controls. Staging proves real users/data, first admin and production refusal. Security executes the installed security card, audit/check paths, broad-read refutation, real guest/password refresh/logout revocations, all six starters and the production recipe; counter/verdict receipts include honest deployed-artifact HTTP coverage gaps. Artifact/binary SHA-256 values are in `evidence/packed/artifacts.json`. These unsigned debug packs are scratch verification only and create **no signing/publication receipt**.

## Archive

`mac-evidence.tar.gz` is the strict allowlist archive. SHA-256: `d8d1249d5290b04b40b02290f4d7ed3d68c66202be3bccbc7ec338232c73731d`; size **378,423 bytes**, 86 UTF-8 files, approximately 2.31 MB uncompressed. `evidence/archive-manifest.json` records each retained file's size and SHA-256. It contains command/test logs, JSON/JSONL receipts/source manifests and execution scripts only; no SDK/framework/app/node_modules/wasm/native binary, generated app working directory, SQLite store, runtime credentials, video or broad simulator system stream. Excluded native video/system-log hashes and dedicated scratch paths are recorded in `evidence/excluded-native-artifacts.json`. Full command stdout and scenario receipts are retained. The broad initial scratch archive is not the repository artifact.
