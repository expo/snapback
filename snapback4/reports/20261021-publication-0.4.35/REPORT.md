# Publication: snapback4 0.4.35 (2026-10-21/22)

`snapback4`, `snapback4-darwin-arm64`, `snapback4-linux-x64` and `snapback4-expo` are
published at **0.4.35** from `f0eed70bb36705b08c0c065fa154b386b9ad0504`. All four
`latest` = 0.4.35. 0.4.34 was never published.

The brief named the first `origin/main` commit at or after `3373998583` carrying
0.4.35 (`3373998583` itself). Two deterministic test reds moved the publish commit
twice, by coordinator ruling:

| Commit | Outcome |
|---|---|
| `3373998583` | Linux suite red: `snapback4-lang::guide::every_emitted_code_is_explained` (a test-only `E_REFUSED` literal in `requests.rs`; 3/3 isolated). Fixed on main by `078b33ec45`. |
| `2e10681b32` | Contains `078b33ec45` and the hot-release named-worker race fix. Linux client red: `wasm-codec-census.test.mjs` 2/27 (a test-only `cfg(all(test, feature = "sqlite"))` module scanned by the census; 3/3 isolated). An evidence-only Mac suite here found no Mac-only red. Fixed by `f0eed70bb3`. |
| `f0eed70bb3` | Census-only change (parent `2e10681b32`). Qualified and published. |

## Publish gate

Wave 20 (Snapback vs Convex bakeoff on 0.4.35) found no blocking regression: the
upgrade from published 0.4.33 is clean (row hashes identical, tokens and logins
working, rollback and forward clean) and column read rules don't leak. The
coordinator's go applied to a clean pass at the requalified commit.

## Registry

| Package | Bytes | Registry integrity |
|---|---:|---|
| `snapback4` | 1,316,204 | `sha512-BazFeTCT34CmRIhvXg37g3TpeaZt7zQRDb65evpysUEJiwE0X/Qausx1yml35RntDv5V7Skp2Wp+BRoH77ScMw==` |
| `snapback4-darwin-arm64` | 12,050,945 | `sha512-Yr1HetSxW6EoeBS1gOjxFPP7tt61hvqgWd9HktIXOY+nHgkpElGl+V0kaow5O+13o9Vh+AwVjog9xGOZ08sbvg==` |
| `snapback4-linux-x64` | 13,701,420 | `sha512-e1CXTSZq4xhlivgSuXXWgR02B87Ac+WDB5iQ2iaAPml/dI7560AM2+Jfjg6hIS9r4VHG1pnI/bpvMNS1050HlA==` |
| `snapback4-expo` | 6,835,940 | `sha512-+qd2MFQZimFShLd47srmTlKFN0mmzkGlFOIaXqxSO0OvoZqLFYQKBPNaeuQ4GkZXOFWQ+v/K5igVp9+6qmdiWg==` |

These hashes were checked four ways:

- The registry metadata and the downloaded tarballs equal the staged bytes
  (`registry-cli-verified.json`, `registry-expo-verified.json`).
- Each tarball was downloaded again independently on Linux with `npm pack
  --prefer-online`; client, Expo and Linux equal the qualified bytes, Darwin equals
  the Mac stage (sha256 `c7f30b1e…`).
- The client and Expo bytes are the ones the Mac prepared after native attempt 3 and
  that Linux qualified (the client tarball is byte-identical to the one prepared at
  `2e10681b32`: the delta is test-only). The Linux tarball is the qualified one.
- The Expo bytes equal the native-qualified package files (24/24).

Clean installs on Linux and on the Mac print `snapback4 0.4.35` and pass `init` +
`check` (exit 0); the installed Darwin binary carries Team ID `UD2ZVW5WU5`.

## Binaries and toolchain provenance (all on the black M5)

- **Darwin production binary:** 24,834,432 B, SHA-256
  `d375e8702c5d0e0508d297a50dcfe5e0fd70d435973e6517208f9fc4a196f6c6`. Signed with
  Developer ID `UD2ZVW5WU5` through the codesign relay; not notarized. Built in dry
  run 6 with `/Applications/Xcode.app`, **Xcode 27.1** (27A9275).
- **Linux static musl binary:** SHA-256
  `2873027133760a81e6d4b157f8fa66588b4aeeec2b3c81dc3951bc34e0d517c7`.
- **Expo native archives** (packed in `snapback4-expo`): ios-arm64
  `ae1d5484ccd0ad829eb897f00204addacac1fe552ecd919df00a2f29314bbe01`, simulator
  `114d7970d732f2297f49bc012bbb4e092b4af2077e679cbf600e9122472bdaa3`. Built by
  **Xcode 27.1** in native attempt 3.
- **Expo witness app:** the Release chat-expo app (Expo 57.0.30, expo-modules-core
  57.0.23, RN 0.86.3; iOS project regenerated), built by **Xcode 27.1**.
  - The `~/Applications/Xcode-27.0.app` fallback was not used.
  - `../20261021-expo-0.4.35/qualified.json` → `toolchainProvenance` records this.

## Qualification at f0eed70bb3

Lean was required for every run. The kit is the 0.4.33 kit with version renames
(`kit/`); the Mac gate polls AC power, the lid and pmset sleep every 60 s.

