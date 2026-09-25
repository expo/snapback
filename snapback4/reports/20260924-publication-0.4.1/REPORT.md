# Snapback 4 0.4.1 publication — attempt 3 passed

All three packages are published. Registry metadata and downloaded tarballs match the exact qualified local bytes. One dry run and one resume passed; no product or test failure occurred in attempt 3. All evidence from attempts 1 and 2 remains preserved.

Qualified source: `3feff5c0596a0a88827f579eb999beb9fef41ef1` on `sb4-intent/publish-041`, merging main `7811b01e4ab6b7b2e9a34cb4259278840ce78437`. Publication took place on September 24, 2026 Pacific time (September 25 UTC). The supervisor owns the merge to main.

## Registry bytes

| Package | Tarball bytes | Integrity |
|---|---:|---|
| `snapback4-darwin-arm64@0.4.1` | 5,616,775 | `sha512-LkSBon10QohJEyRCS1ZDGxgsndioHSi1u8pY92Uk/NQiIm990QykwUnxcUkxK+gBmNgnxwgGpef5JHk3G5K41g==` |
| `snapback4@0.4.1` | 695,249 | `sha512-ifpgpF2EM9K7pEGxw2785Cj+cEBq5VhbPB2cnGL7l06Vdd4KbkiUAoeejiDdq742/VBvuKqQoo1DIxHCVqdx+Q==` |
| `snapback4-expo@0.4.1` | 4,860,185 | `sha512-owOiy4iEh36uxKQaE9hIj6kJWl2VirRDinoc68UqG7OH4qXaVMI0S1D+VGbAJy9Ww1m11iH1TcdEIf3IWeTBTw==` |

[CLI/platform registry evidence](./registry-cli-verified.json), [Expo registry evidence](./registry-expo-verified.json), [staged CLI receipt](./staged-receipt.json), [Expo pack/file proof](./expo-staged.json). The independent verification downloaded each registry tarball, checked its SHA-512, and compared its complete bytes with the staged file. Every one of the 18 Expo package files matches the native-qualified package, including both rebuilt framework slices.

## Qualification and publication

- Full suite: **0 failures in 1,398 s**. Rust: **2,980 passed, 0 failed, 16 unchanged ignores**, 890 result summaries, 348 s. Ordinary clients: **1,514 tests, 1,509 passed, 0 failed, 0 cancelled, 5 unchanged inherited skips**, 828.613 s. Models: **78/78 passed**, no failures/cancellations/skips, 203.683 s. Fixture wrapper: **9/9 passed**, 16.823 s.
- Online session model: all 5,000 sequences passed in 46.394 s. Local session model: all 5,000 sequences passed in 104.288 s. Online-client model: all 3,000 interleavings passed in 49.564 s. The exact publication seed-11 overlapping-clock regression passed in 0.890 s. No assertion, timeout, sequence count, skip or ignore was changed by this lane.
- All four published-0.2.33 checks passed: timeline-v2, recorded attribution, maintained columns and capability-free control. Both publisher commands used `SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33`.
- Workspace/WASM builds, package builds/typechecks, chat backend check, web/Expo typechecks, docs budget and release guard passed. WASM: 1,767,852 B raw / 492,086 B gzip, within the unchanged merged checkout's 493,000 B budget. README: 300/300 lines.
- The merged default scheduler ran Rust, ordinary clients, then models; host load 22.22 on 18 CPUs selected serial client files. No scheduler or binary override was supplied. The fix lane's clock ownership barrier and cancellation handling are included in the merge; earlier failed assertions remain covered.
- `publish.mjs --dry-run`: **1638.585 s**, passed the suite, production build, signing, packing and installed-consumer proof. `--resume`: **207.308 s**, revalidated the durable stage and repeated the installed-consumer proof before publishing platform then client. Both proofs reported `consumer ok: query complete+fresh, online write sent, offline write pending`.
- Production binary: **11,401,392 bytes**, SHA-256 **`6661de6001b315489dca317669d03ed52a0527c44a885fa27d850096c70a8b48`**, version `snapback4 0.4.1`. Production profile; packaged SQLite policy `-USQLITE_ENABLE_MEMORY_MANAGEMENT`, as set by the unchanged publisher.
- Signed by `Developer ID Application: Charles Cheever (UD2ZVW5WU5)`, team `UD2ZVW5WU5`; not notarized, matching the 0.4.0 path. The unchanged launchd relay SHA-256 is `06fa7db565ac920a7ee7d5d413410c3113757682c9549e3c7c9ddd1da1c46acf`. No keychain setting or credential changed.
- Expo was packed once, verified against every qualified native package file, then the exact tarball was published once. npm accepted uploads and required processing waits before versions became readable; those polls are preserved in the logs and were not failed/repeated publish attempts.

