# Publication: snapback4 0.4.37 (2026-10-22)

`snapback4`, `snapback4-darwin-arm64`, `snapback4-linux-x64` and `snapback4-expo` are
published at **0.4.37** from `93ede67fe2b620f30e6acb141fcf9f6042705439`. All four
`latest` = 0.4.37. 0.4.36 was never published.

The brief named `ee5a053303`, the first `origin/main` commit carrying 0.4.37. One
deterministic test red moved the publish commit, by coordinator ruling:

| Commit | Outcome |
|---|---|
| `ee5a053303` | Linux client pool red on `wave12-clauses.test.mjs` (a stdout/stderr ordering race in its `serve()` helper; 6/6 alone). Isolation found the real blocker: `wave14-rule-recipes.test.mjs` left an untracked `packages/snapback4/logs/` on every run (2/2), since `75982178c7` routed its `npm pack` through the proof kit's `command()`, which logs to `<cwd>/logs`. `cleanSource()` refuses a dirty tree before the Linux receipt and after the Mac dry-run suite, so no receipt was possible on any host. |
| `93ede67fe2` | Test-only fix for both (wave14 logs to a temp dir; wave12 waits for the URL on stdout too). Qualified and published. |

## Publish gate

The wave-22 bakeoff analysis said publish; the coordinator's go applied in advance to
a clean pass (Linux qualification, native witness, watched Mac dry run), and carried
over to the requalified commit.

## Registry

| Package | Bytes | Registry integrity |
|---|---:|---|
| `snapback4` | 1,322,468 | `sha512-zeuJEfMFB45PvthdQPA/VKzjdqOazJaa2ey8R4K49fFFd6/8gPE8mTjlyFd86HboBeBKBK326KwjCuez5G43+Q==` |
| `snapback4-darwin-arm64` | 12,581,279 | `sha512-koHXIjetlOEVLGvbfPz6sqP/4wyQ6dGPAYInVSpMaetUYGjQklFl8J6avsq89z2BFeRSVrw6Pm5EgyFFTlRqKA==` |
| `snapback4-linux-x64` | 14,288,965 | `sha512-i9aGz6obxX9S30neyfdPt6fU2/BRYqwduToSTwH9LBzLkoYS/4WhpiY/7S8vem2wYNGKmD4cqwdaLBeC01L+Iw==` |
| `snapback4-expo` | 7,327,802 | `sha512-rFyz3V5V3/8Dsu/L/fRXMSAEOuTN/jjHEKStwBhK8LsXJRTrfdFo36hLgE/kjWBa4ZWgsLUnQ+36uGbgWZsrrQ==` |

These hashes were checked four ways:

- The registry metadata and the downloaded tarballs equal the staged bytes
  (`registry-cli-verified.json`, `registry-expo-verified.json`).
- Each tarball was downloaded again independently on Linux with `npm pack
  --prefer-online`; client, Expo and Linux equal the qualified bytes, Darwin equals
  the Mac stage (sha256 `75897ab0…`).
- The client and Expo bytes are the ones the Mac prepared after native attempt 2 and
  that Linux qualified. The client tarball is byte-identical to the one prepared at
  `ee5a053303` (the delta is test-only); the Expo tarball differs only by the rebuilt
  `.a` archives, which are not byte-reproducible. The Linux tarball is the qualified one.
- The Expo bytes equal the native-qualified package files (27/27, now including
  `metro.cjs` and `metro-wasm-transformer.cjs`).

Clean installs on Linux and on the Mac print `snapback4 0.4.37` and pass `init` +
`check` (exit 0); the installed Darwin binary carries Team ID `UD2ZVW5WU5`.

## Binaries and toolchain provenance (all on the black M5)

- **Darwin production binary:** 25,952,000 B, SHA-256
  `e29dda41133677d657638d826f696fa8c66887664d63401ca5e20135cd9367a0`. Signed with
  Developer ID `UD2ZVW5WU5` through the codesign relay; not notarized. Built in dry
  run 2 with `/Applications/Xcode.app`, **Xcode 27.1** (27A9275).
- **Linux static musl binary:** SHA-256
  `231113418fd90fb2446ed987c2d68d9e838632c13bf863f10e39dde58bd04b0d`.
