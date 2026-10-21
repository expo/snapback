# Wasm codec census treats asset test serialization as web code

**Status:** Open
**Date:** 2026-10-21
**Scope:** Snapback 4 client qualification / wasm source census
**Owner:** Unassigned (outside SEC5 security-analysis implementation)

SEC5's complete client pool found two failures in `wasm-codec-census.test.mjs`:
`assets/test_cases.rs:539` calls `serde_json::to_value(&a)` in an asset test,
but the web-source census counts that test-only file as reachable product code.
Its mutation test then expects one introduced census error and sees two.

The asset test file is byte-identical to workstream baseline `7f748cf368`:
hash evidence is in `snapback4/reports/20261021-sec5/inherited-failures.json`.
No SEC5 file changes that test or the wasm codec. Preserve the initial red;
do not qualify the pool as green from unrelated scoped reruns.

Repair the source-reachability census to follow test-only module exclusion,
with a regression showing production code remains in the census. Do not add
a blanket filename exemption or remove the serialization regression.
