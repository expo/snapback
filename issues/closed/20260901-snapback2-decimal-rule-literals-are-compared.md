# snapback2: decimal rule literals are compared without schema scaling

**Status:** Closed
**Resolution:** Scaled Decimal/Money rule numeric tokens exactly in lower/schema.ts and reject excess precision; added rule regression.
**Systems:** snapback2, compiler
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/compiler/src/lower/schema.ts:332-337, snapback2/packages/compiler/src/lower/schema.ts:400-415, and snapback2/packages/compiler/src/lower/schema.ts:722-736. For a `decimal(2)` or money field, a rule comparing the field with authored literal `2` emits integer 2, while writes encode 2.00 as 200; the rule therefore matches 0.02 and rejects 2.00. Schema-aware write lowering scales decimal values, but rule-expression literal lowering has no expected field scale, and the engine cannot distinguish the intended decimal after IR emission. Propagate decimal/money type context into rule lowering and convert exact literals to the same scaled integer representation, rejecting values that cannot be represented exactly.
