# Publication: snapback4 0.4.25 (2026-10-13)

Published `snapback4`, `snapback4-darwin-arm64`, `snapback4-linux-x64` and
`snapback4-expo` at **0.4.25** from `a0bb11bde670af282de1093ebdb9f5cd0d1853e4`
(origin/main, Integration 7; version bump `5a4779e48a`). 0.4.24 was abandoned
unpublished after its qualification found two release blockers (below).
Cross-host path of LLP 3000.021 §3.3: Linux prepared and qualified the client
and the Linux platform; the M5 (black) qualified, signed and published.

## Registry

| Package | Bytes | Registry integrity |
|---|---:|---|
| `snapback4` | 1,214,346 (291 files) | `sha512-ezjMZyM1kUMPVVirbgZItGPgpPwS/AqbWbPo3eOZybwf7fnzomz8CRyQ8UgkYc+WWHtzWdvaUWMP/HLZ7aJbVw==` |
| `snapback4-darwin-arm64` | 9,749,654 | `sha512-+9b2nC7VkN64xWCgVFKqgE36q24+sEsow2RBYI6gktJ+u5SciS2W+rU9VqisUo6OuAF4RcnH7sKiLT6FOFY8Dg==` |
| `snapback4-linux-x64` | 11,080,882 | `sha512-ArebbE/SiTquZUlgMI3s5TCNRpUANzMZjeBg4jpoymG2Bmv7JXcbssjuC2yF8Hf4RwLMm8g73PRjRNcttSOYJA==` |
| `snapback4-expo` | 6,226,018 | `sha512-qLewr4x8wXn7ZoT1fo19w+b69NIQlwxTzWjDzr1g3w65uDnVngYnDL6shQJQkX33rvIJHazYzpeYgyZmQ+z2lA==` |

`registry-cli-verified.json` and `registry-expo-verified.json` record that the
registry metadata and the downloaded tarballs equal the staged bytes.
All four `latest` dist-tags are 0.4.25.

## Binaries

- Darwin production binary: 19,968,592 B, SHA-256
  `c76f725419bcda4410b447fd06e16ec07089e886e4dea816fad494a56916d8fa`, signed
  `Developer ID Application: Charles Cheever (UD2ZVW5WU5)` with hardened runtime
  and timestamp through the unchanged launchd codesign relay; **not notarized**.
  (Plain `/usr/bin/codesign` over SSH still fails with errSecInternalComponent;
  see `../20261012-publication-0.4.24/` preflight logs.)
- Linux static musl binary: SHA-256
  `3caf523da60136302cfba0358ad665b092b820e57c3abde01d3112db7b194c70`; ELF check
  passed (no interpreter, no needed libraries). rustc 1.97.0, musl 1.2.5.
- Expo native archives (xcframework):
  ios-arm64 `1027195e3a7a33457d3881bf801b99aa5efa3d023b5644f71d6983b2f857a135`,
  ios-arm64-simulator `548b492f6307f38b8b861bb942d5fcf997dae93f92962a0125bf9dbfdc7a62be`;
  source trees core `5d6996b81d7f`, device `017cea58307c`.

## Qualification

- **Linux** (`expo-build-1000`, proot route, Node 24.13.1). Client prepared once
  (`linux/attempt-1-linux-prepare-client.*`, 78 s).
  - Run 1: `== 1 failure(s) in 1672 s` — only
    `packages/snapback4/test/social-quote-jump-browser.test.mjs`, subtest
    "already visible original highlights without moving the list" (296 !== 264,
    list position read during layout). No receipt. The file passed alone
    (38/38, `linux/attempt-1-linux-isolated-social-quote-jump.log`).
  - Run 2 (second full pool, same client bytes): `== 0 failure(s) in 1589 s`;
    cargo test 610 s; client 373/373 files, 7,328 passed, 56 skipped; models
    81/81; Ubuntu 24.04 and Alpine consumer proofs passed. This is the receipt
    (`linux-receipt.json`, `linux-proofs.json`). Per the flake rule, the file
    counts as a flake because it passed both alone and in the second full pool.
- **Mac** (M5 Max, macOS 27.0.1, Xcode 27.0, Node 24.18.0, default
  `/var/folders` TMPDIR, `ulimit -n 65536`, serial client files,
  `SNAPBACK4_FENCE_PUBLISHED=published-0.2.33`).
  - Expo native: xcframework rebuilt (312 s), Release chat-expo built (247 s)
    and linked the rebuilt simulator archive; the owned simulator
    `D2C67F7F-196C-439E-AEB9-3FDA4479761E` had its previous app uninstalled;
    witness offline `--prime` 38.1 s and restart `--prime --relaunch` 22.2 s
    passed; simulator shut down. `../20261013-expo-0.4.25/qualified.json`.
  - Dry run (`attempt-1-publication-dry-run.*`): `== 0 failure(s) in 11878 s`;
    cargo test 4,068 s; client 373/373 files, 7,363 passed, 20 skipped;
    models 81/81; production build, signing, packing and installed-consumer
    proof passed (12,220 s total, Mac under heavy load from other sessions).
  - `--resume` attempt 1 published `snapback4-darwin-arm64` and then stopped
    after 10 minutes because npm had not yet made it readable (registry 404).
    It became readable ~13 minutes after upload with the staged integrity.
    `--resume` attempt 2 found it matching, repeated the consumer proof and
    published `snapback4-linux-x64`, then `snapback4` (226.6 s).
  - Expo: `npm pack` bytes verified against the qualified file hashes
    (`expo-staged.json`), published, readable after 153 s, verified.

## Clean-directory verification

See `verification.txt`: on Linux and on the Mac, `npm i snapback4@0.4.25`
(plus `snapback4-expo@0.4.25` on the Mac), `npx snapback4 --version` →
`snapback4 0.4.25`, `init` + `check` ok; the Mac's installed binary carries the
Developer ID signature.

## Earlier attempts (0.4.24, abandoned unpublished)

Recorded in `../20261012-publication-0.4.24/` (Linux side) and on the M5 under
`~/projects/snapback-pub-0424` / `~/sb4-pub-0424/`:
1. `e82bb70b97`: Linux suite red — `snapback4-difftest::devices`
   `retained_device_findings_still_reproduce` (two expired-row cases newly
   passing; fixed by merging main's lane-EX resolution → `b16a053804`).
2. `b16a053804`: Mac suite red — 17 serve tests: the release control socket
   path exceeded macOS SUN_LEN under `/var/folders` (fixed → `d0f387fc19`).
3. `d0f387fc19`: Mac client suite red — 0.2.33 capability fences/control
   against the new release store version, and serve worker release dir not
   canonical (`/var` vs `/private/var`) (fixed by MACFIX in Integration 7).
No 0.4.24 package was ever uploaded.
