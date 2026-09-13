# Asset finalize buffers whole objects in memory and runs media CPU inside the single global writer lock

**Opened:** 2026-08-08 · **Severity:** P2 (one large upload stalls the entire instance; ~2× RSS spikes) · **Area:** assets / local store


## Triage (2026-08-26 leftover sweep)

Still open for S3 copy + CPU outside the writer lock. Local FS now streams (`crates/snapback-services/src/assets_store.rs`). S3 has no `copy_from_staging` override; the trait default still `read`→`Vec`→`put` (`crates/snapback-kernel/src/assets_store.rs`).

## What

`crates/snapback/src/local.rs:10105-10145, 10192-10196, 10341, 10401`; `crates/snapback/src/assets_store.rs:59`
(`read → Vec<u8>`).

Finalize reads the full staging object into a `Vec<u8>` for strip/inspect, again
for Phase B publish, and again for each variant render:

```rust
let canonical_bytes = store.read(canonical.object.as_ref())?;
store.put_blob_idempotent(&publication.planned_key, &canonical_bytes)?;
```

All of this — plus `canonicalize_strip` / `inspect_image` / `render_variant`
(each budgeted `step_time_budget_ms: 10_000`, `max_alloc` up to ~400 MB) — runs
inside `with_snapback`'s single global `LocalSnapback` mutex (`server.rs:347`).

## Failure scenario

An intent with a large `accept.max_bytes` (author-declared; quota allows up to
~4 GiB) lets a client upload a multi-GB video. Finalize buffers it 2–3×
(peak RSS ~2× asset size) and one 50-megapixel upload with several required
variants can hold the global writer for tens of seconds; every other query,
mutation, and delivery on the instance queues behind it. On-demand width
materialization (`?width=N`) does the same on the read path.

## Fix

Two moves, either helps: (1) add a streaming `copy_from_staging(key) → blob` to
the `AssetStore` trait (streaming `hash`/`read_chunk` already exist beside it)
and stream strip/inspect inputs; (2) render/canonicalize into scratch **outside**
the lock — the write-ahead publication protocol already tolerates re-drives — and
take the lock only for the transactional phases. At minimum, enforce a global
ceiling on `accept.max_bytes` for the buffered paths.

## Confidence

High on mechanics. The single-writer design is deliberate (@ref LLP 0059), but
that the CPU/IO-heavy phase happens *inside* the lock rather than staging renders
outside it reads as an unexamined consequence, not a decision.

## Progress (2026-08-08 Lane B)
Streaming copy_from_staging added and used for primary publication; buffered image/video paths now enforce a 256 MiB ceiling at admission and finalize. The larger move of render/canonicalize CPU OUTSIDE the global writer lock is DEFERRED (it crosses the LLP 0044 write-ahead/re-drive choreography; too risky for a fix lane) and is the natural home for LLP 0199 "background services do CPU/network preparation outside the global writer." Keep open for that refactor.

## Remainder (2026-08-12 review) — S3 never got the streaming copy

Local FS overrides `copy_from_staging` with a streaming copy (`crates/snapback/src/assets_store.rs:283-300`). S3 does not (`crates/snapback/src/assets_s3.rs` has no override), so Phase B uses the trait default: `read` → `Vec<u8>` → `put_blob_idempotent` (`crates/snapback/src/assets_store.rs:86-96`). S3 `read` is a full GET. A multi-hundred-MB video still peaks at ~1× object RSS on the unlocked prepare **and** again on the put. The 256 MiB buffered-finalizer ceiling only applies when a location policy is set.

*Fix:* S3 server-side copy (or streamed GET→PUT) for `copy_from_staging`. Keep the hash-verify step.
