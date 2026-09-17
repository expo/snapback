# Snapback 4: Native job continuation state is not bound to module identity

Status: Open
Priority: P1
Observed: 2026-09-16
Baseline: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15` (0.2.26)
Review: complete code review requested by Charlie Cheever; lead validation with independent Grok, Muse and Sol reviews.

## Evidence

Code traced and explicitly documented behavior in LLP 3000.005 §4: queued job hashes cover the empty native declaration only. A rebuilt module can interpret the old module's durable `Again` state under new semantics without a generation refusal.

## Implementation locations

Paths are relative to `snapback4/`: `crates/snapback4-core/src/engine/job.rs:enqueue_job`, schedule firing, run_job_chunk; `engine/mod.rs:install_native`. A schema-identical deploy/dev rebuild replaces the module but preserves the compared program digest.

## Acceptance

Choose and implement a safe continuation contract: minimally bind admission to module bytes, park changed/unbound runs without executing another chunk, and allow newly queued work. Cover scheduled jobs and restart. Keep prior committed chunks; never silently restart an old run. This changes the documented initial tradeoff, so update LLP 3000.005 alongside code.
