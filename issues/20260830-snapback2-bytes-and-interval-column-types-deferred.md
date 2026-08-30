# snapback2: `Bytes { max }` and `Interval { of }` column types are deferred behind a value-model decision

**Status:** Open
**Systems:** snapback2, schema, evaluator
**Severity:** P3
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-30
**Related:** LLP 1001 §9, `issues/20260829-bounded-programs-column-type-survey.md`, LLP 0329.015 K5, Diary 0114

The column-type survey ranked four types; `Enum` and `Decimal { scale }` (+ `Money`) landed in LLP 1001 §9 because both fit today's value model (`Value::String` / `Value::Int` of minor units). The other two do not:

- `Bytes { max }` needs a `Value::Bytes` variant, a canonical JSON encoding shared byte-for-byte with the TypeScript twin (the 75-case corpus is the contract), an index-key encoding, and a value-model version bump in every certificate. Diary 0114's 32 KiB base64 ceiling is the shipped incident it fixes.
- `Interval { of }` (four archetypes needed membership-at-a-time, LLP 0329.015 K5) interacts with visibility (interval rules), retention, and the deferred `exclusion` constraint; it is semantics, not a type.

Do `Bytes` first (mechanical, corpus-verified), then `Interval` with its own LLP. `Duration` and `Set { of, max }` ride along with whichever makes them cheap.
