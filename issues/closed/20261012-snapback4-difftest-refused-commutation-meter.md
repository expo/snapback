# Snapback 4 difftest: a refused commutation changes executed cost

**Status:** Resolved, 2026-10-12
**Signature:** `rewrite-commute--metered--E_OVERFLOW`
**Found by:** LANG2 post-merge `run`, seeds 0–99,999, six disagreements.

`a = (b + b)` with `a = 0` and `b = 9007199254740990` refuses the same
E_OVERFLOW in both operand orders. The original reads `a` before the
overflow; the commuted form stops first. Six versus five steps correctly
measure different executed work. This was a harness defect.

## Resolution

Commit `62d86c5a02` omits the meter comparison for refused commutations,
counts the omission, and keeps all semantic and post-write comparisons.
Successful commutations retain their existing meter checks. The shrunk
seed-50094 case and diagnosis are retained under
`snapback4/crates/snapback4-difftest/cases/found/rewrite-commute--metered--E_OVERFLOW/`.

Validation: the smoke target passes 9/9, including both refused operand
orders and a successful control. The corrected release `run` campaign
compiles all 100,000 cases and executes 4,710,628 calls with zero
disagreements, generator errors or unexpected refusals (669.70 s).
