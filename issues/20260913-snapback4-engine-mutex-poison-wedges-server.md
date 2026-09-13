# Snapback 4: A poisoned engine mutex wedges the server until restart

Status: Open
Severity: major
Priority: P1
Area: correctness
Observed: 2026-09-13
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Review provenance: Snapback4 comprehensive-review synthesis (2026-09-13 child review)

## Problem and reproduction

Every request thread locks the process-wide engine with `.lock().unwrap()`
([serve.rs](../snapback4/crates/snapback4/src/serve.rs):98,100-108,145,151,162,187,279,503,
[assets.rs](../snapback4/crates/snapback4/src/assets.rs):25,43), and
[serve.rs](../snapback4/crates/snapback4/src/serve.rs):79-82 spawns one OS
thread per request. A `Mutex` that observes a panic while locked stays
poisoned, and every later `.lock().unwrap()` panics in turn. So a single
panicking request (e.g. any `expect("canonical")` site in
`crates/snapback4-core/src/partition.rs`:217,500,550,576,594, reached under
the engine lock) permanently wedges all queries, mutations, sync, auth and
polls until the process is restarted. This is distinct from transient
lock contention (covered by `20260913-snapback4-engine-lock-held-across-slow-io`
and `20260913-snapback4-upload-holds-engine-lock`): a poisoned mutex never
recovers.

Reasoning: `cargo build` succeeds with these `unwrap()`s; no
`try_lock`/`lock().unwrap_or_else(|e| e.into_inner())` recovery path exists,
and there is no watchdog that restarts a wedged server.

## Implementation locations

- [crates/snapback4/src/serve.rs](../snapback4/crates/snapback4/src/serve.rs) (`Mutex<Engine>`, per-request `lock().unwrap()`)
- [crates/snapback4/src/assets.rs](../snapback4/crates/snapback4/src/assets.rs) (`lock().unwrap()`)
- [crates/snapback4-core/src/partition.rs](../snapback4/crates/snapback4-core/src/partition.rs) (panic sites reachable under the lock)

## Suggestion

Never `unwrap()` a potentially poisoned mutex on the request path: recover
with `into_inner()` (logging the incident) or restructure so request
handling cannot panic while holding the lock (validate before locking,
replace `expect` with refusal errors at the partition sites above). Add a
regression test that poisons the mutex in-process and asserts the next
request still serves.