- **Expo native archives** (packed in `snapback4-expo`): ios-arm64
  `e23b0eb670d83c60905b0c8347ad2d452227cbcb769af2246861e0fdc124cfa6`, simulator
  `3cda5972fb1c823c65c74691f3b3b788601dcd1925a933935c1ca6f968aab504`. Built by
  **Xcode 27.1** in native attempt 2.
- **Expo witness app:** the Release chat-expo app (Expo 57.0.30, expo-modules-core
  57.0.23, RN 0.86.3; iOS project regenerated), built by **Xcode 27.1**.
  - The `~/Applications/Xcode-27.0.app` fallback was not used.
  - `../20261022-expo-0.4.37/qualified.json` → `toolchainProvenance` records this.

## Qualification at 93ede67fe2

Lean was required for every run. The kit is the 0.4.35 kit with version renames
(`kit/`, `linux/`); the Mac gate polls AC power, the lid and pmset sleep every 60 s.

- **Native, attempt 2:** xcframework 8.6 s (cargo outputs reused; framework
  re-hashed), Release app 55.8 s; witness 27.5 s (offline + restart). The prepared Expo
  files equal the native-qualified files (27).
- **Linux, attempt 2** (`linux/`): qualify 5,071.4 s, suite `== 0 failure(s) in 2790 s`
  (cargo test 759 s, client 1,609 s: 425/425 files, 7,828 tests / 7,772 pass / 56
  skip; models 330 s); proofs: starter, frontend and production, day-2/4/5, dx4, dx5
  (new in 0.4.37), release transitions, dormant, migrations, proof kit, security,
  staging, client and rule recipes, Expo upgrades. Private fresh `NPM_CONFIG_CACHE`.
- **Mac dry runs** (default `/var/folders` TMPDIR, `ulimit -n 65536`, serial client
  files, 0.2.33 fences, `caffeinate -ims`, default Rust test-process count):

| Attempt | Result | Note |
|---|---|---|
| 1 | environment-invalid after 5,806 s | Mac unplugged (on battery); cargo test had passed (1,717 s). The gate killed it and waited for AC. |
| 2 | **passed**, `== 0 failure(s) in 9449 s` (step 9,947 s; gate 10,006 s) | cargo test 1,665 s; models 182 s; packed staging passed |

  No timing-only red occurred, so the low-parallelism variant was not used. Mac load
  averages ran from ~7 to ~500 (other agents' builds) during native/warm, and ~7–15
  during dry run 2.
- **Publish (`finish.sh`):**
  - `--resume` took 612.6 s and published darwin-arm64, then linux-x64, then the client.
  - The registry check passed at once (2.6 s).
  - Expo was packed, verified against the proof bytes, and published in 3.3 s. It was
    readable after 385.4 s and verified.

## Superseded attempt at ee5a053303 (`superseded/`)

- `attempt-1-ee5a053303-linux/`: `DIAGNOSIS.md`, suite log (cargo test 1,022 s green;
  client pool 1 failed file), and the isolation runs (`iso-linux-a1.sh`): wave12 alone
  6/6; wave14 alone 25/25 twice, each leaving `packages/snapback4/logs/`.
- `mac-a1-ee5a053303/`: native 1 (Xcode 27.1; 323 s), prepare 1, lean 1, warm 1 at
  `ee5a053303`. The Mac dry run never started there.

## Timeline (UTC)

| Step | Time |
|---|---|
| Brief | 10-22 04:06 |
| Attempt 1 at `ee5a053303` (native, prepare, Linux red, isolation) | 04:08–04:55 |
| Fix `93ede67fe2` on main | 05:21 |
| Native 2 + prepare 2 | 05:23–05:26 |
| Linux 2 (pass) | 05:27–06:51 |
| Mac dry run 1 (env-invalid), 2 (pass) | 06:51 → 11:27 |
| Resume, registry, Expo verified | 11:31–11:48 |

That is about 6.4 h from native attempt 2 to verified publish (about 7.7 h from the brief).

## Records

- Device logs and dry-run logs over 200 KB are gzipped.
- `kit/` holds the Mac scripts (including the evidence and low-parallelism variants),
  the gate log and exit markers; `linux/` holds the receipt, proofs, suite log and the
  Linux kit.
