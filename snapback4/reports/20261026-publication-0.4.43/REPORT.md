# Publication: snapback4 0.4.43 (2026-10-27)

`snapback4`, `snapback4-darwin-arm64`, `snapback4-linux-x64` and `snapback4-expo` are published at
**0.4.43** from `6f3ef3b0d0bfc145b71e1ce5ef9d20efc5326c26`. That commit is Integration 27 (`f032742ac8`),
plus FIX43 (`a19776d1ad`, `861dd71068`, `c9b940ff2e`) and the wave10 relay fix (`6f3ef3b0d0`). All four
`latest` = 0.4.43. 0.4.41 was abandoned and 0.4.42 was never published; npm `latest` was 0.4.40 before this.

## Publish gate

The coordinator gave GO in advance for a clean pass of three things: Linux qualification, the Mac
native/Expo witness, and a watched Mac dry run. They passed as Linux attempt 6, native attempt 2 and dry run 3.
The flake rule (pass alone, then one full rerun) and the environment-invalid rule (document, rerun) were applied as recorded below.

## Registry

| Package | Bytes | Registry integrity |
|---|---:|---|
| `snapback4` | 1,363,292 | `sha512-iJhZMcUAfkBik9hiBHB4+uZyGwgra/zwkFDLvvg8EDg4ilu9l9/dN1yDeF7MI0EXXe085peSBh0I8B1FzqYqUA==` |
| `snapback4-darwin-arm64` | 15,702,085 | `sha512-t2ZtcKo6g1sE2uTHyhc+oTASSosN/dUw0A8WZ4E0n+z0QJDKK5dXrG3ooyrUqu1MxhHEruYRFnYAOs07iA/aOA==` |
| `snapback4-linux-x64` | 17,892,082 | `sha512-nCvE/9+Xi2p3Q5069H6R8bz1LcZzSDFUSrXV8u3KlmwxHZHGDxSTd2Ktn/MCtcII++xtsM8QyJOatMU0DdF6kg==` |
| `snapback4-expo` | 7,699,268 | `sha512-5g3yhsfQd1+t5aYUIdSkKOYsXTDZoaBnoj6azW+CbsA3P8R8LgVT586GCeUezg48kr+np5/J0h5Xa8DqmFTwtA==` |

- **Staged bytes:** the registry metadata and the downloaded tarballs equal the staged bytes
  (`registry-cli-verified.json`, `registry-expo-verified.json`).
- **Re-download on Linux:** each tarball was fetched again with `npm pack --prefer-online` and a private cache.
  - The client (sha256 `edd873c8…`) and Expo (`d39e51ce…`) tarballs are the bytes the Mac prepared after
    native attempt 2, and the bytes Linux attempt 6 qualified.
  - The Linux tarball (`51b94d59…`) is the qualified one.
  - The Darwin tarball (`195139ff…`) equals the Mac stage.
- **Client stability:** the client tarball is byte-identical to the one prepared at `f032742ac8`. The Expo
  tarball differs, as expected, because the xcframework `.a` archives are not reproducible.
- **Clean installs:** on Linux and on the Mac, a clean install prints `snapback4 0.4.43`, and `init` and
  `check` both exit 0.
  - The installed Linux binary is the qualified one (`b5ba708c…`).
  - The installed Darwin binary carries Team ID `UD2ZVW5WU5`.

## Binaries and toolchain provenance (black M5 unless noted)

- **Darwin production binary:** 32,909,184 B, SHA-256
  `dc317bc8dd145274c1fbec682ec43d481ecdc00e0f5ba267672370aa2e76e762`.
  - Developer ID `UD2ZVW5WU5` through the codesign relay; not notarized.
  - Built in dry run 3 with **Xcode 27.1** (27A9275).
- **Linux static musl binary (Linux host):** SHA-256
  `b5ba708c9ad8042864eff317695a53a6993b5cfb0ed605accf1f759fde63b78b`.
  - Byte-identical across Linux attempts 1–6 and FIX43's build.
- **Expo native archives and witness app:** built by **Xcode 27.1** in native attempt 2 at `6f3ef3b0d0`.
  - The witness app is the Release chat-expo app (Expo 57.0.30, expo-modules-core 57.0.23, RN 0.86.3).
  - The `~/Applications/Xcode-27.0.app` fallback was not used.
  - `../20261026-expo-0.4.43/qualified.json` → `toolchainProvenance` records this.

## History

Full timestamped log: `linux/STATUS.md`. The kit is the 0.4.41 kit with renames (`kit/`, `linux/`, `linux/mac-kit-sources/`).

