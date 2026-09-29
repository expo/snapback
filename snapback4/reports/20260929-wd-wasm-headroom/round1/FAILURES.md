# Round 1 failure ledger

## Corrected setup errors — ours

1. `regression-setup-error.log`: the initial regression called nonexistent
   `Value::canonical_bytes`, producing two E0599 diagnostics. Replaced it with
   the existing serde byte serializer. No production failure; exit 101.
2. `regression-literal-fixture-error.log`: the initial fixture cloned an already
   built literal array and charged only 32 B. It did not exercise the requested
   constructed-array heap boundary; its baseline oracle failed (32 vs 185 B).
   Changed the fixture to `Expr::Array([Literal(row)])`, independently charging
   its four-slot allocation plus retained row/key. No production failure; exit 101.

## Required detecting regression — ours, fixed

`regression-round0.log`, exit 101: the final test on merged round-0 production
source failed at its heap assertion: baseline 249 B / complete, actual 4,344 B /
incomplete. Identical serialized bytes passed first. The failure is the P2 being
fixed, not an unrelated baseline/environmental failure. After restoring the old
constructor, `regression-fixed.log` passes both capacity orders, with 249 B /
complete and 4,344 B / heap-capped respectively.

## Non-failure tooling note

The successful exact-wasm differential prints Node's
`MODULE_TYPELESS_PACKAGE_JSON` warning for its ignored SDK copy. ESM detection
succeeds; all 119 comparisons pass. This is not a test failure.

## Full suite

`scripts/test.sh` ran once, exit 0: `== 0 failure(s) in 1503 s`.
Every stage passed. Every failure: none. Ours 0, baseline 0, environmental 0.
The separate affected and whole-guide runs also pass without failures.
The nominal inherited 60-second process budget is exceeded; it was not raised,
and no test count, assertion, timeout or ceiling was weakened.
