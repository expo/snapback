# Publication: snapback4 0.4.38 (2026-10-22/23)

`snapback4`, `snapback4-darwin-arm64`, `snapback4-linux-x64` and `snapback4-expo` are
published at **0.4.38** from `951ecdd4dfe3a42052d2227d6aec45146782816d`, Integration 22's
final commit. All four `latest` = 0.4.38.

The brief named the `origin/main` tip, `cadb7c55be`. It failed the suite on every run, on both
hosts. A coordinator ruling moved the publish commit back to `951ecdd4df`:

| Commit | Outcome |
|---|---|
| `cadb7c55be` | Linux suite `== 2 failure(s) in 3360 s`. 19 Rust tests in 6 targets fail, plus `residency.test.mjs` test 6. All of them fail with `E_SCHEMA: source reservations differ from the schema derivation`, except one, which fails with `add: execution facts changed without a program change`. Both messages come from `snapback4-core/src/engine/activation_facts.rs`. That file was added by `202826334f` (from another session) and merged by `c3f23ff2c2` after `951ecdd4df`. `snapback4 test --residency` refuses to open a store, so users are affected. The failure reproduces alone on Linux and on the Mac. **This is a defect on main from another session's commit. It is not in the published bytes.** |
| `951ecdd4df` | Integration 22's final, fully qualified commit. It carries 0.4.38, contains DX6 and SEC7, predates `c3f23ff2c2`, and is an ancestor of `origin/main`. Qualified and published here. |

## Publish gate

The wave-24 analysis said publish. It analysed the bakeoff on the local 0.4.38 pack, which was
built from Integration 22's branch: the same content as `951ecdd4df`. The coordinator's go applied
in advance to a clean pass: Linux qualification, native witness, and a watched Mac dry run.

## Registry

| Package | Bytes | Registry integrity |
|---|---:|---|
| `snapback4` | 1,333,964 | `sha512-h+TWEJPrSI88CFc2kSGfcu2EwHXsJ/VBFWM8Zw6MRk9Fx3ZhZjMdY1ZGfpjohOZvMwZq739b9Rw9XCaUaYQh9Q==` |
| `snapback4-darwin-arm64` | 12,741,122 | `sha512-FhxCc1GLTstyBveAWV1X+6Q9bg485RKanXkJIuZhe+HFK58LQVq0VBQWUVaoD/pCEa1rndjS6R+QKYf2zFGbPA==` |
| `snapback4-linux-x64` | 14,493,734 | `sha512-sNiuSkgxebwUPHFEqI6h0g1EAuggzuDBOAEm/6pa4gL2XoeeAcW5R+pIfJ3KCrHYaxAJ2IdzzvxruT9CGc2biw==` |
| `snapback4-expo` | 7,361,012 | `sha512-BtuhP6Xn8OjoNq9o4rSbsQ0261f37W9LXhDKCCLnQrlX80G/+z4I+NUB0YNaawGBWmXZ9Uhq/lOLjILvBdb99w==` |

These hashes were checked four ways:

- The registry metadata and the downloaded tarballs equal the staged bytes
  (`registry-cli-verified.json`, `registry-expo-verified.json`).
- Each tarball was downloaded again on Linux with `npm pack --prefer-online` and a private cache.
  The client, Expo and Linux tarballs equal the qualified bytes (sha256 `2c5976c3…`, `f14638c3…`,
  `c7ae3596…`). The Darwin tarball equals the Mac stage (sha256 `5560f3d3…`).
- The client and Expo bytes are the ones the Mac prepared after native attempt 2, and the ones
  Linux attempt 2 qualified. The Linux tarball is the qualified one.
- The Expo bytes equal the native-qualified package files (27/27).

Clean installs on Linux and on the Mac print `snapback4 0.4.38`, and `init` and `check` both exit 0.
- The installed Linux binary is the qualified one (SHA-256 `b664f123…`).
- The installed Darwin binary carries Team ID `UD2ZVW5WU5`.

## Binaries and toolchain provenance (all on the black M5)

- **Darwin production binary:** 26,297,104 B, SHA-256
  `22616ca99b51bdad0f346dab8c1b0fd0f0c488f477b1c71556be96a97357a189` (as installed).
  - Signed with Developer ID `UD2ZVW5WU5` through the codesign relay; not notarized.
  - Built in dry run 3 with `/Applications/Xcode.app`, **Xcode 27.1** (27A9275).
- **Linux static musl binary:** SHA-256
  `b664f123d9ad139daf8dd7dd8978ffcd455c4b9b852851fdae3145e146e02a0b`.
- **Expo native archives** (packed in `snapback4-expo`):
  - ios-arm64: `f3dca7342c563a959537c7fb372c63cda947a45d13418ab143038c5fc5054768`.
  - simulator: `1672c17ea2eaa9f49bb019adb3762c816af5a37cb03bf82fda7f632929ec3080`.
  - Built by **Xcode 27.1** in native attempt 2.
