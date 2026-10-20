# Publication: snapback4 0.4.33 (2026-10-19)

`snapback4`, `snapback4-darwin-arm64`, `snapback4-linux-x64` and `snapback4-expo` are
published at **0.4.33** from `3653cae823145170df3e720f5e321bd1b5b4d79d`
(Integration 17). All four `latest` = 0.4.33.

0.4.33 supersedes **0.4.31, which was never published**
([`../20261017-publication-0.4.31/REPORT.md`](../20261017-publication-0.4.31/REPORT.md)).
0.4.31 qualified on Linux, but its last Mac dry run was invalidated by a mid-run
clamshell sleep. 0.4.33 contains all of 0.4.31 and 0.4.32. No 0.4.32 was published
either; npm does not need consecutive versions.

## Publish gates

| Gate | Coordinator ruling |
|---|---|
| Wave 18 (Snapback-vs-Convex bakeoff on 0.4.33) | Found no publication-blocking regression, so the coordinator gave the go. |
| Wave 19 (day-two bakeoff) | Briefly suspended the go. It reported 1,358 "lost records" across rollback and forward. The coordinator found these were dormant rows at the rollbacks to v1: 0 on every roll-forward, and 117 of 117 sampled ids were present after the final forward. The go was restored. |

## Registry

| Package | Bytes | Registry integrity |
|---|---:|---|
| `snapback4` | 1,300,706 | `sha512-KIsQ9PQYxbufDI9g721LnHoMQ/ZKx4HzFQIT5/kVu1JJXo+6lEWe4nd2fniXzW/f9ByjA8UIJxOVHdWFAwSSVA==` |
| `snapback4-darwin-arm64` | 11,375,644 | `sha512-hwy7cSYzj1DmpHr+EjPbCdztJQvQdg1n/+uwW8kFOn2ODexGohcURmxEP/ODAvojJFTIMGkocy+RHvfN2Jd+kg==` |
| `snapback4-linux-x64` | 12,910,904 | `sha512-yuyO94medY6S9gf3geiGY9oq6OV2z5oEBMQPgnvbReGMnT+lvMpEHOXBclj+dp8DFwb6ML/pR7bt98Yze5t1Lw==` |
| `snapback4-expo` | 6,454,134 | `sha512-Zn75Lu16YkCWgFkAsqNlcIOY3SOLaWI+w/NABNBOg+ZXb6nb3PucOTcsZ5RSDpw5csGn+5lg04HELiP5P0XOiw==` |

These hashes were checked four ways:

- The registry metadata and the downloaded tarballs equal the staged bytes
  (`registry-cli-verified.json`, `registry-expo-verified.json`).
- Each tarball was downloaded again independently on Linux with `npm pack`, and
  each matches.
- The client and Expo bytes are the ones the Mac prepared after the native witness,
  and that Linux qualified. The Linux tarball is the qualified one.
- The Expo bytes equal the native-qualified package files (24/24).

Clean installs on Linux and on the Mac print `snapback4 0.4.33` and pass `init` + `check`.

## Binaries and toolchain provenance (all on the black M5)

- **Darwin production binary:** 23,453,776 B, SHA-256
  `35a34c0b19b40263c2cf1a8a8239448afa8e7257e500f1443e6f3ee9ba4b3ab0`. Signed with
  Developer ID `UD2ZVW5WU5` through the codesign relay; not notarized. Built in the
  dry run with `/Applications/Xcode.app`, **Xcode 27.1** (27A9275).
- **Linux static musl binary:** SHA-256
  `a744bf6a29189dbcfd5fe1ecc9197db94ee79443eff2873cc4a3288cc3e5ce43`.
- **Expo native archives** (packed in `snapback4-expo`): ios-arm64
  `c02593bc3175028ce075712e642e3ab13608299b531e778e28631622c78a04f3`, simulator
  `2e3764f76ec41bdfc1bee5c7e00749203d385cd25e61caf218ae989603dfb5b3`. Built by
  **Xcode 27.1** in native attempt 1.