- **Native, attempt 3:** xcframework 8.0 s (cargo outputs reused; framework re-hashed),
  Release app 56.3 s; witness offline 10.2 s, restart 14.3 s. The prepared Expo files
  equal the native-qualified files (24).
- **Linux:**
  - Attempt 3 (`superseded/attempt-3-f0eed70bb3-linux/`): suite `== 1 failure(s) in 3688 s`,
    `following-history.test.mjs` test 17 (64 KiB envelope boundary: 2 refreshes where 1
    was expected). Passed alone 6/6, and passed in the attempt-2 Linux and Mac
    evidence full suites. Flake rule.
  - Attempt 4 (`linux/`): qualify 4,541.7 s, suite `== 0 failure(s) in 2820 s`
    (cargo test 815 s, client 1,584 s, models 326 s); proofs: starter, frontend and
    production, day-2/4/5, dx4, release transitions, dormant, migrations, proof kit,
    security, staging, client and rule recipes, Expo upgrades.
  - From attempt 3 on, `qualify-linux` ran with a private fresh `NPM_CONFIG_CACHE`:
    attempt 2's consumer proofs died on an `ENOENT` in the shared `~/.npm/_cacache`
    (content pruned externally while its index remained).
- **Mac dry runs** (default `/var/folders` TMPDIR, `ulimit -n 65536`, serial client
  files, 0.2.33 fences, `caffeinate -ims`, default Rust test-process count):

| Attempt | Result | Red | Flake-rule evidence (`isolated/`) |
|---|---|---|---|
| 1 | `== 1 failure(s) in 9649 s` | `screen-lifetimes-react.test.mjs` tests 2-4: Vite 8.3.0 `No available ephemeral port found` | alone 6/6 (16/16) |
| 2 | environment-invalid after 3,192 s | Mac unplugged (on battery); gate killed and waited | — |
| 3 | `== 1 failure(s) in 10622 s` | `routes.test.mjs` test 6: crashed invocation recovered at attempt 3, expected 2 (1 s worker lease) | alone 6/6 (13/13) |
| 4 | `== 1 failure(s) in 10703 s` | `social-quote-jump-browser.test.mjs`: the same Vite ephemeral-port error | alone 6/6 (38/38); after `social-browser` 3/3, TIME_WAIT max ~130 |
| 5 | killed after `cargo test` red | `run_admission` `live_dev_forwards_run…`: `snapback4 test` exceeded a 5 s wall-clock bound | alone 12/12 (1.8–2.2 s), whole binary 28/28 |
| 6 | **passed**, `== 0 failure(s) in 9541 s` (step 10,047 s) | — | cargo test 1,785 s; models 195 s |

  Each red was a different load- or port-sensitive test, each passed alone, and the
  same code was green on Linux. About 60–68 other sessions (exact2 Swift/rustc builds,
  bakeoff work) shared the M5; load averages ran 10–800. Vite 8's
  `getAvailableEphemeralPort` binds port 0 on `0.0.0.0`, then needs the same port free
  on `::` and `127.0.0.1`, and gives up after three `EADDRINUSE` collisions. On a
  shared Mac, a port that is free on IPv4 can already be held on IPv6. The coordinator
  pre-authorized a low-parallelism attempt 7 (`SNAPBACK4_RUST_TEST_PROCESSES=6` via
  `kit/publish-lowpar.sh`); it was not needed.
- **Evidence-only Mac suite at `2e10681b32`** (`superseded/mac-a2-2e10681b32/`):
  `== 1 failure(s) in 9717 s`, the census red only; no Mac-only red. It was the first
  Mac run of 0.4.35's code (Integration 19 had no Mac).
- **Publish:**
  - `--resume` took 1,462 s and published darwin-arm64, then linux-x64, then the client.
  - The registry check passed after 291 s of CDN retries.
  - Expo was packed, verified against the proof bytes, and published in 247 s. It was
    readable after 184 s and verified.

## Timeline (UTC)

| Step | Time |
|---|---|
| Brief; M5 offline (asleep) | 10-21 02:13–05:13 |
| Attempt 1 at `3373998583` (native, prepare, Linux red) | 05:13–06:10 |
| Attempt 2 at `2e10681b32` (native, prepare, Linux red; Mac evidence suite) | 06:11–09:56 |
| Native 3 + prepare 3 at `f0eed70bb3` | 09:57–10:01 |
| Linux 3 (flake), Linux 4 (pass) | 10:10–12:33 |
| Mac dry runs 1–6 | 12:34 → 10-22 03:11 |
| Resume, registry, Expo verified | 10-22 03:12–03:49 |

That is about 17.9 h from native attempt 3 to verified publish (about 25.6 h from the brief).

## Environment

- The black M5 was unreachable for ~3 h at the start (asleep; Tailscale blips only).
- `~/sb4-pub-0433-records` and `~/sb4-pub-0433-kit` on Linux were deleted by someone
  else's cleanup during this release; the 0.4.33 records are already committed.
- Linux free space swung between 34 GB and 248 GB with other activity; attempt 3
  started once it was back above 40 GB.
- **Records:**
  - Device logs and dry-run logs over 200 KB are gzipped.
  - `kit/` holds the Mac scripts (including the evidence and low-parallelism variants),
    the gate log and exit markers; `linux/` holds the receipt, proofs and suite log.
  - `superseded/` holds the diagnoses and logs for the two earlier commits and Linux
    attempt 3.
