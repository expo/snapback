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