- **Expo witness app:** the Release chat-expo app (Expo 57.0.30, expo-modules-core
  57.0.23, RN 0.86.3; iOS project regenerated), built by **Xcode 27.1**.
  - The `~/Applications/Xcode-27.0.app` fallback was not used.
  - `../20261019-expo-0.4.33/qualified.json` → `toolchainProvenance` records this.

## Qualification at 3653cae823

Lean was required for every run. The Mac had the Playwright 1.55.1 headless shell.

- **Native, attempt 1:**
  - xcframework 108.4 s, Release app 58.6 s;
  - witness offline 10.5 s, restart 14.7 s;
  - the simulator was shut down afterwards.
  - The prepared Expo files equal the native-qualified files (24).
- **Linux, attempt 1:**
  - qualify took 4,915.5 s; suite `== 0 failure(s) in 3053 s`;
  - proofs: starter, frontend and production, day-2/4/5, proof kit, security, staging, client and rule recipes, Expo upgrades.
- **Mac dry run:** run through the new watched gate (`kit/gate-dryrun.sh`), with the
  default `/var/folders` TMPDIR, `ulimit -n 65536`, serial client files, the 0.2.33
  fences and `caffeinate -ims`. The gate starts a run only on AC power with the lid
  open, and polls AC power, the lid and pmset sleep every 60 s during it. It found
  no environment-invalid attempt.
  - **Attempt 1 failed one Rust test, a known timing flake.** The test is
    `dev_refusals::quiet::real_refusals_keep_individual_records_and_print_one_counted_line`
    (`quiet.rs:90`). It expected the coalesced console line `×8` and got `×6`.
    - `dev_refusal_console.rs` coalesces refusals in a fixed 1-second window, and
      the test assumed all 8 sequential refusals land inside it.
    - Under full-suite load, plus another agent's concurrent heavy build on the Mac,
      only 6 did.
    - The same dry-run-built binary, unchanged, passed the test 12/12 alone and the
      whole binary 27/27 (`isolated/`). Linux ran the test green.
    - Coordinator ruling: apply the flake rule. Attempt 1 was killed before the
      client pools ran. The test fix landed on main as `8b1b688190`, after this
      commit.
  - **Attempt 2 passed.**
    - `== 0 failure(s) in 9030 s` (step 9,433 s); `cargo test` 1,609 s, including
      `dev_refusals` 27/27;
    - client 417/417 files (7,747 pass, 21 skip); models 81/81.
- **Publish:**
  - `--resume` took 826 s and published darwin-arm64, then linux-x64, then the client.
  - The registry check passed on the first try (2.3 s), with no CDN lag this time.
  - Expo was packed, verified against the proof bytes, and published in 6.9 s. It
    was readable after 168.6 s and verified.

## Timeline (UTC, 2026-10-19)

| Step | Time |
|---|---|
| Native start | 07:49 |
| Prepare | 07:55 |
| Linux qualify | 07:56–09:18 |
| Dry run 1 | 09:19–10:22, killed |
| Dry run 2 | 10:22–13:00 |
| Resume | 13:01–13:15 |
| Expo verified | 13:18 |

That is about 5.5 h from native start to verified publish.

## Environment

- **Mac disk:** before this release, the Mac's reused publish worktree had a
  64 GB `target/debug` and 4,908 stray `target/*.sqlite*` test files. Clearing
  them took free space from 43 GiB to 111 GiB.
- **Linux worktree:** `~/sb4-pub-0431` was moved to `~/sb4-pub-0433` with
  `git worktree move` (it has no initialized submodules).
- **Records:**
  - Device logs over 200 KB are gzipped.
  - `kit/` holds the scripts, gate log and exit markers.
  - `linux/` holds the receipt, proofs and suite log.
