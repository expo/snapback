# TUS PATCH holds the global writer across 8 MiB durable disk I/O

**Status:** Open
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
