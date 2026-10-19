# Publication: snapback4 0.4.31 — superseded, never published (2026-10-17/19)

**Outcome:** 0.4.31 was never published to npm. `snapback4`, `snapback4-darwin-arm64`,
`snapback4-linux-x64` and `snapback4-expo` stayed at `latest` = 0.4.30 throughout.
On 2026-10-19 the coordinator abandoned 0.4.31 in favour of 0.4.33 (`3653cae823`,
Integration 17), which contains all of 0.4.31 and 0.4.32. npm does not require
consecutive versions. The coordinator gave its rulings at each red; they are
quoted below.

At the final candidate, `ccb9f752d1`, the release qualified on Linux and passed the
native and Expo witness. The only Mac dry run at that commit (attempt 3) was
**invalidated by a mid-run sleep**: the lid was closed and the Mac was on battery. The
failing test file passed alone afterwards.

## Candidates

| Commit | What it is |
|---|---|
| `10b1001a95` | Integration 15, the first candidate. |
| `ccb9f752d1` | `10b1001a95` plus one test-only commit. `run_admission.rs` now waits for the `--no-watch` banner line. No packaged file changed. |

## Linux (`linux/`)

| Attempt | Commit | Result |
|---|---|---|
| 1 | `10b1001a95` | **Passed.** qualify 4,445 s; suite `== 0 failure(s) in 2729 s` (`a1-10b1001a95/`). |
| 2 | `ccb9f752d1` | **Environment red.** Exit 1 after 3,943 s with `npm error nospc … ENOSPC: no space left on device` in `proveExpoUpgrades` (`publication-regressions.mjs:45`), when the shared disk briefly filled (~10:49Z). Its suite had passed, `== 0 failure(s) in 3867 s` (`a2-enospc/`). The coordinator ruled it an environment red and ordered a rerun. Its scratch was deleted before attempt 3, which started with 79 GB free. |
| 3 | `ccb9f752d1` | **Passed.** qualify 4,909 s; suite `== 0 failure(s) in 3567 s`; starter, frontend, production, day-2/4 proofs (`a3-ccb9f752d1/`). |

- The local verdaccio on 127.0.0.1:4873 was down from ~2026-10-17 19:09Z until the
  coordinator restarted it on 2026-10-18. No step failed with ECONNREFUSED to 4873.
- The `snapback4-linux-x64` tarball was byte-identical in attempts 1 and 3:
  SHA-256 `bb87567c3f5875c98c90d23d72e5ca8ae368a8c20594a35f3bc039e345838454`; binary
  SHA-256 `84770daa1d02a2a8dc881aad3ae383c0e1b18dbb722e4a14db8b4f9a8c29290d`.
- The attempt-3 receipt (SHA-256 `3bf11730…`) binds `ccb9f752d1`, client
  `sha512-m9h+HFx…` and Expo `sha512-gbIHdeHN…`.

## Native and Expo witness (black M5)

Every native step was built and witnessed with `/Applications/Xcode.app`, **Xcode 27.1**
(27A9275). The `~/Applications/Xcode-27.0.app` fallback was not used. Both runs are
recorded in `qualified.json` → `toolchainProvenance`.

- **Native attempt 1, at `10b1001a95`:**
  - xcframework 98.7 s, Release chat-expo app 53.0 s;
  - witness offline 10.3 s / restart 14.5 s;
  - archived in `native-attempt1-10b1001a95/`.
- **Native attempt 2, at `ccb9f752d1`:**
  - xcframework 7.4 s, Release app 50.4 s;
  - witness offline 14.4 s / restart 15.3 s;
  - recorded in `../20261017-expo-0.4.31/`.
- **Prepare:**
  - Attempt 2 refused, because the 10b1001a95 prepared client still existed.
  - Attempt 3 at `ccb9f752d1` prepared the client `sha512-m9h+HFx/KsxDQmGppq06J0dZXdj9JsEc4p8Lx7Qp4H0Lj3dlaUSjMVfAKmISWcIk0lheZ+bu6cVI3oYGJDG+uQ==`, 1,281,618 B. Its bytes are identical to the 10b1001a95 prepare.
  - It prepared Expo `sha512-gbIHdeHNm/3cFPEbjrOTjGk+y/6i6TQiA1/0ZHQuPu3C/H/ApWaNhwgWW4/tRKuI07fPtcPyEX0vHNuvjMQ8uA==`, 6,361,397 B. Only the two rebuilt `libsnapback4_device.a` archives differ from attempt 1.
  - The prepared Expo files equal the native-qualified files (24/24).
