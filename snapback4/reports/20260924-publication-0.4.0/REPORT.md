# Snapback 4 0.4.0 publication

All three packages are published; registry metadata and downloaded tarball integrities match the qualified local bytes. No push was made in phases 2–4.

Qualified source: `20cb39bf0ffd49f619e3d904bbb7355bc19993bd` on `sb4-intent/publish-040`, integrating final main `a1ca70c58d129d1674966f26e5cfc14183022415`.

## Registry bytes

| Package | Bytes | Integrity |
|---|---:|---|
| `snapback4@0.4.0` | 656765 | `sha512-mOso3FXTTsKgKeatmOe3mBX8wm9nEoCmEXf4fFMicxveUFo4IiM9IZ7xevcQ6uziThgvr8b+5w95ZRb9jbl+8A==` |
| `snapback4-darwin-arm64@0.4.0` | 5379828 | `sha512-uhPlRv2+piSZw0x1eKMC2o/dlskwE+OnxW4FakNmT3ao7cmzA6IDeStv11kdZsj1t9DfoisCch68NVbMDqKQ6A==` |
| `snapback4-expo@0.4.0` | 4809625 | `sha512-PtZPvTcF7FtLy+RMMyWgsekPuW9igYqwzAS8QC0SFnCi1k5Rwm2i/Sx6A9JrdrsoF/JL0IeOQRU6+SU4yxKZTA==` |

See [registry evidence](./registry-verified.json) and [staged CLI receipt](./staged-receipt.json).

## Qualification

- `_effect_keys` is created lazily inside the emitting SQLite transaction, shared by engine and native device. Failed first emissions roll back table and keys; permanent deduplication, replay suppression, outbox-removal and reopen behavior remain covered.
- All four published-0.2.33 fences passed with `SNAPBACK4_FENCE_PUBLISHED` enabled. `timeline-v2`, recorded attribution and maintained columns refuse old native/WASM installation, adoption and reopen. Capability-free native/WASM install, adoption, queries and persisted reopen pass.
- Supervisor ruling: a 0.4 release requires a 0.4 server. The old server correctly refuses mixed-version source with `E_GENERATION`; a matching current server first proves the release usable, and the old refusal preserves prepared release/store bytes.
- The canonical backend pin is 2,950 bytes, formerly 2,734. Exactly eight diagnostic-string changes (site spelling and reason text, repeated in programs/schema metadata) explain this control; the complete backend and exact stored-schema encoding remain pinned.
- Affected suites: 1,270 core/device tests passed, 4 ignored, 253.494 s; 27 work-intent tests passed, 21.491 s; four fences passed in 3.351 s.
- Fresh publication suite: **0 failures in 629 s**; client 1,093 passed/5 skipped in 617 s; Rust 214 s, inventory 138 test binaries/855 executions. SQLite build policy `-USQLITE_ENABLE_MEMORY_MANAGEMENT`. The complete dry run, including production build, signing, packing and installed consumer, took 764.805 s.
- `--resume` repeated the installed-consumer proof and published exact staged bytes, platform first and client second. npm processing waits are retained in the log and are not failed publish attempts.
- Production binary: 10,940,992 bytes; SHA-256 `a5d7683030251d50c36775777ca104715857eb29edd8e40d4ba6ca79074f3edf`. Signed by `Developer ID Application: Charles Cheever (UD2ZVW5WU5)`, team `UD2ZVW5WU5`; not notarized. The unchanged launchd relay delegated only the existing signing invocation; no keychain or credential setting changed.
- Rebuilt both iOS slices (65.467 s) and the Release chat-expo app (29.515 s). The linked simulator archive and installed app executable were verified against the new build. Existing CocoaPods integration copied the new framework; pods had already been installed with the framework present.
- Dedicated simulator `83D9B076-D3E5-4045-AD0A-17AF5DBC137A`: offline `--prime` 13.479 s; restart `--prime --relaunch` 13.330 s. Both passed through this worktree's built CLI. The simulator was shut down afterward.
- [Native qualification and all file hashes](../20260924-expo-0.4.0-phase4/qualified.json). Device tree unchanged from phase 1; core changed for the fix. This supersedes the earlier native qualification for publication.

## Native source and framework hashes

