# TUS PATCH holds the global writer across 8 MiB durable disk I/O

**Status:** Closed
**Impact:** 3
**Urgency:** 2
**Ease:** 3
**Confidence:** 5
**Systems:** Assets, Local server lifecycle, Performance
**Date:** 2026-08-15
**Governing:** LLP 0044 (TUS transfer), LLP 0059 (single writer), LLP 0199
**Related:** `issues/20260808-assets-finalize-memory-and-cpu-under-global-lock.md`
(finalize CPU/buffering and S3 `copy_from_staging`; **not** the TUS
transfer path)
**Found while:** Whole-codebase security/correctness review (2026-08-15)

## Problem

```266:275:src/server/asset_routes.rs
    let attempt = with_snapback(&state, move |snapback| {
        ...
        snapback.asset_tus_patch(&authority, &id, offset, body.as_ref(), checksum)
    })
```

```src/local.rs``` `asset_tus_patch` then `append_staging` +
`attempt_tus_patch` under that same lock. `append_staging`
(`src/assets_store.rs:245-261`) seek + `write_all` + `flush` +
`sync_data`. `ASSET_MAX_CHUNK_BYTES` is 8 MiB (`src/assets.rs`).

The request body is already fully buffered *before* the lock
(`asset_routes.rs:222-226`). The lock then does the durable disk write.

Every other query, mutation, delivery, cron claim, and job claim
serializes behind one client's `fdatasync`. A few concurrent uploads
(or a slow disk) stall the instance.

The write-ahead comment on `asset_tus_patch` already allows “write then
record”; the bytes do not need `LocalSnapback`.

This is a sibling of the finalize ticket, not a duplicate: that ticket's
remainder is S3 `copy_from_staging` and moving finalize CPU off the
writer. TUS transfer is still fully lock-held.

## Desired outcome

Write+sync the staging object outside `with_snapback`. Take the writer
only to CAS the attempt offset/checksum (and refuse if the offset
moved). Same crash story as today's write-ahead: a durable append
without a recorded offset is a retryable incomplete PATCH.

## Acceptance

- An 8 MiB TUS PATCH does not hold `LocalSnapback` across `write_all` /
  `sync_data`.
- Concurrent query/mutate latency is not gated on that disk sync.
- Offset CAS still refuses a stale `Upload-Offset`.
- Finalize-lock remainder stays on the existing ticket.

## Resolution (2026-08-15)

`src/local.rs` now splits TUS PATCH into an owned preflight ticket, an unlocked
durable append, and a writer-held commit. `src/storage/asset_attempts.rs`
performs the offset/checksum comparison again inside the storage transaction.
`src/server/asset_routes.rs` runs the blocking filesystem append on Tokio's
blocking pool between the two `with_snapback` windows. A bounded striped gate
in `src/assets_store.rs`, shared by `AppState` in `src/admin.rs`, serializes
same-attempt requests across that unlocked window without holding Local. Its
owned guard travels through the unabortable blocking task, so cancellation of
the awaiting HTTP future cannot expose a still-running append to a competitor.
`src/assets.rs` owns the continuity ticket and byte-store handle.

Coverage in `src/local/tests.rs` proves moved-offset refusal, checksum-grade
CAS, stale-offset preflight refusal, and retry overwrite of an unacknowledged
tail. `src/server/tests.rs` guards the production route's ordering and exact
two-writer-window shape. The finalize path was not changed.

Focused proof, with no `RUST_MIN_STACK` or `DYLD_FRAMEWORK_PATH` override:

```text
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 2700 filtered out; finished in 0.12s
```

The full library run reached its summary after the rehearsal stack fix:

```text
test result: FAILED. 2696 passed; 5 failed; 2 ignored; 0 measured; 0 filtered out; finished in 61.89s
```

All five failures reproduced individually against exact merge-base
`415d56071fe2d99162972e0f3ecb9b433b8f1b51`; none is in the asset transfer
path. `./ref-check --verbose` also passed with 257 LLP documents, 5,434 refs,
and zero errors or unchecked references.
