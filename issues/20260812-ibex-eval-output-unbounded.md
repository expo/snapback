# Ibex `ex_hermes_eval` result is unbounded; unsettled path echoes it

**Opened:** 2026-08-12 · **Severity:** P2 (availability / diagnostics) · **Area:** runtime / Ibex

## What

Eval copies the entire C string into a Rust `String` with no cap (`src/runtime.rs:4275-4283`). `SNAPBACK_HANDLER_DID_NOT_SETTLE` then puts that blob in diagnostic details (`src/runtime.rs:4239-4248`).

Workerd refuses bodies over 8 MiB **before** parse (`src/workerd_exec.rs:91`). `result_contract` caps successful results at 4 MiB **after** JSON parse. The Ibex owner VM also has **no** `withMaxHeapSize` (restricted worker does; `RuntimeGuard::create` does not).

## Why it matters

A handler can force a multi-hundred-MB allocation in the Snapback process (heap bomb in JS, or a huge settled/unsettled string). Details retention can keep that blob. This is distinct from the documented Missing `maximum_heap_size` row: the host copies the engine’s output with no ceiling of its own.

## Fix

Bound `eval` output (match workerd’s 8 MiB or the 4 MiB result contract) before `CStr` → `String`. Never put raw eval text in diagnostics; keep only length/hash. Set a Hermes heap ceiling on the owner VM and emit `maximum_heap_size` honestly.

## Confidence

High on the unbounded copy. `maximum_result_size` / `maximum_heap_size` vocabulary drift is noted in LLP 0216; the unbounded eval copy itself was not ticketed.
