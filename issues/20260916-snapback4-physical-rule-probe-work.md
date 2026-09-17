# Snapback 4: Logical rule-probe uniformity hides unbounded physical work

Status: Open
Priority: P2
Observed: 2026-09-16
Baseline: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15` (0.2.26)
Review: complete code review requested by Charlie Cheever; lead validation with independent Grok, Muse and Sol reviews.

## Evidence

Code traced. `lookup_live(..., charge=false)` skips expired rows in repeated batches; maintained existence probes can scan an entire expiring source group. Public cost intentionally remains one probe. Membership interval reconstruction also reads complete histories before sync page bounds.

## Implementation locations

Paths are relative to `snapback4/`: `crates/snapback4-core/src/engine/read.rs:rule_probe_exists` and lookup_live; `partition.rs:intervals`. Expiry without sweep and membership churn grow the physical work while visible logical result/cost stays constant.

## Acceptance

Measure fixed logical probes across expired-row counts and sync across membership history. Bound physical acquisition or maintain live indexes without turning private sibling counts into an observable meter oracle. Preserve LLP 3000.007 §17 uniformity. Design in LLP 3000.002.