| Source tree | Git tree digest |
|---|---|
| `snapback4-device` | `708272bad68589c64517f4a15063bfa1eee16bf1` |
| `snapback4-core` | `fe93c1877be096ed7011da92327deb2b8006f08a` |

| xcframework file | SHA-256 |
|---|---|
| `ios-arm64-simulator/libsnapback4_device.a` | `2b5b33e8cabbd68d27a3c61fc88b3fdcea1d547a9703297f12fa0145951caea6` |
| `ios-arm64/libsnapback4_device.a` | `43e2780e8302cfb561c45f18e428032f77df6a8db1cd8ac6a915bb12ff02fc1a` |
| `ios-arm64-simulator/Headers/snapback4.h` | `5873cb92ec509aa199d52004da888f57545d1d0b148aad929649d89a17e9f5ab` |
| `ios-arm64/Headers/snapback4.h` | `5873cb92ec509aa199d52004da888f57545d1d0b148aad929649d89a17e9f5ab` |
| `ios-arm64-simulator/Headers/module.modulemap` | `da9d1aaa9f3574cc0f0bc917a680c3574b954dd6f85b3c6d68d33be720cb3329` |
| `ios-arm64/Headers/module.modulemap` | `da9d1aaa9f3574cc0f0bc917a680c3574b954dd6f85b3c6d68d33be720cb3329` |
| `Info.plist` | `20038f99c8c5db5438234379bf35ce34dc2b9b148dc83452bcff362397d85d0d` |

The Expo integrity changed from phase 1’s `sha512-yH1Ho6zhujUsi7uyF5iawUk2DaunFE9ewCrVenR8lHDGmWLTFs2plKhaDEuzKz59+WMIK7GXL3dHZToeoUau+Q==` to `sha512-PtZPvTcF7FtLy+RMMyWgsekPuW9igYqwzAS8QC0SFnCi1k5Rwm2i/Sx6A9JrdrsoF/JL0IeOQRU6+SU4yxKZTA==`. Core Store::prepare no longer creates _effect_keys; first Tx::effect_once does, inside its transaction. Both native slices rebuilt from core tree fe93c1877be096ed7011da92327deb2b8006f08a. Xcode also reversed AvailableLibraries order in Info.plist; sorted parsed plist values are identical. All other 14 packed files are byte-identical to phase 1.

## Every failed qualification/delivery attempt

1. Phase 1 push failed after 2.808 s: pre-push could not import `acorn` from root codegen. No retry or push in later phases.
2. Phase 2 merge initially conflicted in append-only `JOURNAL.md` (0.169 s). Both additions were retained unchanged and the merge committed.
3. Phase 2 dry run stopped after 710.694 s on four client fences: stale timeline marker, `_effect_keys` added to two old-store refusal cases, and canonical byte drift. No stage or publication was created.
4. Phase 3 first control probe failed at stored-schema equality (1.453 s); the second passed device compatibility but exposed the old-server `E_GENERATION` refusal (1.046 s). The supervisor ruling resolved the latter.
5. Phase 4 fence attempt 1 (8.579 s): new physical-byte snapshots preceded successful job-column migration and first-serve symlink setup. The logical/no-new-table checks were kept; raw-byte snapshots now bind the refused operation after explicit successful setup.
6. Phase 4 fence attempt 2 (4.527 s): the successful server left a WAL after SIGTERM. The fixture now checkpoints committed setup before comparing physical release/store bytes.
7. Phase 4 fence attempt 3 (4.600 s): stored Rust field order differs from canonical wire key order. The exact stored-schema pin now derives only the documented string changes from the published encoding, and its parsed value must equal the complete new backend pin.

The fourth fence attempt passed, followed by the green full suite. No failed native build, native witness, signing, packing, consumer proof or npm publish attempt occurred in phase 4. Each JSON timing record links its complete log.

## Timed attempts

