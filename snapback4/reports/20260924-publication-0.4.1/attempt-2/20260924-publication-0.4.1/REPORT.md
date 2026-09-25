# Snapback 4 0.4.1 publication — second attempt stopped

**Not published.** The resumed attempt's only `publish.mjs --dry-run` exited 1
in **1,515.094 seconds**, with `== 1 failure(s) in 1515 s` (client tests).
The unchanged publisher refused before production CLI build, signing, packing,
installed-consumer proof or durable staging. `--resume`, Expo pack/publication,
registry verification and branch push were not attempted.

## Exact blockers

Both cases are declared at `packages/snapback4/test/app-session-model.test.mjs:5:41`:

1. **Online session model, 5,000 seeded three-runtime sequences:**
   `test timed out after 240000ms`, observed duration **240,009.072 ms**.
   The client summary records one cancellation.
2. **Local session model, 5,000 seeded three-runtime sequences:**
   `AssertionError [ERR_ASSERTION]: tier=local seed=11: model fair recovery did not finish within 100 clock steps`.
   Duration **12,350.402 ms**, assertion at `app-session-model.test.mjs:12:14`.
   The runner's complete reported minimal sequence is preserved in
   [local-seed-11-sequence.json](./local-seed-11-sequence.json).

[Exact errors and stack](./failure-details.log),
[machine-readable summary](./failure-summary.json),
[complete dry-run log](./publication-dry-run.log),
[command and timing](./publication-dry-run.json).

No isolated rerun, retry, fix, changed timeout, reduced sequence count or waived
assertion followed. The already-running report-all-failures suite finished after
the two failures were observed. Cold Rust test compilation overlapped the client
run; that is an execution observation, **not an established cause or an
environmental/baseline waiver**. The root cause of these failures was not determined.

## Source, version alignment and preserved history

Requested base: `0af449bb757b5a89f4df24a88f60cba681bf8b7d`.
Version commit: `e1d7a6fb56828344c206dae229f4f8ec69126170`.
Worktree: `~/projects/snapback-pub-041b`, branch `sb4-intent/publish-041`.

The first preparation command tried the old version diff and failed because its
manifest context predates the new Undici dependency. The user authorized
continuation by editing the six version-bearing files. Exactly 15 version fields
changed: Cargo workspace and lockfile, Bun lockfile, CLI/platform/Expo manifests,
and the optional platform dependency. **Undici remains pinned at 8.8.0.**
`bun install --frozen-lockfile` passed in **0.224 s**, reporting no changes;
lockfile diffs contain only the version edits. The version bump was committed.
Private demo versions retain their identities, as in the first attempt.

The preparation-stop report is preserved unchanged as
[PREPARATION-STOP.md](./PREPARATION-STOP.md), along with its failed
[patch command](./version-bump.json) and [patch](./version-bump.patch).
The old source snapshot is [preparation-source.json](./preparation-source.json).
The first publication attempt remains byte-for-byte under [attempt-1/](./attempt-1/),
with its journal entry copied unchanged to this branch and
[attempt-1-journal.md](./attempt-1-journal.md). Its native evidence is preserved
under [20260924-expo-0.4.1/](./20260924-expo-0.4.1/) inside this report directory.
[Preservation hashes](./preservation.json) bind the copies. The old local branch
was renamed to `sb4-intent/publish-041-attempt-1` without changing its commit or
worktree contents. The primary checkout's unrelated dirty files were untouched.

## Qualification results

- Clients: **1,591 tests; 1,584 passed; 1 failed; 1 cancelled; 5 inherited skips**,
  **1,433.543 s**. No skip was added or enabled by this lane.
- All four requested published-0.2.33 checks **passed**: timeline-v2,
  recorded-attribution, maintained-column and capability-free compatibility.
  The published package integrities were verified by those checks.
- Rust: **2,976 passed; 0 failed; 16 inherited ignores**, including doctests;
  172 test binaries, 882 executions and 887 result summaries. Cargo test step:
  **1,059 s**. [Rust summary](./rust-summary.json).
- Fixture wrapper: **9 passed, 0 failed**, **8.058 s**.
- Workspace/WASM builds, documentation budget, release guard, package build and
  typecheck, chat backend check and web/Expo app typechecks passed.
- WASM: **1,767,852 B raw / 492,086 B gzip**, below this pinned checkout's existing
  **493,000 B** budget. README: **300/300** lines. No budget changed in this lane.