- Screen recordings (`*.mp4`) were left out of this record. Device logs over 200 KB are gzipped.

## Mac dry runs

Every Mac dry run ran with the default `/var/folders` TMPDIR, `ulimit -n 65536`, serial
client files, the 0.2.33 fences, Lean required, and `caffeinate -ims`.

1. **Attempt 1, at `10b1001a95` (9,182 s), `== 1 failure(s)`.**
   - Only `snapback4::run_admission::no_watch_names_an_unadopted_edit_and_seed_names_the_id_form` failed, panicking at `run_admission.rs:449`.
   - Everything else was green: client 411/411 files (7,694 pass, 21 skip) and models 81/81.
2. **Attempt 2, at `10b1001a95`: the same test, same line.**
   - The captured host output has the dev URL banner and the "development only" line, but no `--no-watch — schema edits are not re-adopted` line.
   - **Diagnosis:** the test waited only for the URL banner. `serve_start.rs` prints the `--no-watch` line a few statements later, after `dev_doors::pin`. Under full-suite load on macOS, `pin` lags, so the assertion can run before that line is printed.
   - The unchanged test passed 12/12 alone on the M5. The suite-built binary passed 4/4 alone and 28/28 for the whole binary.
   - The run was killed after `cargo test` on the coordinator's ruling: *requalify from `ccb9f752d1`; do not accept the red or run a third attempt at `10b1001a95`.*
3. **Attempt 3, at `ccb9f752d1` (19,160 s): environment-invalid.**
   - `cargo test` passed (1,738 s), including `run_admission`, so the fix works. Client models passed 81/81.
   - One client file failed, `ordinary-search-oracle.test.mjs`:
     - process host, seed 294 of 300: `one invocation per publication round, bounded at four for a retired page`;
     - wasm host, seed 8: the same assertion (`2 !== 4`), then a test timeout (8,592,000 ms);
     - the file took 10,229 s, against 423 s in attempt 1.
   - **Cause:** the Mac's `pmset -g log` shows `Clamshell Sleep` at 2026-10-18 16:10:54 PDT (23:10:54Z), on battery. After that there were only DarkWakes until USB-C power returned and `FullWake` came at 18:57:08 PDT (01:57:08Z). That is about 2 h 46 m asleep mid-run.
   - The client stage took 17,156 s, against 7,322 s in attempt 1. The ~9,800 s difference matches the sleep.
   - The gate checked AC power and the lid only at the start.
   - The same file at the same commit, run alone on AC with the lid open (`isolated/`), passed 8/8: process 300 seeds 0 failed (184 s); wasm 300 seeds 0 failed (237 s); 425 s.
   - The same assertion has failed under load before (`../20261001-wb-wall-clock-budgets/FAILURES.md`, `issues/20261004-snapback4-intermittent-client-suite-failures.md`).

The coordinator's ruling: *abandon 0.4.31 and publish 0.4.33 instead.*

## Environment and process lessons

These are recorded in the publish memory and in the 0.4.33 kit.

- **The gate must watch during the run, not just at the start.** The 0.4.33 gate
  (`gate-dryrun.sh` in the 0.4.33 kit) polls every 60 s. It marks an attempt
  `environment-invalid` on battery power, a closed lid, a pmset sleep entry, or a
  wall-clock gap. It then kills the run and restarts when AC power and an open lid
  return.
- **Before reusing a version, clear its prepared client.** `--prepare-client` refuses
  an existing `target/publication/client-<v>/prepare.json`. Move it aside when
  requalifying the same version at a new commit.
- **Rebuilding the xcframework changes the Expo tarball bytes.** The
  `libsnapback4_device.a` archives are not byte-reproducible, so the Expo tarball
  must be re-prepared after each native rerun, and Linux must qualify those bytes.
  The musl Linux tarball, by contrast, was reproducible.
- **Watch disk space on both machines.** The shared Linux disk filled during
  attempt 2. The Mac fell to 43 GiB free, of which 64 GB was the reused worktree's
  `target/debug`, plus 4,908 stray `target/*.sqlite*` test files.

## Files

- `attempt-*`: Mac pubstep records. Dry-run logs are gzipped; attempt 2 has no
  `.json` because it was killed.
- `kit/`: the scripts, gate logs and exit markers.
- `linux/`: Linux step records, receipts, proof summaries and suite logs.
- `native-attempt1-10b1001a95/`: the first native qualification.
- `isolated/`: the isolated oracle rerun.
- `../20261017-expo-0.4.31/`: the native witness at `ccb9f752d1`.
