# Snapback 4 0.4.1 publication — stopped

**Not published.** The only `publish.mjs --dry-run` attempt exited 1 after
1,360.462 seconds. Its suite reported `== 1 failure(s) in 1360 s` (client
tests). The unchanged publisher refused before production build, signing,
packing, installed-consumer proof, or durable staging. `--resume`, Expo pack,
Expo publication, registry verification and branch push were not attempted.
No test, byte pin, budget, keychain setting or credential was changed.

## Source and environment

Requested base: `6540600116efa5ff3993a60082de2edb2f32663f`.
Local version commit: `8e35a19f0e370cc3dd063da288d5750820b18c40`.
Branch: `sb4-intent/publish-041`, worktree `~/projects/snapback-pub-041`.
Exactly the same six version-bearing files as the 0.4.0 lane were updated:
Cargo workspace and lockfile, Bun lockfile, CLI, platform and Expo package
manifests, including the optional platform dependency. Private demo application
versions retain their existing identities, as in 0.4.0.

Apple M5 Max, macOS 26.6.2, Xcode 27.0 (27A266a), Node 24.18.0,
Bun 1.4.2 and Rust 1.97.0. Both frozen installs passed. npm identity was
`ccheever`; the existing Developer ID Application identity was present.
The unchanged launchd codesign relay was selected, but the red suite prevented
any signing call. [Source/toolchain record](./source.json) and
[execution inputs](./execution.json) include its SHA-256 and enabled
`SNAPBACK4_FENCE_PUBLISHED` cache. The publisher applied its unchanged
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` policy.

## Exact blockers

1. `app-local-receipts.test.mjs:15:3`, native known-sent receipt with
   `close=true`: **`Error: setTypeOfService EINVAL`**, raised at
   `Socket.setTypeOfService (node:net:684:13)` through Node's Undici HTTP
   writer. This is the observed error, not an assertion that returned pending.
   No isolated rerun or environmental/baseline attribution is claimed.
2. `schema-capabilities.test.mjs:206:10`, published-0.2.33 fences for
   **timeline-v2**, **recorded-attribution**, and **maintained-column**:
   **`current adoption refusal preserves the old store`** failed. Each actual
   logical snapshot adds the empty `_cap_counts` table and the
   `_meta.cap_counts_schema` marker. No pre-existing table rows changed in
   these captured comparisons. The three exact marker values and stacks are
   in [failure-summary.json](./failure-summary.json).
3. `schema-capabilities.test.mjs:330:10`, published-0.2.33 capability-free
   control: **`byte-for-byte canonical capability-free 0.4 backend`** failed.
   Actual canonical bytes are **2,942**; the expected pin is **2,950**. The
   rendered byte diff shows four removed `[]` pairs. The pin was not altered.

Complete errors, including actual/expected store snapshots:
[failure-details.log](./failure-details.log). Entire attempt:
[publication-dry-run.log](./publication-dry-run.log).
There was one full dry-run attempt, with no retry, isolated test rerun or fix.
The already-running report-all-failures suite finished after the first failure
was observed; no later release step ran.

## Qualification results

- Full clients: **1,512 tests; 1,502 passed; 5 failed; 0 cancelled; 5 skipped**,
  1,287.180 seconds. Existing suite skips/ignores were unchanged; all four
  published-0.2.33 checks were enabled and executed.
- Rust: **2,964 passed; 0 failed; 16 ignored**, 885 result summaries,
  including workspace doctests; 171 binaries and 879 executions in the
  runner inventory. Cargo test step: 679 seconds.
- Fixture wrapper: **9 passed, 0 failed**, 7.190 seconds.
- Workspace/WASM builds, docs budget, release guard, package build/typecheck,
  chat backend check, web app typecheck and Expo app typecheck passed.
- WASM: **1,766,024 B raw / 491,468 B gzip**, under the inherited **492,000 B**
  budget. README: **300/300** lines.

## Native qualification — passed

Both native slices rebuilt in **91.668 s**. Release chat-expo built in
**92.698 s**, with zero errors and three warnings. CocoaPods installed
Snapback4Expo 0.4.1 after the framework existed. The linked simulator archive
matches the rebuilt framework; the installed executable and JS bundle match
this Release build.

Dedicated iPhone 17 Pro, iOS 26.5 simulator:
`9A88E5C4-9F5B-4FE5-B8D0-F2199FE6E63B`, port 44441. The public CLI witness
verb/helper was driven by this worktree's fresh debug CLI, matching the 0.4.0
lane; it was not a registry CLI. The simulator was shut down after the proof.

- Offline `--prime`: **8.578 s**, passed.
- Restart `--prime --relaunch`: **12.117 s**, passed.
- Every artifact listed in both manifests was checked against its size and
  SHA-256. No native build or witness retry occurred.

Source tree digests:
- `snapback4-core`: `dc8a6a73e430a2a717b507358f137b53bf1efac3`.
- `snapback4-device`: `6de0beef815e943bfc1a4899aea4781fea3c7335`.

Native archive SHA-256:
- iOS arm64: `b62074ec881a6546f34ae14782d3f8741244d32f3205053198d09bb9ea13d5be`.
- iOS simulator: `b607a5b5834dce605e750beac22bd445ee033dcd2446b188f7f5f1c1f3e7557a`.

Installed app executable SHA-256:
`1d50683bf3615beb8e33a26d57060bdcdc58793200d29fab1e711b7819edfc57`.
Witness CLI SHA-256, captured before the publisher rebuilt its test binary:
`d214293cb01822e9b3db3761dd922d918b9dd370ba90391ee576e4d55783db7d`.
All framework file hashes and native evidence:
[qualified.json](../20260924-expo-0.4.1/qualified.json).
This evidence covers the dedicated iOS simulator, not Android or a physical device.
There is no production-binary digest, staged integrity or registry integrity
for this attempt because publication stopped before producing those artifacts.

## Every timed attempt

| Attempt | Seconds | Exit | Evidence |
|---|---:|---:|---|
| bun-install | 0.790 | 0 | [command/timing](./bun-install.json), [log](./bun-install.log) |
| version-bump | 0.055 | 0 | [command/timing](./version-bump.json), [log](./version-bump.log) |
| bun-install-after-bump | 0.085 | 0 | [command/timing](./bun-install-after-bump.json), [log](./bun-install-after-bump.log) |
| version-commit | 0.084 | 0 | [command/timing](./version-commit.json), [log](./version-commit.log) |
| xcframework-build | 91.668 | 0 | [command/timing](./xcframework-build.json), [log](./xcframework-build.log) |
| npm-identity | 0.506 | 0 | [command/timing](./npm-identity.json), [log](./npm-identity.log) |
| cargo-build | 19.979 | 0 | [command/timing](./cargo-build.json), [log](./cargo-build.log) |
| simulator-create | 0.241 | 0 | [command/timing](./simulator-create.json), [log](./simulator-create.log) |
| simulator-boot | 0.495 | 0 | [command/timing](./simulator-boot.json), [log](./simulator-boot.log) |
| simulator-ready | 35.101 | 0 | [command/timing](./simulator-ready.json), [log](./simulator-ready.log) |
| wasm-build | 49.846 | 0 | [command/timing](./wasm-build.json), [log](./wasm-build.log) |
| chat-backend-check | 5.162 | 0 | [command/timing](./chat-backend-check.json), [log](./chat-backend-check.log) |
| client-package-build | 2.476 | 0 | [command/timing](./client-package-build.json), [log](./client-package-build.log) |
| expo-release-build | 92.698 | 0 | [command/timing](./expo-release-build.json), [log](./expo-release-build.log) |
| simulator-install | 3.985 | 0 | [command/timing](./simulator-install.json), [log](./simulator-install.log) |
| native-link-verification | 0.321 | 0 | [command/timing](./native-link-verification.json), [log](./native-link-verification.log) |
| native-witness | 23.565 | 0 | [command/timing](./native-witness.json), [log](./native-witness.log) |
| native-qualification-verification | 0.070 | 0 | [command/timing](./native-qualification-verification.json), [log](./native-qualification-verification.log) |
| simulator-shutdown | 3.257 | 0 | [command/timing](./simulator-shutdown.json), [log](./simulator-shutdown.log) |
| publication-dry-run | 1360.462 | 1 | [command/timing](./publication-dry-run.json), [log](./publication-dry-run.log) |

## Preparation diagnostics

Fetch, worktree creation at the requested base and branch creation succeeded.
Three read-only preparation probes needed correction: local `main` lacked the
0.4.0 report (exit 128; the fetched `origin/main` supplied it); an optional
`.cargo/config.toml` read found no such file; a shell glob for fence filenames
matched nothing (a content search located `schema-capabilities.test.mjs`).
An early build-log search also returned no matching lines before compilation
reached that target. None of these probes ran or failed a build/test. They are
recorded separately from the five qualification failures above.

## Governing context and handoff

Scope: version alignment, native artifacts and publication tooling only.
`LLP 3000#4-fence-numbering-routing` governs the independent Snapback 4 fence;
`LLP 3000#7-decisions-during-execution` governs packaged SQLite inputs and
native iOS minimums. LLP 3000 is in `llp/current/`; publication code and the
native build's existing references were read. The installed public witness
card and 0.4.0 report/journal supplied the execution path. No new design
choice or LLP change was needed. Hand-off: none to an LLP skill; the
supervisor owns disposition of these five failures.

The version commit remains local. Reports, witness metrics and the appended
failure journal are retained in the worktree, uncommitted. No push was made.
