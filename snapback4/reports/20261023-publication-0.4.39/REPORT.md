# Publication: snapback4 0.4.39 (2026-10-23/24)

`snapback4`, `snapback4-darwin-arm64`, `snapback4-linux-x64` and `snapback4-expo` are
published at **0.4.39** from `d4441c83b6efeda66996598805d4707b50143142`, Integration 23's
final commit. All four `latest` = 0.4.39.

When the brief was given, `d4441c83b6` was the `origin/main` tip. It was pinned; later commits
(Integration 24, working toward 0.4.40) were ignored.

## Publish gate

The wave-25 analysis named one publish blocker, the rollback-view trigger. Integration 23 fixed it:
false refusals fell from 10 to 0, and the six ROLL controls hide zero v1 rows. The coordinator's go
applied in advance to a clean pass: Linux qualification, native witness, and a watched Mac dry run.

## Registry

| Package | Bytes | Registry integrity |
|---|---:|---|
| `snapback4` | 1,335,550 | `sha512-BCF8jQILPT2Mo5wyp0IYQZXgiNkL9bx7tIItZfB1PbX8XvSuXCCiU5+l3sa7CO3j76KrAsdtUvOrdCiKNpdI1g==` |
| `snapback4-darwin-arm64` | 14,079,154 | `sha512-AChOXfH9cKbbUXxiSpBA75sAwB2R8ByOR2BxXtZHnRooYr5Fzdpe5g5fVjqsmHOuCQY3OdgoyeiGIhOq49MRvw==` |
| `snapback4-linux-x64` | 15,953,945 | `sha512-lOub7cro13RtA73zFnfeDTI5LgyHEqsvgoimYB8pHcgZRtsK+XzLRmJOwq0VwbVbmVGYPLz3con9kXGFDihx+A==` |
| `snapback4-expo` | 7,505,200 | `sha512-botqMhNbC4Krn/DglqVwIrvJ4196x8QiR1ychzJA19bBMEL520XcOoCxb2TpoRRZP5LNQ8Eg+PKDjuYwVk8OTA==` |

These hashes were checked four ways:

- The registry metadata and the downloaded tarballs equal the staged bytes
  (`registry-cli-verified.json`, `registry-expo-verified.json`).
- Each tarball was downloaded again on Linux with `npm pack --prefer-online` and a private cache.
  The client, Expo and Linux tarballs equal the qualified bytes (sha256 `ba3c48e7…`, `b8cd48e2…`,
  `b0c6a853…`). The Darwin tarball equals the Mac stage (sha256 `3d430854…`).
- The client and Expo bytes are the ones the Mac prepared after native attempt 1, and the ones
  Linux attempt 1 qualified. The Linux tarball is the qualified one.
- The Expo bytes equal the native-qualified package files (27/27).

Clean installs on Linux and on the Mac print `snapback4 0.4.39`, and `init` and `check` both exit 0.
- The installed Linux binary is the qualified one (SHA-256 `8aa998f6…`). That is also Integration
  23's recorded production native SHA-256.
- The installed Darwin binary carries Team ID `UD2ZVW5WU5`.

## Binaries and toolchain provenance (all on the black M5)

- **Darwin production binary:** 29,538,464 B, SHA-256
  `e8c2ba6a315b7d383ba93f551a17eb87d100768a4be4eb76719e882f12dc01e0` (as installed).
  - Signed with Developer ID `UD2ZVW5WU5` through the codesign relay; not notarized.
  - Built in dry run 3 with `/Applications/Xcode.app`, **Xcode 27.1** (27A9275).
- **Linux static musl binary:** SHA-256
  `8aa998f61e2a0402e276dc10e17830b2dbd0fe5dd754af367af3579b1420673c`.
- **Expo native archives** (packed in `snapback4-expo`):
  - ios-arm64: `33844ea02727c0b3cca4bdf024b18e0e3d9a9813220d205339356ad287912cba`.
  - simulator: `f6dcdb5058ebd58766cd231a07cc5e3d7a444206e2f22b992946a67e08048908`.
  - Built by **Xcode 27.1** in native attempt 1.
- **Expo witness app:** the Release chat-expo app (Expo 57.0.30, expo-modules-core 57.0.23,
  RN 0.86.3; iOS project regenerated), built by **Xcode 27.1**.
  - The `~/Applications/Xcode-27.0.app` fallback was not used.
  - `../20261023-expo-0.4.39/qualified.json` → `toolchainProvenance` records this.

## Qualification at d4441c83b6

Lean was required for every run. The kit is the 0.4.38 kit with version renames (`kit/`, `linux/`).
The publish tooling is unchanged since 0.4.38: `publish.mjs`, `qualify-linux.mjs`,
`build-xcframework.sh`, `witness/`, `test.sh` and `run-client-tests.mjs` are identical, and
`snapback4-expo` and `bun.lock` differ only in version. The Mac gate polls AC power, the lid and
pmset sleep every 60 s. No attempt was invalidated by the environment.

