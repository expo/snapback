# Publication: snapback4 0.4.27 (2026-10-14/15)

Published `snapback4`, `snapback4-darwin-arm64`, `snapback4-linux-x64` and
`snapback4-expo` at **0.4.27** from `ce229488de2074f68d2249fd1d88d62324acac05`
(`8d1302f5e8` EXPOFIX + the `periphery.test.mjs` expectation fix; bump
`8487563659`). The release fixes the 0.4.26 Expo starter's SVG favicon that broke
`npx expo export -p web`, and adds the packed starter proof (LLP 3000.011.003.000 §10)
to both hosts' qualification.

## Registry (all `latest` = 0.4.27)

| Package | Bytes | Registry integrity |
|---|---:|---|
| `snapback4` | 1,223,871 | `sha512-WO5W0VgkcLVmzyGe/pd52hFMulYD2yPD2FBC75HPz4sYlwR38gZ9ecEQ74LirkOgPdBQ+YYPnhKdGZE3t7H1dw==` |
| `snapback4-darwin-arm64` | 10,126,095 | `sha512-0FvoPDtSD03g/ZjQoFUYjtJmgceKHtIha/UbdotGjxJN9wj+WHFyzitwk83kRKh2tKf50OosCp6dNyEsS52G5Q==` |
| `snapback4-linux-x64` | 11,499,599 | `sha512-PZDOlWCPu+W+LC43rwxJyWActOWewE8mSmhDbfNaKCVsrlDT7scKGZtWRVKK0ZMQ7Mep/BkUQPRkEPFv09YZiA==` |
| `snapback4-expo` | 6,265,115 | `sha512-DSIn1aGzqotkPpP8lsezqAb2lSgJL+JxEzJ7ynS1QveSbSsnvKlk/6eN+G3kIkXTiJ60aIG+fghAbO+Nhz14Jw==` |

Registry metadata and downloaded tarballs equal the staged bytes
(`registry-cli-verified.json`, `registry-expo-verified.json`).

## Expo proof bytes = published Expo bytes

The client and the packed Expo adapter were prepared once on the M5, after the
native build (`attempt-2-publication-prepare-client.*`), so the Expo tarball the
starter proofs exercised on Ubuntu, Alpine and Darwin is the one published: its
23 files equal the native-qualified hashes (`../20261014-expo-0.4.27/qualified.json`),
and a kit step (`attempt-5-expo-proof-bytes.*`) refused the upload unless the
freshly packed SRI equalled the prepared SRI.

## Binaries

- Darwin production binary: 20,774,464 B, SHA-256
  `b5068178e531f82e495e8da76b7e07e566a802185fd28bdf1769f69d2d26c375`, Developer ID
  `UD2ZVW5WU5` via the launchd codesign relay; not notarized.
- Linux static musl binary: SHA-256
  `d99fc023957dad6b7d9dfd658a039a00a8fa259a5713cb18b23603bffb484118`.
- Expo native archives: ios-arm64
  `e0e3854f5d3c155c6ceaed8fa3ff4139aef992c4aba8472f37ed85e8d4febd82`, simulator
  `e58c80922bf01276468e6198dbd6e040fa943ec8e484ad3502ce363cf43d333b`.

## Qualification (Lean oracle as 0.4.26: Elan on PATH, `lake build quarry-oracle`, `SNAPBACK4_REQUIRE_LEAN=1`; difftest smoke 19/19 and lean 32/32 in every suite, no skips)

**Linux** (`expo-build-1000`, proot, Node 24.13.1), same prepared bytes:
- Pool 1 (`linux/attempt-2-*`, `suite-a2.log.gz`): `== 1 failure(s) in 2582 s` —
  only `test-processes.test.mjs` "Darwin before release ignores a reused unrelated
  PID with malformed metadata": a real unrelated host process with transient
  metadata (`ppid 0, pgid 4294967295`) was read during inspection. Passed alone
  (53/53, `attempt-2-linux-isolated-test-processes.*`). No receipt.
- Pool 2 (`linux/attempt-3-*`, `suite-a3.log.gz`): `== 0 failure(s) in 2544 s`;
  client 381/381, models 81/81; Ubuntu 24.04 (267 s) and Alpine (371 s) consumer
  and starter proofs passed — web, expo, adapted, all templates. This is the receipt.

**Mac** (M5 Max, Node 24.18.0, default `/var/folders` TMPDIR, `ulimit -n 65536`,
serial client files, published-0.2.33 fences). Native witness passed (offline
10.2 s, restart 21.9 s; owned simulator uninstalled first and shut down after).
- Dry run 2: `== 1 failure(s)` (client): `ordinary-search-oracle` (seed 132),
  `per-row-boundaries`, `per-row-progress`, `per-row-react` — the M5 dropped into
  Deep Idle/maintenance sleep and changed networks mid-run (pmset log), giving
  35-minute waits, `TEST_HANG` guards and a Playwright timeout. All four passed
  alone (`attempt-2-isolated-*`) and in dry run 3's full pool.
- Dry run 3 (under `caffeinate -ims`): `== 2 failure(s) in 8456 s` —
  `run_admission::no_watch_names_an_unadopted_edit_and_seed_names_the_id_form`
  (read the dev log before its `--no-watch` note line arrived) and
  `release-activation` "REL2 successful preview…" (`rollback --check`: release
  control `Broken pipe (os error 32)`). Each passed alone (run_admission 28/28;
  release-activation 41/41 three times) and both had passed in dry run 2's pool.
- Dry run 4: `== 0 failure(s) in 8389 s`; cargo test 1,384 s; client 381/381
  (7,430 passed, 20 skipped); models 81/81; signing, packing and the installed
  consumer plus Darwin starter proof passed. Staged.
- `--resume` 4 published `snapback4-darwin-arm64` and `snapback4-linux-x64`, then
  stopped when npm took >10 min to make linux-x64 readable (readable ~17 min after
  upload, matching). `--resume` 5 found both matching, repeated the consumer and
  starter proof, and published `snapback4`; then Expo (readable after 336 s).

The `rollback --check` broken pipe is worth a look even though it did not
reproduce: an intermittent release-control transport error under load.

Superseded `8d1302f5e8` evidence (Linux red on stale `periphery.test.mjs`
expectations, fixed by `ce229488de`): `linux/superseded-8d1302/` and
`superseded-8d1302-mac/`.

## Clean-directory verification

`verification.txt`: installs on Linux and the Mac print `snapback4 0.4.27`,
`init` + `check` pass; the Mac binary carries the Developer ID signature and the
Mac also installs `snapback4-expo@0.4.27`.