| Attempt | Seconds | Exit | Evidence |
|---|---:|---:|---|
| bun-install-after-bump | 0.069 | 0 | [record](../20260924-expo-0.4.0/bun-install-after-bump.json) |
| bun-install | 0.778 | 0 | [record](../20260924-expo-0.4.0/bun-install.json) |
| cargo-build | 16.973 | 0 | [record](../20260924-expo-0.4.0/cargo-build.json) |
| chat-backend-check | 0.015 | 0 | [record](../20260924-expo-0.4.0/chat-backend-check.json) |
| checkout | 9.158 | recorded | [record](../20260924-expo-0.4.0/checkout.json) |
| client-package-build | 0.971 | 0 | [record](../20260924-expo-0.4.0/client-package-build.json) |
| expo-release-build | 65.349 | 0 | [record](../20260924-expo-0.4.0/expo-release-build.json) |
| native-witness | 23.981 | 0 | [record](../20260924-expo-0.4.0/native-witness.json) |
| npm-pack | 0.916 | 0 | [record](../20260924-expo-0.4.0/npm-pack.json) |
| pack-verification | 0.048 | 0 | [record](../20260924-expo-0.4.0/pack-verification.json) |
| simulator-prepare | 33.657 | 0 | [record](../20260924-expo-0.4.0/simulator-prepare.json) |
| simulator-shutdown | 3.175 | 0 | [record](../20260924-expo-0.4.0/simulator-shutdown.json) |
| version-bump | 0.001 | recorded | [record](../20260924-expo-0.4.0/version-bump.json) |
| version-commit | 0.081 | 0 | [record](../20260924-expo-0.4.0/version-commit.json) |
| version-mismatch-test | 55.763 | 0 | [record](../20260924-expo-0.4.0/version-mismatch-test.json) |
| wasm-build | 20.752 | 0 | [record](../20260924-expo-0.4.0/wasm-build.json) |
| xcframework-build | 79.837 | 0 | [record](../20260924-expo-0.4.0/xcframework-build.json) |
| capability-free-before-pin-2 | 1.046 | 1 | [record](./capability-free-before-pin-2.json) |
| capability-free-before-pin | 1.453 | 1 | [record](./capability-free-before-pin.json) |
| fetch | 1.732 | 0 | [record](./fetch.json) |
| merge-commit | 0.063 | 0 | [record](./merge-commit.json) |
| merge-main | 0.169 | 1 | [record](./merge-main.json) |
| phase4-build | 3.208 | 0 | [record](./phase4-build.json) |
| phase4-canonical-pin | 2.455 | 0 | [record](./phase4-canonical-pin.json) |
| phase4-core-device | 253.494 | 0 | [record](./phase4-core-device.json) |
| phase4-expo-pack | 2.803 | 0 | [record](./phase4-expo-pack.json) |
| phase4-expo-publish | 9.247 | 0 | [record](./phase4-expo-publish.json) |
| phase4-expo-registry-wait | 247.249 | 0 | [record](./phase4-expo-registry-wait.json) |
| phase4-expo-release | 29.515 | 0 | [record](./phase4-expo-release.json) |
| phase4-expo-verify | 0.255 | 0 | [record](./phase4-expo-verify.json) |
| phase4-fences-2 | 4.527 | 1 | [record](./phase4-fences-2.json) |
| phase4-fences-3 | 4.600 | 1 | [record](./phase4-fences-3.json) |
| phase4-fences-4 | 3.351 | 0 | [record](./phase4-fences-4.json) |
| phase4-fences | 8.579 | 1 | [record](./phase4-fences.json) |
| phase4-native-witness | 30.298 | 0 | [record](./phase4-native-witness.json) |
| phase4-npm-identity | 0.559 | 0 | [record](./phase4-npm-identity.json) |
| phase4-publication-dry-run | 764.805 | 0 | [record](./phase4-publication-dry-run.json) |
| phase4-publication-resume | 399.774 | 0 | [record](./phase4-publication-resume.json) |
| phase4-registry-cli | 1.868 | 0 | [record](./phase4-registry-cli.json) |
| phase4-registry-expo | 1.785 | 0 | [record](./phase4-registry-expo.json) |
| phase4-simulator-install | 16.940 | 0 | [record](./phase4-simulator-install.json) |
| phase4-work-intent | 21.491 | 0 | [record](./phase4-work-intent.json) |
| phase4-xcframework | 65.467 | 0 | [record](./phase4-xcframework.json) |
| publication-dry-run | 710.694 | 1 | [record](./publication-dry-run.json) |

Native evidence covers the dedicated iOS simulator; no new physical-device or Android qualification is claimed.