- **Expo witness app:** the Release chat-expo app (Expo 57.0.30, expo-modules-core 57.0.23,
  RN 0.86.3; iOS project regenerated), built by **Xcode 27.1**.
  - The `~/Applications/Xcode-27.0.app` fallback was not used.
  - `../20261022-expo-0.4.38/qualified.json` → `toolchainProvenance` records this.

## Qualification at 951ecdd4df

Lean was required for every run. The kit is the 0.4.37 kit with version renames (`kit/`, `linux/`).
The Mac gate polls AC power, the lid and pmset sleep every 60 s.

- **Native, attempt 2:** 344 s.
  - xcframework 143.5 s, cargo build 29.7 s, wasm 47.9 s, Release app 65.5 s.
  - Witness 28.8 s (offline 10.6 s, restart 14.8 s).
  - The prepared Expo files equal the native-qualified files (27/27).
- **Linux, attempt 2** (`linux/`): qualify 5,445.0 s.
  - Suite: `== 0 failure(s) in 3109 s`.
    - cargo test 951 s.
    - client tests 1,600 s: 428/428 files, 7,889 tests / 7,833 pass / 0 fail / 56 skip.
    - models 347 s.
  - Proofs, all passed: starter, frontend and production, day-2/4/5, dx4, dx5, dx6 (new in 0.4.38),
    release transitions, dormant, migrations, proof kit, security, staging, client and rule recipes,
    Expo upgrades.
  - It used a private, fresh `NPM_CONFIG_CACHE`.
  - Before the run, the worktree's own `target/debug` was removed (Linux disk was at 30 GB free).
    Free space during the run was 26–61 GB.
- **Mac dry runs:** default `/var/folders` TMPDIR, `ulimit -n 65536`, serial client files, 0.2.33
  fences, `caffeinate -ims`.

| Attempt | Rust test processes | Result | Note |
|---|---:|---|---|
| 1 | 18 (default) | red in cargo test (2,116 s); killed | `run_admission`: the known 5 s wall-clock bound. `security_wave19` `check_refutes_excluded_contact_roles_before_any_full_test`: check exited 0 with "0 refuted, 2 unproved" (1,832 ms). |
| 2 | 6 (low parallelism) | red in cargo test (2,543 s); killed | the same `security_wave19` test (empty fixtures, 1,749 ms) |
| 3 | 3 (low parallelism) | **passed**, `== 0 failure(s) in 11371 s` (step 11,919 s; gate 11,942 s) | cargo test 3,304 s; client tests 7,764 s; models 204 s; packed staging passed |

- **Isolation** (`kit/isolated/`, `kit/iso-dr1.sh`, `kit/iso-dr2.sh`):
  - `security_wave19`, whole target: 3/3 pass.
  - The failing `security_wave19` test alone: 5/5 pass (3.3 s).
  - The failing `run_admission` test alone: 3/3 pass.
- **Mechanism:** `check` bounds concrete exploration at 1,500 ms of wall clock
  (`Campaign::bounded(1500)`). Under load the refutation is not reached in time. This is
  timing-only, so the flake rule applied. After two timing-only reds, parallelism was lowered;
  nothing was skipped and TMPDIR was untouched.
- Ticket: `issues/20261023-snapback4-security-wave19-check-budget-flake.md`.
- **Publish (`finish.sh`):**
  - `--resume` took 989.9 s and published darwin-arm64, then linux-x64, then the client.
  - The registry check passed at once (3.4 s).
  - Expo was packed, verified against the proof bytes, and published in 5.1 s. It was readable
    after 200.6 s and verified.

## Superseded attempt at cadb7c55be (`superseded/`)

- `attempt-1-cadb7c55be-linux/` holds:
  - `DIAGNOSIS.md`;
  - the suite and qualify logs;
  - the isolation runs (`iso-a1/`: `maintains_recorded` fails 2/2 on Linux and 1/1 on the Mac);
  - the disk log.
- `mac-a1-cadb7c55be/` holds native 1 (Xcode 27.1; 444 s), prepare 1, lean 1 and warm 1 at
  `cadb7c55be`. The Mac dry run never started there.

## Timeline (UTC)

| Step | Time |
|---|---|
| Brief; attempt 1 at `cadb7c55be` (native, prepare, Linux red, isolation) | 10-22 20:14–21:25 |
| Ruling: `951ecdd4df`; native 2 + prepare 2 | 21:25–21:31 |
| Linux 2 (pass) | 21:32–23:03 |
| Mac dry runs 1, 2 (timing reds), 3 (pass) | 23:04 → 10-23 04:05 |
| Resume, registry, Expo verified | 04:05–04:26 |

That is about 7.0 h from native attempt 2 to verified publish (about 8.2 h from the brief).

## Records

- Device logs and dry-run logs are gzipped.
- `kit/` holds the Mac scripts (including the isolation and low-parallelism variants), the gate log
  and exit markers.
- `linux/` holds the receipt, proofs, suite log, disk log and the Linux kit.
