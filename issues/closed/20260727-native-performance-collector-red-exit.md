# Native performance collector rejects a valid red holdout

## Problem

`collect-step4-native-performance.mjs` requires every non-quick aggregate to
have `ok=true`. A complete, claim-eligible holdout whose governed threshold
verdict is red is therefore reported as a collector failure after all raw
receipts, inputs, and the valid red aggregate have been written.

The LLP 0063 Step 4 holdout at Snapback revision `ece80bf6` reproduced this:
all 18 raw receipts were green and comparable, the pure aggregator reproduced
the same claim-eligible red result, and only the outer collector's
`assert.equal(aggregate.ok, true)` failed.

## Acceptance

- A complete claim-eligible holdout may finish collection with either `pass`
  or `red`.
- Calibration still requires a green threshold-derivation aggregate.
- Quick probes remain nonclaim and require both framework cells.
- Malformed or internally inconsistent aggregate states still fail.
- Unit tests pin valid-red acceptance and inconsistent-red rejection.

## Resolution

Resolved on 2026-07-27. Collection-result validation now distinguishes
successful evidence collection from the governed performance verdict:
calibration must still derive a green threshold set, while a complete
claim-eligible holdout may finish as either `pass` or `red`. The retained red
holdout is accepted by the new validator, and an inconsistent red state is
rejected. The focused native-performance suite passes 6/6.
