# Publication: snapback4 0.4.29 (2026-10-16)

Published `snapback4`, `snapback4-darwin-arm64`, `snapback4-linux-x64` and
`snapback4-expo` at **0.4.29** from `59fb4ead1ba18569369523bba55b56713cc275e9`
(Integration 13 + PUBFIX29 + PUBFIX29b), after wave 13's go-ahead. All four
`latest` = 0.4.29.

## Registry

| Package | Bytes | Registry integrity |
|---|---:|---|
| `snapback4` | 1,258,778 | `sha512-2tfDLDnpuMzENef+nAR2VQ5kkUCfhxjmxNvtjDCfLNim9mqblA5joZtVzPBbudFTQ7sIiMYftCFStjVEKUHISQ==` |
| `snapback4-darwin-arm64` | 10,579,059 | `sha512-Zj962ikgpZxyu7MzqO5LvvV+Rr/+yXL1A/zO2NjZi3ySDMtdwJY/0eyvjVJEvlWk11nGeF1BpvZbHrLrV/kkVg==` |
| `snapback4-linux-x64` | 12,021,439 | `sha512-S9aoo0/zOpyasdIEv8Gux+MffquIzov4fXaB6WezYu5R+tozgF38tNxZkcGOxiDBFQ1ojrYGInQMmz5dhk+lzA==` |
| `snapback4-expo` | 6,324,390 | `sha512-vQUYCVHmb+ODNpPn1b9A1CDZ0PcMoQCNKntrLPcYgSP+E08Kl4sYBoClJ9dSOBHN/FaR51N2GQbwNGgNNywijA==` |

Registry metadata and downloaded tarballs equal the staged bytes. The Expo bytes
are the ones the Ubuntu/Alpine/Darwin starter and frontend proofs exercised
(`attempt-6-expo-proof-bytes.*`).

## Binaries and toolchain provenance

- Darwin production binary: 21,728,016 B, SHA-256
  `810be9f21cd510f39dcbe61d73abecd311f26bee10916b46122b93e07756e6cd`, Developer ID
  `UD2ZVW5WU5` via the launchd codesign relay; not notarized. Built in dry run 6
  with `/Applications/Xcode.app` = **Xcode 27.1** (27A9275) on the M5.
- Linux static musl binary: SHA-256
  `61f16eea59fdb9d6e4a103f925d16d49250f1a512369b4572351d0af61c1ec73`.
- Expo native archives (packed in `snapback4-expo`): ios-arm64
  `5a0596ff7878e9010b934c72a1b57d5406bca7b0c4ea8ef0809f2a20b5a77f12`, simulator
  `b8bf62e46de969f7ae0204657f290317d202d8f1ce4af524d14cbff14ec9ffe7` — built by
  **Xcode 27.1** in native attempt 4 (`attempt-4-xcframework-build.*`).
- Expo native witness app (Release chat-expo, Expo SDK 57.0.22 / RN 0.86.3) built
  by **Xcode 27.0** (27A266a) at `~/Applications/Xcode-27.0.app`, copied with
  tar (signatures/xattrs kept) from `macstudio-charlie-apt101-a`; codesign
  verify passed, first-launch status ok, iOS 26.5/27.0/27.1 runtimes available.
  It linked the exact 27.1-built simulator archive above (`native-link-verification`).
  Recorded in `../20261015-expo-0.4.29/qualified.json` → `toolchainProvenance`.

Why: `/Applications/Xcode.app` updated itself from 27.0 to 27.1 on 2026-10-15
20:30 PDT. On 27.1 the witness app's Expo modules do not build (precompiled and
from-source; `native-attempt3-xcode271-expo/`, `native-xcode271.sh`, ticket
`issues/20261016-snapback4-expo-sdk-57-does-not-build-on-xcode-27.1.md`). Rebuilding
our xcframework with 27.0 was not needed: the witness proves the 27.1-built archive
links and runs, and keeping it preserved the prepared Expo bytes that Linux and
Darwin had already qualified. Note both Xcodes report the same Swift
(6.4, swiftlang-6.4.0.34.1); the difference is the 27.1 SDK.

## Qualification at 59fb4ead1b

Lean oracle required on both hosts (smoke 29/29, lean 44/44, no skips);
Playwright 1.55.1 headless shell present on both; strace 6.8 on Linux.

- **Linux:** pool 1 (`linux/attempt-3-*`, `suite-a3.log.gz`) — 1 failure: the
  `snapback4-lang::shape_meter` test executable was missing at spawn (0.0 s, empty
  output); the target passed alone (11/11). Pool 2 (`linux/attempt-4-*`,
  `suite-a4.log.gz`): `== 0 failure(s) in 2608 s` (qualify 3,661 s); cargo test
  675 s; client 398/398 (7,512 passed); models 81/81; Ubuntu 24.04 (321 s) and
  Alpine (463 s) proofs; 12 frontend + 6 starter proofs. Receipt.
- **Mac** (default `/var/folders` TMPDIR, `ulimit -n 65536`, serial client files,
  0.2.33 fences, `caffeinate -ims` in `nohup`, AC-power/lid-open gate
  `gate-6.log`): dry run 5 — 1 failure,
  `run_admission::no_watch_names_an_unadopted_edit_and_seed_names_the_id_form`
  (same log race as 0.4.27; passed alone 3× in `isolated-5/` and in dry runs 3
  and 6), client 398/398 green. Dry run 6: `== 0 failure(s) in 9145 s` (step
  9,470 s); cargo test 1,809 s; client 398/398 (7,546 passed, 21 skipped);
  models 81/81; signing, packing, installed consumer and Darwin starter proof.
- Native: witness offline 10.1 s / restart 14.4 s on the owned simulator (shut
  down); prepared Expo files equal the native-qualified files (24).
- Publish: one `--resume` (464 s) published darwin-arm64, linux-x64, then the
  client; Expo published (3.6 s) and readable after 499 s. The two
  `no write scenario: replace the Home assertions` lines in the resume log are the
  expected negative-proof outputs.

## Attempt history (0.4.29)

1. `a4aa9d6e11`: Mac dry run red — darwin-only 0.2.33 capability fences
   (`maintained-id-sha256-v1`), `/proc` in `wave12-kit` and `qualify-linux` tests
   (fixed by PUBFIX29 `92878680fc`). `linux/superseded-a4aa9d/`, `superseded-a4aa9d-mac/`.
2. `92878680fc`: Linux green; Mac dry run stopped for the generated-TS runtime-import
   hold (PUBFIX29b `59fb4ead1b`). `linux/superseded-928786/`, `superseded-928786-mac/`.
3. `59fb4ead1b`: as above.
