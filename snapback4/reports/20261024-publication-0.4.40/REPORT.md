# Publication: snapback4 0.4.40 (2026-10-24)

`snapback4`, `snapback4-darwin-arm64`, `snapback4-linux-x64` and `snapback4-expo` are
published at **0.4.40** from `0cb3de79eefbdf79e12fe375cd919be29e999c6b`, Integration 24's
final commit (SEC8 + SEC9 + DX7 + DX8 plus the wave-26 precision fixes). All four `latest` = 0.4.40.

`0cb3de79ee` was pinned. Later commits on `origin/main` (including SEC10/DX9 work) were ignored.

## Publish gate

The wave-26 analysis named the blockers: the 3 false refusals and the gate label. Integration 24
fixed them, and its 600-project survey has zero false gates or refusals. The coordinator's go applied
in advance to a clean pass: Linux qualification, the Mac native/Expo witness, and a watched Mac dry run.

## Registry

| Package | Bytes | Registry integrity |
|---|---:|---|
| `snapback4` | 1,344,210 | `sha512-tquriGGWNHyh4p4owDIBkL734N+yEK65NriOQFkQBftaUuHkAOE1up+FC5QjduU2TUK2oNaZw7AfnOO312Gh2g==` |
| `snapback4-darwin-arm64` | 14,713,468 | `sha512-cv0EGQg2B1OzeEjMu7p0CyucBsKEfsyiNiiorIOVO+9p/r/RonUX6w2gTcZBs6m+8+p7NZRJcgUZc0YFEerlXQ==` |
| `snapback4-linux-x64` | 16,700,204 | `sha512-/8OEHYHh6eUqAl32RRCu51qSh5rFy9tpF+6EMou8V9ve80XIyK8AwS1N10lBCzKiHqufYPFP5muVEpPZGmaZPw==` |
| `snapback4-expo` | 7,597,189 | `sha512-RCeebjn+zAuhRd5zR0zKmfT61B7K0poq9KuxShtI/UvbVOxuQ7PhkbhMmFgmr+rX2fntSsjWB2luTPa9ALUMgg==` |

These hashes were checked four ways:

- The registry metadata and the downloaded tarballs equal the staged bytes
  (`registry-cli-verified.json`, `registry-expo-verified.json`).
- Each tarball was downloaded again on Linux with `npm pack --prefer-online` and a private cache.
  The client, Expo and Linux tarballs equal the qualified bytes (sha256 `6b45a3b4…`, `d0fff0c2…`,
  `2d918dda…`). The Darwin tarball equals the Mac stage (sha256 `fe4744bc…`).
- The client and Expo bytes are the ones the Mac prepared after native attempt 1, and the ones
  Linux attempt 2 qualified (`receipt.json` `clientIntegrity` and `expo.integrity`). The Linux
  tarball is the qualified one.
- The Expo bytes equal the native-qualified package files (27/27).

