# Dev adoption legacy-poll timing exceeds 500 ms in the concurrent client suite

Date: 2026-09-27
Status: Open
Scope: Snapback 4 dev schema watching / client test scheduling
Found by: lane DC, round 10

The full `snapback4/scripts/test.sh` run on expo-build-1000 fails
`packages/snapback4/test/ephemeral-adoption.test.mjs:18`,
“durable-only dev adoption answers a held legacy poll with the new generation
within 500 ms”. Its generation assertion passes (generation 2), but the timing
assertion at line 28 observes **1312.982974 ms**, above **500 ms**.

This test starts `snapback4 dev`, holds a direct `defaultFetch` `/changes`
request until its heartbeat, edits the Quarry schema, and reads that response.
It constructs no delivery queue or device and declares no delivery binding.
The test, helper, fetch adapter and executed server/compiler paths are
unchanged from merged round-10 baseline `59c730083`. The round's Rust edits
are confined to delivery metadata helpers, not used here. Attribution for the
round: **baseline timing failure**, not a delivery-policy regression.

The unchanged isolated test passes. An additional module-load instrumentation
that only prints `elapsed` before the existing assertion measures
**368.604649 ms**, generation **2**, and passes. These isolated passes do not
clear the full-run failure. Shared-run scheduling/contention is plausible;
the source of the extra latency is unconfirmed. No deadline, assertion,
production watcher, fetch behavior or retry was changed to hide it.

Reproduce from `snapback4/` with the worktree's pinned Node 24.13.1 on PATH:

```sh
node --test --test-name-pattern='durable-only dev adoption' packages/snapback4/test/ephemeral-adoption.test.mjs
```

The isolated command currently passes; the observed failure is in the full
concurrent client phase. Attempt that context with `bash scripts/test.sh` or
the equivalent ordinary-client file set/concurrency from that script. The
lane ran the full script once only. Raw full output and isolated timing
records are retained under `snapback4/target/lane-dc-round10/`.

Follow-up: distinguish watcher/adoption/waiter latency from test-process
scheduling under load, then fix the responsible path or fixture without
weakening its behavioral generation assertion or silently raising the limit.

## 2026-09-28 — SS round 8: mounted wasm ephemeral-interest timing

The single full-suite run on `sb4-intent/ss-sync-at-scale`, after merging main
in `1366c700c`, reports `== 1 failure(s) in 1422 s` (exit 1, client tests).
Its only failure is the related test at `ephemeral-adoption.test.mjs:66`,
“wasm: adoption replaces mounted ephemeral interests, including removal”.
The new viewing row reached the watch, but line 92's unchanged
`performance.now() - began <= 500` assertion failed. The **whole test** took
2,466.604486 ms; the failed interval itself was not logged. Do not substitute
the whole-test duration for that interval.

Attribution: **baseline timing failure**, with environmental scheduling a
possible cause, not a proven one. The test/server/wasm and exercised adoption
paths are unchanged by SS round 8. This fixture uses `memoryPersistence()`
and the default device: neither the changed IndexedDB quiescence path nor
Worker cold-restore handling runs. The added cold-restore helper is constructed
but never invoked, because this device has no cold-restore capability.

Three interleaved isolated runs each against the merged pre-round SDK and
current SDK pass the original 500 ms assertion. Elapsed logging immediately
before that assertion measures baseline **24.48, 35.53, 33.83 ms**, current
**33.35, 30.11, 49.83 ms**. These controls do not reproduce or clear the full-run
failure, and do not identify which scheduling/server/client wait took longer.
No assertion, timeout or product path was changed to mask it.

Reproduce the focused case from `snapback4/` with the pinned toolchain:

```sh
node --test --test-name-pattern='^wasm: adoption replaces mounted ephemeral interests, including removal$' packages/snapback4/test/ephemeral-adoption.test.mjs
```

For the observed context use `scripts/test.sh`'s ordinary concurrent client
file set; SS did not rerun the full suite. Retained logs, baseline/control
construction and timings are in `snapback4/reports/20260927-ss-sync-scale/`
under `round8-full-suite.log.gz`, `round8-adoption-controls.py`,
`round8-adoption-controls.json` and `round8-adoption-*.log.gz`.
