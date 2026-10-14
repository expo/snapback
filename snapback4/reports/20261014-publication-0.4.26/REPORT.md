# Publication: snapback4 0.4.26 (2026-10-14)

Published `snapback4`, `snapback4-darwin-arm64`, `snapback4-linux-x64` and
`snapback4-expo` at **0.4.26** from `063b334862e1ee0d5c23446b71909e442359e2e2`
(origin/main, Integration 9; version bump `82855e5ed5`), through the
cross-host path of LLP 3000.021 §3.3 with the 0.4.25 kit. No qualification
failed and no retry was needed.

## Registry (all `latest` = 0.4.26)

| Package | Bytes | Registry integrity |
|---|---:|---|
| `snapback4` | 1,223,824 (293 files) | `sha512-CI5qlD2O/PyI+1kVdFu6qqMFIySL9xe6xBKCGpYPVt2uxd73d1dcQ8ek8wA4lPnlcfFDPj+4C7ee9n26bRBFmA==` |
| `snapback4-darwin-arm64` | 10,119,385 | `sha512-j5KjH/hQQIgOA0GsWRrOf+Fa6XjrfYUXAYOSLNf669ECSkdE0tkdQ4pL10aj1FiFtZVXYaY23gUzwKDoT/j4zg==` |
| `snapback4-linux-x64` | 11,505,571 | `sha512-3/ZygjCN3D50/qfdf6aTS0+ejuwyt6FJjhwi0dkIRfCb3zdZgf4V1mf4sRfTQHebEHAv51XQ9jzOqzw/LjBDQg==` |
| `snapback4-expo` | 6,264,656 | `sha512-iQ9djVj78drf1YyR0aTSItpHZ0sJ1Q/uGcCOkGSlgvJ9aJ1ihUAVHNuMsHzXL6ax7E0n49tBH21VSBrs4jBfkg==` |

`registry-cli-verified.json` and `registry-expo-verified.json` record that
registry metadata and downloaded tarballs equal the staged bytes.

## Binaries

- Darwin production binary: 20,774,448 B, SHA-256
  `1889183046a8919cd9ed94888c64f8edda06b684f91f883829c17ba712f02f3d`, signed
  `Developer ID Application: Charles Cheever (UD2ZVW5WU5)` (hardened runtime,
  timestamp) through the launchd codesign relay; **not notarized**.
- Linux static musl binary: SHA-256
  `7df65adf31f3a70fc2b9e7b24625e22a548aa453fb61dd743e7d6f208bac94f2`; ELF check passed.
- Expo native archives: ios-arm64
  `05079d5032e47880f66eaadb758e71b345f4d8f776921a0769d4d446accee5ab`,
  ios-arm64-simulator
  `9dc7d9c401db06cf07b7a8e00fda858ed329338b7137ee41105c1d7dfd0b52f6`; source
  trees core `e6a0227fac52`, device `d292c4053b98`.

## Lean oracle

Integration 9 made two difftest targets (`smoke`, `lean`) execute the pinned
Lean 4.34.1 `quarry-oracle` when present, and fail when absent only under
`SNAPBACK4_REQUIRE_LEAN=1` (`86e805946f`, `ae5d7836c5`). The publication path
matched Integration 9's Mac setup on both hosts: Elan on PATH, `lake build
quarry-oracle` in the publication worktree before the suite
(`linux/attempt-1-linux-lean-setup.*`, `attempt-1-lean-setup.*`), and
`SNAPBACK4_REQUIRE_LEAN=1` on the Linux qualification, the Mac dry run and the
Mac `--resume`. Both suites ran `snapback4-difftest::smoke` 19/19 and
`snapback4-difftest::lean` 32/32 with no `SKIPPED (Lean …)` line. The Lean
campaign's four pre-existing disagreement signatures are outside `test.sh`.

## Qualification

- **Linux** (`expo-build-1000`, proot route, Node 24.13.1): client prepared
  once (79.8 s); `qualify-linux.mjs` `== 0 failure(s) in 2619 s` — cargo test
  640 s; client 381/381 files, 7,382 passed, 56 skipped; models 81/81;
  Ubuntu 24.04 and Alpine consumer proofs passed (`linux-receipt.json`).
- **Mac** (M5 Max, Node 24.18.0, default `/var/folders` TMPDIR,
  `ulimit -n 65536`, serial client files,
  `SNAPBACK4_FENCE_PUBLISHED=published-0.2.33`):
  - Expo native: xcframework rebuilt (109 s), Release chat-expo built (63 s)
    against it; the owned simulator `D2C67F7F-196C-439E-AEB9-3FDA4479761E` had
    the previous app uninstalled; witness offline 10.3 s and restart 12.8 s
    passed; simulator shut down (`../20261014-expo-0.4.26/qualified.json`).
  - Dry run: `== 0 failure(s) in 8579 s` — cargo test 1,399 s; client 381/381
    files, 7,417 passed, 20 skipped; models 81/81; build, signing, packing and
    installed-consumer proof passed (8,820.6 s total).
  - `--resume` published `snapback4-darwin-arm64`, `snapback4-linux-x64`, then
    `snapback4`, each after npm made the previous one readable (1,081.5 s).
  - Expo: packed bytes matched the qualified hashes (`expo-staged.json`),
    published, readable after 92.8 s, verified.
- Before the run, the retired 0.4.24 and 0.4.25 Mac build targets (24 GB each)
  were deleted to give the dry run disk room; their staged tarballs are kept
  under `~/sb4-pub-042{4,5}/retained-target/` on the M5.

## Clean-directory verification

`verification.txt`: Linux and Mac installs print `snapback4 0.4.26` and pass
`init` + `check`; the Mac binary carries the Developer ID signature; the Mac
also installs `snapback4-expo@0.4.26`.