[Full dry-run log](./attempt-3-publication-dry-run.log), [resume log](./attempt-3-publication-resume.log), [qualification summary](./attempt-3-qualification-summary.json), [execution inputs](./attempt-3-execution.json).

## Native Release witness

The successful attempt-3 xcframework build (**9.662 s**) and merge commit were retained after the preparation helper was corrected: framework inputs and hashes were unchanged. Release chat-expo rebuilt against that framework in **79.545 s**, zero errors and three warnings. The linked simulator archive matched the framework; the installed executable and JS bundle matched this Release build.

Dedicated iPhone 17 Pro, iOS 26.5 simulator `81961F7D-DF85-4A7A-B376-20D9073AC101`, port 44441:

| Segment | Options | Seconds | Result |
|---|---|---:|---|
| offline | `--prime` | 9.013 | passed |
| restart | `--prime --relaunch` | 13.788 | passed |

Both segments used the public CLI witness verb through this worktree's fresh debug CLI, following the 0.4.0 path; the witness CLI was not fetched from npm. Every manifest artifact size and SHA-256 verified. The simulator was shut down afterward. This evidence covers the dedicated iOS simulator.

| Artifact | SHA-256 |
|---|---|
| iOS arm64 archive | `d7de0c808019e25d20af24ff318556f3fa41c6a06235e49d09f1258252c7a763` |
| iOS simulator archive | `30e8bdf73b66538984c0b5be8bdea5fd979b04949efec10e5324ec85a511cdac` |
| Installed Release executable | `c1ed9246d65e2c1824b91f177e331ab62418528e23cef6da024827debe916234` |
| Release JS bundle | `f283818298c37c37f521dffa3d048f77f545d39a0cc25ef37d3acee760b5ed5b` |
| Witness CLI, before suite rebuild | `0360d3d25cd915b2bcf391653021e82e0adf2fe0766c43fb54b38b207fc94a0a` |

Source trees: core `db3a55d21ebfb5c5bbec2d7eea990a955df04857`; device `b5d3bd4f0c4bdd44bf40b26eb861672b479410a9`. [Native qualification, framework/file hashes and witnesses](../20260924-expo-0.4.1/qualified.json).

## Every earlier stop and preparation note

1. **Attempt 1 stopped before publication**: five client failures in a 1,360.462 s dry run. Native receipt test raised `setTypeOfService EINVAL`; three capability fences found unexpected `_cap_counts` / `_meta.cap_counts_schema` additions on refusal; capability-free canonical bytes were 2,942 versus the 2,950 pin. No production stage or publication followed. The original [report](./attempt-1/REPORT.md), complete evidence and [journal entry](./attempt-1-journal.md) remain unchanged; all 45 original report files were rechecked byte-for-byte.
2. **Attempt 2 preparation stopped**: applying the old version patch failed at the CLI manifest because the fix lane added pinned Undici. The author clarified that the patch was a file guide and authorized direct version edits. The six files were updated and frozen install passed; version commit `e1d7a6fb56828344c206dae229f4f8ec69126170` preserves Undici 8.8.0. [Original preparation report](./PREPARATION-STOP.md).
3. **Attempt 2 qualification stopped**: dry run 1,515.094 s, one failed suite stage. Online 5,000-sequence model timed out at 240,000 ms (cancelled); local model seed 11 exhausted fair recovery after 100 clock steps (failed). No production stage, consumer proof or publication followed. Its native witnesses had passed. [Exact attempt-2 report](./attempt-2/20260924-publication-0.4.1/REPORT.md), native evidence, logs and journal are archived with preserved relative links; all 145 archived file hashes verify. Fix lane 2 identified the late online model's `clearTimeout` calls crossing into the local model's mock clock and merged its fix before this qualification.
4. **Attempt 3 preparation helper error**, not a product qualification failure: system Python 3.9.6 raised `ModuleNotFoundError: No module named 'tomllib'` before the helper mutated files. The surrounding shell lacked a stop condition and completed frozen install, the merge commit and xcframework build before observation. The lane stopped and preserved the report; the author then explicitly authorized correction and continuation. `/opt/homebrew/bin/python3` resolves to Python 3.14.6, imports `tomllib`, and verified the unchanged merge inputs/framework hashes. Historical journal additions were restored verbatim. [Exact error](./attempt-3-preparation-failure.json), [preserved stop report](./PREPARATION-STOP-ATTEMPT-3.md), [helper correction](./attempt-3-helper-correction.json). The initial source/framework records describe the preparation-time state; final qualification is in the current source record and native `qualified.json`.

No product/test failure, native retry, signing failure, pack failure, consumer failure or failed npm publication occurred in attempt 3. Successful npm processing waits did not cause republishing. Earlier reports and journal entries retain their historical wording; they were not rewritten after success. [Final preservation/source check](./attempt-3-final-evidence-verification.json).

## Environment and delivery

