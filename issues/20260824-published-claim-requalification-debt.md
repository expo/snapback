# Published-claim requalification debt: five battery gates red from one root

**Status:** Open
**Systems:** Verification, Packaging, Benchmarks
**Date:** 2026-08-24
**Related:** LLP 0189 (claim snapshots), LLP 0058/0059, LLP 0283 (F-3),
`issues/20260807-llp-0189-claim-snapshot-implementation.md`

## Root

Five complete-battery gates are red with one shared cause — standing published
claims whose frozen implementation scope has drifted since qualification:

- `local-store-publication` — `crates/snapback-engine/src/local.rs` digest
  drifted from the store publication carrier
  (`sha256:62791ca4…` frozen vs `sha256:862d48b1…` actual).
- `relation-activity-publication`
- `sequence-allocation-publication`
- `local-store-carrier-receipt`
- `fleet-observatory-move1-receipt`

`check-agent-safe-publication` corroborates:
`agent_safe_derived_deployment_fork_v1: PUBLISHED_REQUALIFICATION_DUE` (that
checker treats it as a warning; the conformance gates above fail closed).

The drift is real and expected: the LLP 0276 rearchitecture plus the
high-velocity auth/graph landings changed the claimed surfaces. The claims are
snapshots (LLP 0189); they now need either **requalification** (rerun the
qualifying benches/acceptances and re-stamp the carriers/receipts under the
LLP 0058/0059 protocol) or **withdrawal** of the affected claims.

## Why this is not a lane fix

Re-stamping carriers without rerunning the qualifying evidence would forge the
claims. The requalification runs are bench/acceptance workloads with their own
protocols and machine requirements, and belong with (or after) the programs
still actively changing those surfaces — requalifying mid-churn burns the work.

## Suggested handling

1. Treat the five per-signature battery tickets for these gates as members of
   this family; fix here, not per-gate.
2. Schedule requalification once the F-1/graph landings on the claimed
   surfaces quiet (or batch it with the next publication's qualification).
3. If any claim is no longer worth carrying, withdraw it instead per LLP 0189.
