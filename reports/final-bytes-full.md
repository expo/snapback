# REPORT-bytes — lane E

Base: `3062777abf9f543d82e44616c595adaa606f1d8f`. No commit, stash, or branch operation performed.

## Implemented

- E1: `snapback2/packages/snapback2/build.mjs` derives the client dependency graph with esbuild, probes the adapter imports, then emits live ESM re-exports through `snapback2/client`. Private generated `__client<N>_<name>` bindings carry only the symbols the adapters actually need. They are absent from the public declarations. Client source and `package.json` exports are unchanged. The existing private image-runtime entry continues to preserve nominal image/error identity.
- E1: source maps show the actual range-store, Twin and OfflineRuntime implementations only in `client.mjs`, across the nine adapter/test entries tested. Constructor identity is equal between client and SQLite carrier/test entry. Every package export resolves under `browser`, `react-native`, and `node`; `snapback2/react` selects the native arm only under the native condition, and every arm resolves the same client URL.
- E2: `snapback2/scripts/measure.mjs` records all four byte fields, actual toolchain, and a timed byte-measurement step. Each field compares with the last preceding record containing a valid value; >1% fails, exactly 1% passes. Missing measurements fail. The loop requires Node 24.18.0, esbuild 0.25.9, gzip level 9.
- E2: `build.mjs --measure-twin` now appends its complete-runtime record, date and full HEAD SHA to `snapback2/metrics/twin.jsonl` before enforcing the ceiling, including failed measurements. Five roots, inputs, minification settings, and ceiling are unchanged.
- E3: `rules/NOT-DOING.md` now has the frozen ceiling paragraph and one historical ceiling line. The search move's on/off/build/resource content remains. The rest of NOT-DOING is unchanged. Size: 13,791 → 10,197 bytes.
- E3: `llp/1012-local-first-v1.spec.md` has a dated Revised entry and the one-line freeze in the allocation section.
- Necessary scope deviation: `snapback2/crates/snapback2/tests/common/mod.rs` copies the package manifest into isolated package snapshots. Their former dist-only snapshots could not resolve the new package self-imports. This is a test-helper edit, not a client source change. Existing journey/init/selection tests failed with ERR_MODULE_NOT_FOUND before this repair and pass after it.
- Evidence: append-only loop/twin records and this requested report. No template config change was needed.

## Per-entry gzip bytes

Method: rebuild `dist/` with Node v24.18.0 and esbuild 0.25.9; `gzipSync(bytes, { level: 9 })`, matching the canonical Node ruler and the brief's per-entry base numbers. Every top-level `dist/*.mjs` follows.

| Entry | Base | Final | Delta |
|---|---:|---:|---:|
| client-observed-test.mjs | 15,220 | 380 | -14,840 |
| client.mjs | 109,753 | 110,453 | +700 |
| compiler-core.mjs | 62,904 | 62,904 | +0 |
| compiler.mjs | 1,117 | 1,117 | +0 |
| expo.mjs | 40,517 | 8,865 | -31,652 |
| image-runtime.mjs | 22,018 | 22,018 | +0 |
| index.mjs | 7,932 | 7,932 | +0 |
| react-core.mjs | 4,703 | 2,436 | -2,267 |
| react-native.mjs | 2,916 | 2,865 | -51 |
| react.mjs | 37,394 | 5,367 | -32,027 |
| sqlite-test.mjs | 107,516 | 9,877 | -97,639 |
| test-runner.mjs | 156,382 | 5,159 | -151,223 |
| test.mjs | 156,383 | 5,162 | -151,221 |
| witness-test.mjs | 6,869 | 6,869 | +0 |

React is below 12,000 and Expo below 16,000. The client grows 700 bytes (+0.64%) while the adapters lose their private runtime copies. `index.mjs` is intentionally built as before, preserving its independent authoring surface.

## Complete local runtime

| | Minified | gzip level 9 | Ceiling | Target |
|---|---:|---:|---:|---:|
| Untouched base | 258,088 | 84,080 | 84,000 | 80,000 |
| Final | 258,088 | 84,080 | 84,000 | 80,000 |

Both before and after exit 1 with:

```text
Error: twin exceeds 84000 gzip bytes: 84080
```

