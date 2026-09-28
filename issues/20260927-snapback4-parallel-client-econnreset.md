# Snapback 4: direct fixture fetches intermittently reset during parallel client tests

Status: Open
Date: 2026-09-27
Scope: Snapback 4 client test transport and local dev-server fixtures
Observed by: lane DC round 3, implementation head `5f2af6524`
Classification: environmental transport failure; root cause unconfirmed

The sole full suite's parallel client phase had three `TypeError: fetch failed`
errors, each caused by `read ECONNRESET` (errno -104), before the affected
assertions. These are direct fixture HTTP calls:

- `local: global logout follows another tab's held rotation and revokes external siblings`:
  `app-global.test.mjs:12`, reached from line 48 through `until`.
- `wire stamps successes and refusals on sync, changes, query, mutation and session endpoints`:
  `server-clock-wire.test.mjs:18`, reached from line 47.
- `R2 item 1: changes with a foreign identity returns before its production wait`:
  `store-reset-reconnect.test.mjs:58`, reached from line 97.

Observed on Linux expo-build-1000 with Node 24.13.1, Bun 1.3.14 and Rust
1.97.0. The suite selected concurrent client files at load 13.28 across 96
CPUs. No production retry, fixture assertion or timeout was changed.
`app-server.mjs` retries `UND_ERR_SOCKET`, but these failures carry the
different `ECONNRESET` cause. Investigate whether a stale pooled socket,
server behavior or another shared-run condition explains the resets before
adding broader retries.

Reproduction attempt from `snapback4/`, with the pinned tools on PATH:

```sh
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0
ulimit -n 65536
scripts/test.sh
```

This is intermittent evidence, not a deterministic reproducer. An isolated
follow-up passed all 29 tests in 58,951.281469 ms:

```sh
node --test --test-concurrency=1 packages/snapback4/test/app-global.test.mjs packages/snapback4/test/server-clock-wire.test.mjs packages/snapback4/test/store-reset-reconnect.test.mjs
```

Before the full reporter printed its details, 12 isolated runs of the entire
`app-global.test.mjs` passed on current source and another 12 passed with the
package rebuilt from merged baseline `981699084`. The app/auth/native-adapter
and fixture source is unchanged, and its backend has no delivery bindings.
Those passes do not prove the shared-run issue repaired. No second full suite
was run. One other client failure belonged to DC's response fixture and was
fixed separately in `8e8cb4fc6`; the complete delivery retest passed 88/88.

Evidence remains in `snapback4/target/lane-dc-round3/full-suite.log`,
`transport-retest.log`, `global-current-repeat.log` and
`global-baseline-repeat.log`. Exact full-suite result and all failure
classifications: [DC round-3 report](../snapback4/reports/20260927-dc-delivery-client/ROUND3.md).