Node **24.18.0**, Bun **1.4.2**, Rust **1.97.0**, Xcode **27.0 (27A266a)**,
macOS **26.6.2**, Apple **M5 Max**. npm identity: `ccheever`.
The unchanged launchd codesign relay and Developer ID identity were present.
The red suite prevented production signing; no keychain setting or credential
changed. The publisher applied its unchanged
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` policy. The requested
`SNAPBACK4_FENCE_PUBLISHED` cache was enabled. Existing scheduling controls were
`SNAPBACK4_RUST_TEST_PROCESSES=4` and `SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1`;
assertions, deadlines and sequence counts were unchanged.
[Source/toolchain](./source.json), [execution inputs](./execution.json).

## Native qualification — passed

The xcframework rebuilt in **146.463 s** and Release chat-expo in **96.364 s**
(zero errors, three warnings). The linked simulator archive matches the rebuilt
framework. The installed executable and JavaScript bundle match the Release build.

Dedicated iPhone 17 Pro simulator, iOS 26.5:
`81961F7D-DF85-4A7A-B376-20D9073AC101`, port **44441**.
The same public CLI witness verb/helper used by 0.4.0 ran through this worktree's
fresh debug CLI; this was not a registry-installed CLI.

- Offline `--prime`: **8.925 s**, passed.
- Restart `--prime --relaunch`: **12.164 s**, passed.
- Every artifact in both manifests verified against its size and SHA-256.
- No native build or witness retry occurred; the simulator was shut down.

Source tree digests:
- `snapback4-core`: `db3a55d21ebfb5c5bbec2d7eea990a955df04857`.
- `snapback4-device`: `93e94614127fc677d534d5afa5f764b6b87852e3`.

Native archive SHA-256:
- iOS arm64: `f1b1ae8cfe7729feaae315ced8050eed3900e1906202bd5851b483abc0579c07`.
- iOS simulator: `aa44801e4fbb3520f8c1031d5cebaae8c793acf52f6b9333ab570928e1c20b4c`.

Installed app executable SHA-256:
`c1ed9246d65e2c1824b91f177e331ab62418528e23cef6da024827debe916234`.
Witness CLI SHA-256, captured before the publisher rebuilt its debug binary:
`c9ba678b89fa86c823b6465b53ee622c2b6deb699286370ca633867925eb445b`.

All framework, source, app and witness hashes are in
[qualified.json](../20260924-expo-0.4.1/qualified.json).
This evidence covers the dedicated iOS simulator, not a physical device or Android.
There is **no production CLI digest, staged integrity or registry integrity** for
this attempt because publication stopped before producing those artifacts.

## Every timed command in this second attempt

The first preparation failure and the authorized continuation are both included.
The manual version edit is recorded separately in [version-edit.json](./version-edit.json).
The first attempt's complete ledger is retained in [its report](./attempt-1/REPORT.md).

| Attempt | Seconds | Exit | Evidence |
|---|---:|---:|---|
| bun-install | 0.964 | 0 | [record](./bun-install.json), [log](./bun-install.log) |
| version-bump | 0.014 | 1 | [record](./version-bump.json), [log](./version-bump.log) |
| bun-install-after-edit | 0.224 | 0 | [record](./bun-install-after-edit.json), [log](./bun-install-after-edit.log) |
| version-commit | 0.113 | 0 | [record](./version-commit.json), [log](./version-commit.log) |
| xcframework-build | 146.463 | 0 | [record](./xcframework-build.json), [log](./xcframework-build.log) |
| npm-identity | 0.434 | 0 | [record](./npm-identity.json), [log](./npm-identity.log) |
| simulator-create | 0.233 | 0 | [record](./simulator-create.json), [log](./simulator-create.log) |
| simulator-boot | 0.673 | 0 | [record](./simulator-boot.json), [log](./simulator-boot.log) |
| simulator-ready | 42.468 | 0 | [record](./simulator-ready.json), [log](./simulator-ready.log) |
| cargo-build | 29.886 | 0 | [record](./cargo-build.json), [log](./cargo-build.log) |
| wasm-build | 34.922 | 0 | [record](./wasm-build.json), [log](./wasm-build.log) |
| chat-backend-check | 2.025 | 0 | [record](./chat-backend-check.json), [log](./chat-backend-check.log) |
| client-package-build | 1.941 | 0 | [record](./client-package-build.json), [log](./client-package-build.log) |
| expo-release-build | 96.364 | 0 | [record](./expo-release-build.json), [log](./expo-release-build.log) |
| simulator-install | 3.944 | 0 | [record](./simulator-install.json), [log](./simulator-install.log) |
| native-link-verification | 0.319 | 0 | [record](./native-link-verification.json), [log](./native-link-verification.log) |
| native-witness | 24.320 | 0 | [record](./native-witness.json), [log](./native-witness.log) |
| native-qualification-verification | 0.058 | 0 | [record](./native-qualification-verification.json), [log](./native-qualification-verification.log) |
| simulator-shutdown | 3.203 | 0 | [record](./simulator-shutdown.json), [log](./simulator-shutdown.log) |
| publication-dry-run | 1515.094 | 1 | [record](./publication-dry-run.json), [log](./publication-dry-run.log) |

## Handoff

The version commit remains local. Reports, witness metrics and appended journal
entries remain uncommitted for the supervisor. No push was made after the failed
qualification. No test or source implementation was altered. The earlier report's
read-only preparation diagnostics and governing-context record remain preserved
in [PREPARATION-STOP.md](./PREPARATION-STOP.md).