Clean installs on Linux and on the Mac print `snapback4 0.4.40`, and `init` and `check` both exit 0.
The exit codes are captured directly now (the 0.4.39 kit printed `tail`'s).
- The installed Linux binary is the qualified one (SHA-256 `62ea5ae4…`). Integration 24's report
  records no production musl SHA-256 to compare against.
- The installed Darwin binary carries Team ID `UD2ZVW5WU5`.

## Binaries and toolchain provenance (all on the black M5)

- **Darwin production binary:** 30,689,456 B, SHA-256
  `18722ab5dc3f14fd1d82fe77733fd017ada14788837965e9df6f5f19903b3d5e` (as installed).
  - Signed with Developer ID `UD2ZVW5WU5` through the codesign relay; not notarized.
  - Built in dry run 1 with `/Applications/Xcode.app`, **Xcode 27.1** (27A9275).
- **Linux static musl binary:** SHA-256
  `62ea5ae4b520c06bca3ee37e676e8bc46ba3c5c42607df2ec62ab5eea7c8eae6`.
- **Expo native archives** (packed in `snapback4-expo`):
  - ios-arm64: `b2cf016360d0f93b9e6907a6b05e00a13d421b161279b304102755a435a4f096`.
  - simulator: `43118173a4d9106acfc6d5a7f5e61e26ec8c4f5f332ab01f38f299b716937e0e`.
  - Built by **Xcode 27.1** in native attempt 1.
- **Expo witness app:** the Release chat-expo app (Expo 57.0.30, expo-modules-core 57.0.23,
  RN 0.86.3; iOS project regenerated), built by **Xcode 27.1**.
  - The `~/Applications/Xcode-27.0.app` fallback was not used.
  - `../20261024-expo-0.4.40/qualified.json` → `toolchainProvenance` records this.

## Qualification at 0cb3de79ee

Lean was required for every run. The kit is the 0.4.39 kit with version renames (`kit/`, `linux/`).
Publish tooling changes since 0.4.39: `qualify-linux.mjs` adds the DX7 and DX8 consumer proofs
(`dx7-proof.json`, `dx8-proof.json`; `dx8Proof` is in the receipt). `snapback4-expo` and `bun.lock`
differ only in version. `publish.mjs`, `test.sh`, `run-client-tests.mjs` and `build-xcframework.sh`
are unchanged.

- **Mac offline before the start:** the black M5 was off Tailscale from about 12:21Z to 15:46:01Z, so
  nothing could start until then.
- **Native, attempt 1** (new watched pre-gate `kit/chain-gate-a1.sh`: AC power, lid open, post-wake
  load under 60, then 60 s AC/lid/pmset-sleep polls during the chain; no environment-invalid mark): 546 s.
  - xcframework 228.7 s, cargo build 57.4 s, wasm 65.7 s, Release app 107.2 s.
  - Witness 38.3 s (offline 13.1 s, restart 20.2 s).
  - The Mac's load was 300–630 from other sessions during the chain.
  - The prepared Expo files equal the native-qualified files (27/27).
- **Linux, attempt 1:** red in the client pool and killed after the suite.
  - Suite: `== 1 failure(s) in 3247 s`. cargo test ok (1,007 s); models ok (376 s).
  - Client tests, 1,656 s: 430/430 files, 1 failed file, 7,926 tests / 7,867 pass / 3 fail
    (1 assertion plus 2 parent records) / 56 skip.
  - `social-quote-jump-browser.test.mjs`, online, "absent original says unavailable and cannot move
    the list" (line 315): the history `scrollTop` was 16 instead of 0 after the unavailable text
    was clicked. This is the layout-sensitive class of the open ticket
    `issues/20261013-snapback4-quote-jump-visible-position-flake.md`. Linux load was 40–140.
  - Evidence: `linux/attempt-1-suite.log.gz`, `linux/attempt-1-linux-qualify.log.gz`, `linux/disk-a1.log`.
- **Isolation** (`linux/iso-quote.sh`, `linux/isolated/l1/`): the file alone through the suite
  runner, 6/6 pass (46–48 s, 38/38 each, load 54–69). The tree stayed clean. The flake rule applied,
  and nothing was skipped.
- **Linux, attempt 2** (`linux/`): qualify 6,258.7 s.
  - Suite: `== 0 failure(s) in 3510 s`.
    - cargo test 1,152 s.
    - client tests 1,864 s: 430/430 files, 7,926 tests / 7,870 pass / 0 fail / 56 skip.
    - models 343 s.
  - Proofs, all passed: starter, frontend and production, day-2/4/5, dx4, dx5, dx6, dx7, dx8, release
    transitions, dormant, migrations, proof kit, security, staging, client and rule recipes,
    Expo upgrades.
  - It used a private, fresh `NPM_CONFIG_CACHE`.
- **Linux disk:** free space was 39 GB before attempt 1. 14 GB was freed inside this lane's own
  publish dirs only: the proof-project scratch and npm caches of the 0.4.38 and 0.4.39 Linux records
  (both committed on main), and the clean, already-pushed records worktrees for 0.4.35, 0.4.37 and
  0.4.38. During the runs free space swung between 18 and 65 GB on the shared disk.
- **Mac dry run:** default `/var/folders` TMPDIR, `ulimit -n 65536`, serial client files, 0.2.33
  fences, `caffeinate -ims`. It started at 2 Rust test processes, per the 0.4.39 lesson.

| Attempt | Rust test processes | Result | Note |
|---|---:|---|---|
| 1 | 2 | **passed**, `== 0 failure(s) in 12539 s` (step 13,321 s; gate 13,350 s) | cargo test 4,326 s (`security_wave19` passed); models 247 s; packed staging passed; Mac load 8–20 |

- **Publish (`finish.sh`):**
  - `--resume` took 546.8 s and published darwin-arm64, then linux-x64, then the client.
  - The registry check passed at once (2.0 s).
  - Expo was packed, verified against the proof bytes, and published in 2.6 s. It was readable
    after 108.3 s and verified.
- After the dry run the only tree change was `metrics/publish.jsonl`, as expected; `--resume`
  accepts it.

## Kit changes

- `kit/setup-mac-0440.sh` builds the Mac kit from 0.4.39. Its publish-still-running check refuses
  only when a gate or `publish.mjs` process has its cwd in a publish kit or the publish worktree,
  so other sessions' runs on the shared M5 don't block it.
- `kit/clean-install.sh` captures `init`'s and `check`'s own exit codes.
- `kit/chain-gate-a1.sh` is new: a watched gate for the native chain, matching the dry-run gate.
- `linux/wait-mac.sh` and `linux/macpoll.sh` are new: they wait for the Mac to come back and poll it.
- `linux/assemble-records.sh` handles a qualified Linux attempt 2, keeps the red attempt 1, and
  copies the Linux isolation runs.

## Timeline (UTC)

| Step | Time |
|---|---|
| Brief; Linux setup | 10-24 12:50–12:53 |
| Mac offline | ~12:21–15:46:01 |
| Mac setup | 15:46–15:47 |
| Native 1 + prepare 1 (Mac) | 15:49:33–15:59:26 |
| Lean 1 + warm 1 (Mac) | 15:59:27–16:29:28 |
| Linux 1 (red; killed after the suite) | 16:01:28–~17:00 |
| Linux isolation (6/6) | ~17:00–17:04 |
| Linux 2 (pass) | 17:05:08–18:50:13 |
| Mac dry run 1 (pass) | 18:51:05–22:33:35 |
| Resume, registry, Expo verified | 22:38:05–22:49:04 |

That is about 7.0 h from native attempt 1 to verified publish. The Linux attempt-1 red cost about
1.1 h. The Mac being offline delayed the start by about 3 h.

## Records

- Device logs and dry-run logs are gzipped.
- `kit/` holds:
  - the Mac scripts, including `setup-mac-0440.sh` and `chain-gate-a1.sh`;
  - the gate log, the chain log and exit markers.
- `linux/` holds the receipt, proofs, suite logs for both attempts, disk logs, the isolation runs and
  the Linux kit.