The brief expected 83,999. This machine reproduces **84,080 on the untouched base**, with Node v24.18.0/esbuild 0.25.9/gzip 9. No source module was edited to reduce the runtime, no measurement root/payload was omitted, and no ceiling was raised. The 80-byte inherited overage is unresolved; a green overall measurement claim is not made. Base per-entry numbers do reproduce the brief exactly.

## Exact external routing

Existing browser/native external specifiers remain:

```text
expo
react
react-native
expo-file-system
expo/fetch
expo-video
expo-sqlite
expo-secure-store
snapback2/client
snapback2/react-core
snapback2/expo
snapback2/react-native
snapback2/expo/witness
```

The Node test entries retain `expo-file-system` and `expo/fetch` and now externalize `snapback2/client`; relative client/react-core imports use the existing external-client resolver. The shared image-runtime imports retain their existing relative paths (`./image-runtime.mjs`, or `../image-runtime.mjs` in `expo/witness`). The compiler's external `typescript` is unchanged.

In addition to direct `src/client.js` → `snapback2/client`, these actual adapter dependency crossings forward through generated private exports from the same `snapback2/client` module (derived from the final source maps; paths relative to `snapback2/`):

```text
packages/evaluator/src/certificate-identity.ts
packages/evaluator/src/runner.ts
packages/evaluator/src/search-runtime.ts
packages/evaluator/src/store.ts
packages/evaluator/src/value-runtime.ts
packages/snapback2/src/api.ts
packages/snapback2/src/client-assets.ts
packages/snapback2/src/client-inbox.ts
packages/snapback2/src/client-items.ts
packages/snapback2/src/client-observed.ts
packages/snapback2/src/client-sessions.ts
packages/snapback2/src/drain.ts
packages/snapback2/src/offline-protocol.ts
packages/snapback2/src/offline.ts
packages/snapback2/src/snapshot.ts
packages/snapback2/src/store/byte-cache.ts
packages/snapback2/src/store/inbox.ts
packages/snapback2/src/store/outbox.ts
packages/snapback2/src/store/range-store.ts
packages/snapback2/src/token-store.ts
packages/snapback2/src/twin.ts
packages/snapback2/src/types.ts
```

This is derived at build time, not a new checked-in registry. Subsequent source imports into the client graph are redirected by the same mechanism. Lane A1's future internal entry must be added to the existing adapter entry list when that entry is introduced; no runtime source re-export edits are needed for E1.

## Reproductions and tests

- New bundle regression added to existing `build.mjs --self-test`: nine entry source-map audits, actual constructor identity for three runtime classes, React/Expo byte targets, and all package export paths under three conditions. Running it against the rebuilt **base dist** fails:

```text
AssertionError [ERR_ASSERTION]: react duplicates the client runtime
```

- The final bundle self-test passes:

```text
client bundle self-test ok: 9 entries share one range store, twin and offline runtime; 3 export conditions resolve
```

- New scenarios in existing `measure.mjs --self-test`: exactly 1% growth, >1% on all four fields without fail-fast, missing intermediate fields, newest available per-field baseline, missing current bytes, and initial baselines. Existing scoring/failure/inode tests remain. Output:

```text
measure: expected self-test failure
measure: simulated utimesSync EPERM
measure self-test ok
```

- Runtime append check compares the new final JSONL line with stdout, validates date/full SHA, and confirms the failed ceiling result is still recorded:

```text
runtime append test ok: sha/date and 84080 gzip bytes persisted despite the inherited ceiling failure
```

- Before E2, the last loop record had none of the four byte fields; the last twin record was dated 2026-09-05. After E2 all four fields appear and repeated measurements append current records. No historical lines were rewritten.

- Package command `env -u SNAPBACK_URL node --test --test-timeout=120000 --test-concurrency=8 tests/` exits 0:

```text
ℹ tests 492
ℹ pass 491
ℹ fail 0
ℹ skipped 1
```

- To include every TypeScript test file explicitly, `node --test --test-timeout=120000 --test-concurrency=8 tests/*.test.ts` reported:

```text
ℹ tests 936
ℹ pass 935
ℹ fail 1
ℹ skipped 0
```

Both previously failing recovery/revocation tests pass in this run. The one failure is `React Strict Mode keeps the active handle and closes replaced/unmounted scopes` (`channels.test.ts:230`, `first.closed` still false); its isolated rerun exits 0. This broader run is not claimed green.