1. **Attempt 1 at `f032742ac8` (Integration 27 final): stopped.**
   - **Native attempt 1** passed (339 s), and prepare matched the native-qualified files 28/28.
   - **Linux attempt 1:** cargo test passed. The client pool was red in `proof-contract.test.mjs` test 4,
     a 50 ms `waitForFresh` window; it passed 6/6 alone, so it is a flake.
   - **Consumer proofs:** linux-1 stopped in the DX7 old-CLI upgrade proof. A harness run of every proof it
     never reached (`linux/attempt-1-f032742ac8/`, `linux/iso-rest/`) found **four deterministic stale
     publication proofs**: DX7 upgrade, DX8 `renderedText` scrolling, staging's unique credentials file, and
     the starters' `registerWebWitness` check. Integration 27 changed each behavior on purpose and updated the
     Rust or unit test, but not the packed proof. The coordinator's FIX43 aligned all four, plus test 4.
   - **Mac dry run 1** (`kit/archive-a1-f032742ac8/`): Rust passed (3,775 s). The client pool was red in
     `wave10-upgrade.test.mjs` tests 2/4/5/7/9, failing 3/3 alone.
     - The test's fake CLI relay called `process.stdout.write(big)` and then `process.exit()`, which drops
       output past 64 KiB on a pipe whose reader lags.
     - The 0.4.24→0.4.43 changelog crossed that size. Linux's faster reader hid the defect.
     - The coordinator fixed the relay in `6f3ef3b0d0`, using `process.exitCode`.
2. **Attempt at `c9b940ff2e` (FIX43):** not started, because the wave10 red was still present there.
3. **Attempt at `6f3ef3b0d0`: published.**
   - **Native attempt 2:** 164 s; prepare matched 28/28.
   - **Early Mac check** requested by the coordinator (`kit/pre-darwin.sh`, `kit/pre-darwin.out`): the 23
     Darwin-gated, CLI-relay and proof files passed 23/23 (649 pass).
   - **Linux attempts.** The shared host was at load 100–230 (96 CPUs) for most of the day.

     | Attempt | Result | Classification and follow-up |
     |---|---|---|
     | linux-2 | Rust latency headers test: `wait` 148.398 ms against the 150 ms sleep bound | Flake: 6/6 alone, module 3/3 |
     | linux-3 | `online-journal-browser` subtest 3 (navigation/IndexedDB race); `proof.test.mjs` tests 4 and 12 (`E_ADDRINUSE` port contention) | Flake: both 6/6 alone |
     | linux-4 | Suite passed (`== 0 failure(s) in 3992 s`), which also completed the full reruns. Then `proveSecurity` hit ETIMEDOUT on the social starter's `test --fixture-only` against a 120 s `spawnSync` timeout | **Environment-invalid:** the deterministic-work campaign needs about 118 CPU-s and took 311–331 s wall at load 183–229, with 0 violations; it passed on the same bytes at load 40–60 |
     | linux-5 | `online-journal-browser` subtest 6 TEST_HANG | Flake: 8/8 alone |
     | linux-6 | **Passed:** suite `== 0 failure(s) in 3596 s`; all consumer proofs, including the four repaired ones, security, starters and container/proot | Receipt `e19c5739…`; qualify took 6,526 s |

   - **Mac dry run 2:** the suite passed (`== 0 failure(s) in 12969 s`).
     - `publish.mjs` reads the Linux receipt only after `scripts/test.sh`. So while the Linux reruns
       continued, the `publish.mjs` process alone was SIGSTOPped. The suite was unaffected, and the process got
       SIGCONT once the linux-6 receipt was in place (`kit/hold-dryrun.sh`, `kit/hold-dryrun.log`).
     - The Darwin starters audit then failed with "node-forge: a fix is available".
     - Cause: node-forge 1.4.1 was published 2026-10-27 04:44Z. The Mac's shared `~/.npm` packument predated
       it, so the `--prefer-offline` install took 1.4.0. Linux's fresh cache resolved 1.4.1, with no audit
       warnings.
     - Classified **environment-invalid** (stale cache, the same class as 0.4.41's vite issue). The starter
       packuments were refreshed online (`kit/refresh-npm-cache-dr2.*`), and the stage was moved aside.
   - **Mac dry run 3:** passed (13,556 s; suite `== 0 failure(s) in 13228 s`; Darwin proofs clean).
   - **finish.sh attempt 1:** `--resume` 638 s, Expo readable after 154 s.

## Follow-ups noted (not done here)

- `scripts/starter-audit-allowlist.json` describes node-forge as having no patched release
  (`reviewedVersion` 1.4.0). node-forge 1.4.1 now exists, so recheck the entry.
- `publication-security.mjs` uses a fixed 120 s timeout for `test --fixture-only`, close to the social
  campaign's ~118 CPU-s. On a loaded host it is wall-clock fragile.
- `online-journal-browser.test.mjs` failed twice in the loaded Linux pool (different subtests).
