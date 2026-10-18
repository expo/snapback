# Publication: snapback4 0.4.30 (2026-10-16/17)

Published `snapback4`, `snapback4-darwin-arm64`, `snapback4-linux-x64` and
`snapback4-expo` at **0.4.30** from `4ef9f77fb3ee62cec021ef2359afb6b6b1e06c62`
(Integration 14, including EXPOPIN `7d61cad480`), after the pre-wave and wave-14
go-aheads. All four `latest` = 0.4.30.

## Registry

| Package | Bytes | Registry integrity |
|---|---:|---|
| `snapback4` | 1,275,124 | `sha512-bsbHG4XVDlqaP/PpRBmboCk7ICVkPE8GkFyxTAIlaWx+M9UcES0rKFvCHljOo+2710dU8gFK06adhvTI0ViwPw==` |
| `snapback4-darwin-arm64` | 10,791,124 | `sha512-vrf5b0eMdbBsRB9rV92iplz5rlQzdyqFDLJuk79ZIA9YAKka/DETYiEVyYcZcn0ICDiem8QbsJs0U/9qkctGJA==` |
| `snapback4-linux-x64` | 12,239,191 | `sha512-QcgY0/C/dwxXRMhSbxELx7XT2/5xrnDMQn4NyjvdabpN/6scJjm03VyeCr2Qy2f5H5WBwFWaam9uQ2jjyE6+0Q==` |
| `snapback4-expo` | 6,357,455 | `sha512-P8k4oDxCcg7Y+4go5HLHE24idpuFfBBRehWtuJU0+c45y8X+bBsf7oG8fa/Y13XLAIxXCn4HEmDRhV8Mn6CEUA==` |

Registry metadata and downloaded tarballs equal the staged bytes; the Expo bytes
are the starter/frontend-proof bytes (`attempt-3-expo-proof-bytes.*`).

## Binaries and toolchain provenance (all on the black M5)

- Darwin production binary: 22,171,808 B, SHA-256
  `6afc88eb2a52871ec2db59d0b3b33765ebf6324c0fcc6da574217e445a1c9b66`, Developer ID
  `UD2ZVW5WU5` via the codesign relay; not notarized; built in the dry run with
  `/Applications/Xcode.app` **Xcode 27.1** (27A9275).
- Linux static musl binary: SHA-256
  `ebadd4868adac40899e26e7b5e8319d1a3e2aa622aa11ce8985db08a598130b9`.
- Expo native archives (packed in `snapback4-expo`): ios-arm64
  `73e73f4e2c96f4f5df9098333b4904c915a6e61c687c29cf1becbeda21a076d6`, simulator
  `38cf216ebe5afcb1675d970ed37855ab6b81cdbab204e7247bcad0d463bc3ffc` — built by
  **Xcode 27.1** (native attempt 2).
- Expo witness app (Release chat-expo, Expo 57.0.30 / expo-modules-core 57.0.23 /
  RN 0.86.3, iOS project regenerated) built by **Xcode 27.1** — EXPOPIN works on
  27.1, so the `~/Applications/Xcode-27.0.app` fallback (kept in place) was not
  needed. Recorded in `../20261016-expo-0.4.30/qualified.json` → `toolchainProvenance`.

## Qualification at 4ef9f77fb3

Lean required (smoke 29/29, lean 45/45, no skips); Playwright 1.55.1 headless shell
and strace 6.8 present.

- **Native:** attempt 1 ran at the previous commit because the Mac checkout was
  refused by a leftover `metrics/publish.jsonl` change and the kit continued; it
  stopped at `native-prepare` (dirty tree) and is kept in
  `native-attempt1-wrong-checkout/`. Attempt 2 at 4ef9f77fb3: xcframework 117 s,
  Release app 59 s, witness offline 10.2 s / restart 13.4 s, simulator shut down;
  prepared Expo files equal the native-qualified files (24).
- **Linux:** attempt 1 (`linux/attempt1-stale-npm-cache/`): suite
  `== 0 failure(s) in 2699 s`, but the Expo starter proof's `npm install
  --prefer-offline` failed `ETARGET @expo/cli@^57.0.31` from a stale cached
  packument (57.0.31 published 2026-10-15). The cache was refreshed with one online
  install; attempt 2 was stopped while starting; attempt 3: `== 0 failure(s) in
  2602 s` (qualify 3,800 s), client 405/405, models 81/81, Ubuntu 24.04 (327 s) and
  Alpine (460 s), 12 frontend + 6 starter proofs, day-2 proof passed.
- **Mac dry run** (AC power, lid open, `gate-1.log`; default `/var/folders` TMPDIR,
  `ulimit -n 65536`, serial client files, 0.2.33 fences, `caffeinate -ims`):
  `== 0 failure(s) in 8922 s` (step 9,274 s); complete Cargo suite 1,561 s;
  client 405/405 (7,627 passed, 21 skipped); models 81/81.
- **Publish:** `--resume` (397 s) published darwin-arm64, linux-x64, then the
  client. The registry check's tarball download 404'd for ~5 min after the client
  became readable (CDN lag); after the CDN served it, the remaining steps reran
  (`finish-tail.sh`, attempt 3): registry check, Expo pack/verify/proof bytes,
  Expo publish (2.8 s), readable after 446 s, verified.
