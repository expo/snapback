# Partitime Step 0 evidence drift blocks an authoritative Step 4 refresh

Status: Open
Date: 2026-07-25
Systems: Partitime matrix, LLP 0063, Exact mirror

## Problem

The LLP 0063 checkpoint reran the browser matrix and both Step 4 aggregates on
an idle M4 against current Snapback main and the landed Exact checkpoint.
Those runs are retained under
`demos/partiful-matrix/acceptance/checkpoints/2026-07-25/`, but they cannot
truthfully replace the frozen authoritative receipts yet.

`validate-step0.mjs --structural-only` first fails because the authoritative
manifest still declares the pre-amendment comparison-protocol digest
`6e1c4eb6…`, while the committed protocol bytes are `d89b5f5f…`. After
staging that mechanical correction during the checkpoint audit, the validator
also found passing Step 0 receipts whose committed input inventories no longer
match current main:

- `step0-v0-core.json`: `tests/capability_v0.rs` and
  `scripts/check-generated-artifacts`;
- `step0-required-skip-nonpass.json`: the browser harness and Contract
  surface inputs;
- `step0-native-exact.json`: the current native Exact harness;
- `step0-no-exact-core.json`: package manifests and the codegen authoring
  test;
- `step0-attribution.json`: the current web receipt, source/bundle inventory,
  and lock identity;
- the shared-manifest, complete, and cross-repository receipts downstream of
  those inputs.

The checkpoint also found that Snapback's current comparison-protocol bytes
had outpaced Exact's checked-in mirror. Exact main
`2d687583744b3ffa0bcad71b0a695b05e60b92cd` now carries the narrow protocol
mirror bridge, but the final full authority/aggregate mirror must wait for the
Step 0 reruns above.

## Consequence

Updating `step4-production-web.json`, `step4-budgets.json`, or their manifest
hashes in isolation would make the cumulative claim ledger internally
inconsistent. The frozen Step 4 claims therefore remain unchanged and red.

## Resolution

From fresh continuation branches based on the checkpoint mains:

1. rerun the V0, required-skip, no-Exact-core, and native Step 0 receipts;
2. rerun Step 0 attribution on a quiet measurement host without rebaselining
   its frozen thresholds;
3. refresh the shared-manifest receipt, Step 0 aggregate, and Exact full
   mirror in the prescribed self-reference-safe order;
4. rerun the two Step 4 aggregates;
5. content-address and validate the final manifest, promoting no claim unless
   its complete frozen gate is genuinely green.

The full LLP 0063 objective remains active.