- **Native, attempt 1:** 320 s.
  - xcframework 131.3 s, cargo build 29.8 s, wasm 43.9 s, Release app 59.1 s.
  - Witness 28.3 s (offline 10.4 s, restart 13.8 s).
  - The prepared Expo files equal the native-qualified files (27/27).
- **Linux, attempt 1** (`linux/`): qualify 5,687.6 s.
  - Suite: `== 0 failure(s) in 3255 s`.
    - cargo test 1,059 s.
    - client tests 1,631 s: 429/429 files, 7,909 tests / 7,853 pass / 0 fail / 56 skip.
    - models 342 s.
  - Proofs, all passed: starter, frontend and production, day-2/4/5, dx4, dx5, dx6, release
    transitions, dormant, migrations, proof kit, security, staging, client and rule recipes,
    Expo upgrades.
  - It used a private, fresh `NPM_CONFIG_CACHE`. Free space during the run was 40–78 GB on the
    shared disk.
- **Mac dry runs:** default `/var/folders` TMPDIR, `ulimit -n 65536`, serial client files, 0.2.33
  fences, `caffeinate -ims`. Following the 0.4.38 lesson, they started at low parallelism.

| Attempt | Rust test processes | Result | Note |
|---|---:|---|---|
| 1 | 3 | red in cargo test (2,790 s); killed | `security_wave19` `check_refutes_excluded_contact_roles_before_any_full_test`: check at 1,706.5 ms against the 1,500 ms budget, "0 refuted, 2 unproved". This is the open ticket. |
| 2 | 2 | red in client tests, `== 1 failure(s) in 11845 s` | cargo test ok (3,045 s). `social-starter.test.mjs` test 9 failed in its after-hook: `rmSync` hit ENOTEMPTY while the dev server's worker wrote its ledger. |
| 3 | 2 | **passed**, `== 0 failure(s) in 10801 s` (step 11,358 s; gate 11,390 s) | cargo test 2,897 s; models 183 s; packed staging passed |

- **Isolation** (`kit/isolated/`, `kit/iso-dr1.sh`, `kit/iso-social.sh`):
  - The failing `security_wave19` test alone: 5/5 pass (3.2–4.1 s).
  - `security_wave19`, whole target: 3/3 pass (62–64 s).
  - `social-starter.test.mjs` alone through the suite runner: 6/6 pass (31–34 s, 17/17, no leftover
    dirs).
  - Both reds are timing-only, so the flake rule applied. Nothing was skipped and TMPDIR was
    untouched.
- **Mechanism of the dry-run-2 red:**
  - `starter(t)` registers directory removal before the test's server-kill hook.
  - node:test runs `t.after` hooks first-in, first-out and skips the rest after one throws.
  - So the dev server stayed alive, and the file took 932 s.
  - Recurrence note: `issues/20260929-snapback4-acquisition-cleanup-enotempty.md`.
- **Dry-run-1 red:** recorded under `issues/20261023-snapback4-security-wave19-check-budget-flake.md`.
  Lower parallelism (3) did not avoid it.
- **Publish (`finish.sh`):**
  - `--resume` took 561.5 s and published darwin-arm64, then linux-x64, then the client.
  - The registry check passed at once (2.1 s).
  - Expo was packed, verified against the proof bytes, and published in 2.8 s. It was readable
    after 139.1 s and verified.

## Kit fix: kill-dryrun.sh

The 0.4.38 `kill-dryrun.sh` matched `scripts/run-client-tests[.]mjs` on any command line. When dry
run 1 was to be killed, that pattern also matched Integration 24's client pool on the same Mac (cwd
`~/projects/snapback-integ24`). This was caught before the script ran.

The 0.4.39 `kit/kill-dryrun.sh` targets only two sets of processes:
- the gate scripts whose cwd is the kit, plus their descendants;
- processes whose cwd is inside the publish worktree.

It killed 11 processes, and Integration 24's pool was untouched.

## Timeline (UTC)

| Step | Time |
|---|---|
| Brief; setup on both hosts | 10-23 20:45–20:48 |
| Native 1 + prepare 1 (Mac) | 20:48:56–20:54:51 |
| Linux 1 (pass) | 20:55:52–22:31:11 |
| Mac dry runs 1 (red), 2 (red), 3 (pass) | 22:32 → 10-24 06:01:27 |
| Resume, registry, Expo verified | 06:02:15–06:14:03 |

That is about 9.4 h from native attempt 1 to verified publish. Dry runs 1 and 2 cost about 4.1 h.

## Records

- Device logs and dry-run logs are gzipped.
- `kit/` holds:
  - the Mac scripts, including `setup-mac-0439.sh`, the rewritten `kill-dryrun.sh`, and the
    isolation scripts;
  - the gate log and exit markers.
- `linux/` holds the receipt, proofs, suite log, disk log and the Linux kit.
- `attempt-1-publication-dry-run.log.gz` has no `.json`, because the attempt was killed before
  `pubstep.sh` wrote one.
