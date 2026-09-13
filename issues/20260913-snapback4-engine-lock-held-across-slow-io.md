# Snapback 4: the engine mutex is held across Argon2 and asset disk I/O

Status: Open
Priority: P1
Date: 2026-09-13
Systems: HTTP host, identity, assets
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)
Related: [LLP 3000.002](../llp/3000.002-end-to-end-resource-bounds.research.md); overlaps [S04 auth lock](20260913-snapback4-auth-engine-lock-and-rate-limits.md) and [S08 upload lock](20260913-snapback4-upload-holds-engine-lock.md). Unique remainder: unauthenticated POST bodies (including `/assets`) are read up to the path ceiling before `principal_of`, and `sweep_assets` unlinks under the lock.

## Problem and reproduction

Every query, mutation, snapshot page, job chunk, and `/changes` wake serializes on `Shared.engine`. Two request paths still do slow work while holding that mutex:

1. `POST /auth/signup` and `POST /auth/login` run Argon2id inside `identity::signup` / `login` with the engine locked. A probe on this tree: warmup `POST /q/ping` 8 ms; overlapping signup + ping, ping 237 ms ≈ signup 240 ms.
2. `POST /assets` calls `store_asset` under the same lock. That function sniffs and `fs::write`s up to 64 MiB, then `rename`, then `record_asset`. `sweep_assets` also unlinks files under the lock.

Slow socket writes no longer hold the lock (closed R18). These paths still stall the instance.

Separately, every POST is read up to its path ceiling **before** `principal_of`. Unauthenticated `POST /assets` of 8 MiB returned 401 after buffering. Combined with thread-per-request, that is a cheap RAM/thread stall on a release host.

## Implementation locations

- [snapback4/crates/snapback4/src/serve.rs](../snapback4/crates/snapback4/src/serve.rs) (auth handler ~579, POST body read ~324)
- [snapback4/crates/snapback4/src/assets.rs](../snapback4/crates/snapback4/src/assets.rs) (`upload`)
- [snapback4/crates/snapback4-core/src/engine/mod.rs](../snapback4/crates/snapback4-core/src/engine/mod.rs) (`store_asset`, `sweep_assets`)
- [snapback4/crates/snapback4-core/src/identity.rs](../snapback4/crates/snapback4-core/src/identity.rs)

## Suggestion

Hash passwords and write staging blobs without the engine guard; take the mutex only around the SQLite record. Reject unauthenticated `/assets` from headers before reading the body. Keep the 64 MiB ceiling only after a live principal.
