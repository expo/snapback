# Snapback 4: Native fuel limits do not bound memory or bridge allocations

Status: Closed
Priority: P1
Observed: 2026-09-16
Baseline: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15` (0.2.26)
Review: complete code review requested by Charlie Cheever; lead validation with independent Grok, Muse and Sol reviews.

## Evidence

Code traced. `host_call` allocates `len.max(0)` bytes before validating the guest range; `read_packed` allocates an unsigned 32-bit length before checking memory. The guest may also grow memory without a Store limiter, and log messages accumulate outside the meter. Do not reproduce by exhausting host memory.

## Implementation locations

Paths are relative to `snapback4/`: `crates/snapback4-core/src/engine/native.rs`: Module::list, instantiate, host_call, read_packed, run_chunk, run_read, handle(log). All wasm entry paths use fuel but no wasmi resource limiter.

## Acceptance

Validate guest ranges and byte limits before copying, limit memory/table growth and cumulative logs across catalog inspection, reads and jobs, and return stable refusals. Test malicious compact wasm advertising huge lengths and requesting growth without allocating gigabytes. Tie limits to existing ceilings. Related: LLP 3000.002 and 3000.005.

## Resolution — 2026-09-16

Implemented in `f6b514c35` as part of the complete project review.

Every catalog/read/job Store installs limits: one instance, memory and table, reserving a combined 16 MiB. Module bytes, guest ranges, bridge encoding, packed answers and logs are bounded before the identified allocations. Allocation and range failures are sticky. Tiny hostile wasm and log-retention tests pass; broader compiler/process memory accounting remains in LLP 3000.002.

Integrated qualification and independent repair review are recorded in
[the review index](../../llp/reviews/3000-complete-code-review-20260916.md).