Apple M5 Max, macOS 26.6.2, Xcode 27.0 (27A266a), Node 24.18.0, Bun 1.4.2, Rust 1.97.0. npm identity `ccheever`. All six version-bearing files remain aligned at 0.4.1; optional platform dependency is 0.4.1 and Undici stays pinned at 8.8.0. Frozen install passed. Root frozen dependencies also installed successfully for the normal pre-push hook without lockfile changes. No implementation or test changes followed source `3feff5c0596a0a88827f579eb999beb9fef41ef1`; this delivery adds reports, native artifacts, metrics and append-only journal evidence. Target branch: `origin/sb4-intent/publish-041`; supervisor merges it.

## Every timed attempt-3 command

The preparation helper error had no separate timing; its exact record is linked above. Earlier attempts retain their own complete timing tables. Each record below contains the command, working directory and UTC start/finish times.

| Command | Seconds | Exit | Evidence |
|---|---:|---:|---|
| evidence-checkpoint | 0.174 | 0 | [record](./attempt-3-evidence-checkpoint.json), [log](./attempt-3-evidence-checkpoint.log) |
| merge-main | 0.192 | 0 | [record](./attempt-3-merge-main.json), [log](./attempt-3-merge-main.log) |
| bun-install | 0.190 | 0 | [record](./attempt-3-bun-install.json), [log](./attempt-3-bun-install.log) |
| merge-commit | 0.100 | 0 | [record](./attempt-3-merge-commit.json), [log](./attempt-3-merge-commit.log) |
| xcframework-build | 9.662 | 0 | [record](./attempt-3-xcframework-build.json), [log](./attempt-3-xcframework-build.log) |
| cargo-build | 7.859 | 0 | [record](./attempt-3-cargo-build.json), [log](./attempt-3-cargo-build.log) |
| wasm-build | 2.398 | 0 | [record](./attempt-3-wasm-build.json), [log](./attempt-3-wasm-build.log) |
| client-package-build | 1.775 | 0 | [record](./attempt-3-client-package-build.json), [log](./attempt-3-client-package-build.log) |
| npm-identity | 0.373 | 0 | [record](./attempt-3-npm-identity.json), [log](./attempt-3-npm-identity.log) |
| simulator-boot | 0.688 | 0 | [record](./attempt-3-simulator-boot.json), [log](./attempt-3-simulator-boot.log) |
| simulator-ready | 6.146 | 0 | [record](./attempt-3-simulator-ready.json), [log](./attempt-3-simulator-ready.log) |
| chat-backend-check | 2.017 | 0 | [record](./attempt-3-chat-backend-check.json), [log](./attempt-3-chat-backend-check.log) |
| expo-release-build | 79.545 | 0 | [record](./attempt-3-expo-release-build.json), [log](./attempt-3-expo-release-build.log) |
| root-hook-dependencies | 6.082 | 0 | [record](./attempt-3-root-hook-dependencies.json), [log](./attempt-3-root-hook-dependencies.log) |
| simulator-install | 4.116 | 0 | [record](./attempt-3-simulator-install.json), [log](./attempt-3-simulator-install.log) |
| native-link-verification | 0.268 | 0 | [record](./attempt-3-native-link-verification.json), [log](./attempt-3-native-link-verification.log) |
| native-witness | 25.860 | 0 | [record](./attempt-3-native-witness.json), [log](./attempt-3-native-witness.log) |
| native-qualification-verification | 0.059 | 0 | [record](./attempt-3-native-qualification-verification.json), [log](./attempt-3-native-qualification-verification.log) |
| simulator-shutdown | 3.177 | 0 | [record](./attempt-3-simulator-shutdown.json), [log](./attempt-3-simulator-shutdown.log) |
| publication-dry-run | 1638.585 | 0 | [record](./attempt-3-publication-dry-run.json), [log](./attempt-3-publication-dry-run.log) |
| publication-resume | 207.308 | 0 | [record](./attempt-3-publication-resume.json), [log](./attempt-3-publication-resume.log) |
| registry-cli | 1.380 | 0 | [record](./attempt-3-registry-cli.json), [log](./attempt-3-registry-cli.log) |
| expo-pack | 1.104 | 0 | [record](./attempt-3-expo-pack.json), [log](./attempt-3-expo-pack.log) |
| expo-pack-verification | 0.084 | 0 | [record](./attempt-3-expo-pack-verification.json), [log](./attempt-3-expo-pack-verification.log) |
| expo-publish | 2.369 | 0 | [record](./attempt-3-expo-publish.json), [log](./attempt-3-expo-publish.log) |
| expo-registry-wait | 122.771 | 0 | [record](./attempt-3-expo-registry-wait.json), [log](./attempt-3-expo-registry-wait.log) |
| registry-expo | 0.919 | 0 | [record](./attempt-3-registry-expo.json), [log](./attempt-3-registry-expo.log) |
