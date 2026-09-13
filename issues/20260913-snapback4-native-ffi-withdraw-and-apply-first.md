# Snapback 4: native FFI `withdraw` and default `apply first` undo replica work

Status: Open
Priority: P2
Date: 2026-09-13
Systems: `snapback4-device` C ABI, Exact2/C hosts; Expo `native.ts` avoids these
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)
Related: closed R10 (prediction restore) — `settle`/`admit` were fixed; these FFI ops were not

## Problem and reproduction

1. `withdraw` ignores the predicted keys, runs `predictions::restore` (all `_device_base` images, then delete the base), and commits. It does not `replay` the rest of the outbox. Two admitted predictions, then `withdraw` of the first, leaves the second in `_device_outbox` with its pending rows gone until a later `apply`/`settle`. Expo `createNativeClient` never calls `withdraw`; Exact2/C following the header would.

2. FFI `apply` defaults `first` to `true`. A continuation that omits `first` looks like a new first page: it `DELETE`s `_device_snapshot` and changes owner. Safer default is `false`. The C header does not mention `first`. Expo always passes `first` explicitly.

3. `sb4_open_reason` is a full mutating `Device::open`, then drop. Swift only calls it after `sb4_open` returned null; if the first open failed with `SQLITE_BUSY` and the second succeeds, the thrown reason is `{"ok": true}` and the store may already have been reset.

## Implementation locations

- [snapback4/crates/snapback4-device/src/native.rs](../snapback4/crates/snapback4-device/src/native.rs) (`withdraw`, `apply`)
- [snapback4/crates/snapback4-device/src/ffi.rs](../snapback4/crates/snapback4-device/src/ffi.rs)
- [snapback4/crates/snapback4-device/include/snapback4.h](../snapback4/crates/snapback4-device/include/snapback4.h)
- [snapback4/packages/snapback4-expo/ios/Snapback4Module.swift](../snapback4/packages/snapback4-expo/ios/Snapback4Module.swift)

## Suggestion

Restore-all then `predictions::replay` like `settle`, or restore only the named keys. Default `first` to false and document it on the header. Diagnose `open_reason` without `install_device`; never throw `{"ok": true}`.