- The explicit blocking package list on the second full run reported 843 tests, 842 passed, 1 failed. Its hot-successor recovery test passed in isolation (10 tests, 10 passed, 0 failed); its initial concurrent run had also timed out the channel revocation test, which reproduced on the base build (17 tests, 16 passed, 1 failed) and passed in the second full run. These timing failures are reported, not silently counted as passes.
- After the package-snapshot repair, the final `scripts/test.sh` run reported:

```text
Summary [  54.541s] 892 tests run: 890 passed, 2 failed, 4 skipped
Compiler checks: 227 passed, 0 failed
```

The two Rust failures are `stop_during_generation_update_is_bounded_and_cannot_recreate_owner_state` and `owner_cases::wire_lifecycle::chat_owner_wire_sse_channels_and_successors`. Both end in E_OWNER_STOP_TIMEOUT. `/bin/ps` itself returns `operation not permitted` in this sandbox. The orchestrator must rerun outside it. Workspace doctests passed (0 doctests in each of two targets). Evaluator output: `{"visibilityChecks":2,"passed":2,"failed":0}` and `{"cases":238,"passed":238,"serverOnly":25,"failed":0,"corruptionPath":"replay-mismatch"}`. The third full run retained the same one package timing failure and two owner-stop failures. No additional fix rounds are claimed.

## Template consumers and browser witness

- Both projects were scaffolded from this worktree with the built binary and local compiler/templates. Installed the packed local `snapback2-0.0.19.tgz`, not the published SDK. npm cache was redirected to `/tmp/snapback-bytes-npm` because the default cache is unwritable in this sandbox.
- React chat `npx vite build` exit 0: `✓ built in 820ms`; generated application main chunk 633.11 kB / 200.36 kB gzip, with Vite's ordinary >500 kB advisory. No alias config was added.
- Expo chat `npx tsc --noEmit` exit 0, no diagnostics. No config edits.
- `scripts/witness-web.mjs` was run independently (test.sh does not invoke it). It exits 1 before any application witness step: Chrome launch ends in SIGABRT, with `Error: kill EPERM` during Playwright cleanup. Its JSON verdict is fail, one `witness` step. No browser behavior is claimed. Requires the orchestrator's outside-sandbox rerun.
- `measure.mjs`'s final installed tarball consumer smoke passes, including both React template bundles and the live query round trip; expected effects-only blocked chat receipt remains accepted by its existing policy.

## Final loop record

```json
{
  "at": "2026-09-08T23:24:14.583Z",
  "sha": "3062777ab",
  "client_gzip_bytes": 110453,
  "react_gzip_bytes": 5367,
  "expo_gzip_bytes": 8865,
  "runtime_gzip_bytes": 84080,
  "byte_toolchain": {
    "node": "v24.18.0",
    "esbuild": "0.25.9",
    "gzipLevel": 9
  },
  "consumer_smoke_s": 19.1,
  "check_project_s": 0.389,
  "boot_s": 0.136
}
```

`node scripts/measure.mjs --check` exits 1 only for `package_bytes_s`: the inherited 84,080-byte runtime exceeds the unchanged 84,000 ceiling. All four 1% comparisons and every timing/consumer check pass. Two loop records are appended; the first also records the unwritable default npm cache and a first doctor sample of 0.536 seconds, both resolved on the second run with a writable cache and warm executable.

## Limits and open questions

1. Resolve the 83,999 expected vs 84,080 measured base discrepancy, and the inherited ceiling failure. This lane deliberately does not edit runtime sources or relax the ruler.
2. Rerun owner-stop tests and Chrome witness outside the sandbox; inspect any recurring package timing failure under the orchestrator's conditions.
3. Private generated client exports are implementation bindings without declaration/API additions. A1's internal entry must join the adapter build list at integration.
4. `node scripts/caps.mjs` passes (all seven categories); NOT-DOING is shorter; source files touched are below 1,500 lines. LLP 1012 was already 1,687 lines and is covered by the existing cap baseline; only its requested metadata/freeze lines changed.

Raw logs and reproduction data remain at `/tmp/snapback-bytes-evidence/` on this machine. This report retains the decisive counts and outputs without requiring those temporary files.
