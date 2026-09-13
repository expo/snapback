# competitive-checkpoint fresh-prime boot panics: projection rebuild on the async worker

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 3
**Confidence:** 5
**Systems:** Storage, Server, Demos
**Date:** 2026-08-16
**Found by:** the sbs0816c fresh-prime demo boot sweep (30-backend corpus, run
at main `26d37a5a0` after the governance dev-mint and `_id` visibility fixes
landed)

## Problem

`demos/competitive-checkpoint/snapback` is the only demo backend (of 30) whose
freshly primed artifacts fail to reach readiness. The server exits 101 before
readiness with the LLP 0032 L7 blocking-offload assertion:

```
thread 'main' (43102921) panicked at crates/snapback/src/storage/projection_rebuild.rs:248:9:
a projection rebuild would block a tokio async worker; route it through the
blocking offload helpers (LLP 0032 L7)
```

This is unrelated to the two fresh-prime boot blockers fixed today (governance
carrier `26d37a5a0`, `_id` membership visibility `256c589e3`): the other 29
backends — 20 dev-mode and 10 sessions-mode, governed and ungoverned — reach
readiness from unmodified fresh-primed artifacts with no workaround. It likely
predates today and was masked while fresh primes could not boot at all.

## Reproduction

```
SNAPBACK_OUTBOUND_ACTIONS=1 volta run --node 24.18.0 \
  node packages/snapback-codegen/index.mjs demos/competitive-checkpoint/snapback
# compose the fresh schema.manifest.json + functions.manifest.json into the
# ordinary mode-0600 { formatVersion: 1, schema, functions } cold-start
# carrier and launch target/debug/snapback via demos/_kit/server-process.mjs
# → exit 101, panic above
```

## Expected

Whatever startup path triggers a projection rebuild for this demo's shape must
route through the LLP 0032 blocking offload helpers (the assertion's own
remediation) — or the rebuild must not run on the async worker at startup.
The panic is the debug-assert catching a real misrouting; the fix belongs to
the storage/projection owner, not the demo.
