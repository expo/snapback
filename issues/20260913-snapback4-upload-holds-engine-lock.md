# Snapback 4: Asset uploads write to disk while holding the engine mutex

Status: Open
Priority: P1
Observed: 2026-09-13
Review finding: S08
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Related: [security review](../llp/reviews/3000-security-review-20260913.md), [S04](./20260913-snapback4-auth-engine-lock-and-rate-limits.md)

## Problem and reproduction

`POST /assets` reads up to 64 MiB, then:

```
shared.engine.lock().unwrap().store_asset(...)
```

`store_asset` sniffs, `create_dir_all`, `write` of the full bytes, `rename`, and the `_assets` insert. The same mutex serializes every query, mutation, sync, poll and auth call.

A single authenticated client (or a guest, when guests exist) can stall the process for the duration of a 64 MiB disk write, and can pipeline uploads. There is no per-principal upload quota or concurrency cap.

## Acceptance

- Release the engine mutex for the filesystem write; hold it only for sniff metadata + the catalog insert (or use a dedicated admission lock).
- Bound concurrent in-flight uploads.
- A slow or large upload must not delay an unrelated small query beyond ordinary sqlite contention.

## Implementation locations

- [crates/snapback4/src/assets.rs](../snapback4/crates/snapback4/src/assets.rs)
- [crates/snapback4-core/src/engine/mod.rs](../snapback4/crates/snapback4-core/src/engine/mod.rs) (`store_asset`)
