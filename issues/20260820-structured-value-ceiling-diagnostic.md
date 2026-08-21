# Structured-value ceiling failure should identify the aggregate and field

**Status:** Open
**Opened:** 2026-08-20
**Systems:** Storage, Validators, Diagnostics, Guide, Generated types
**Related:** LLP 0211; LLP 0277 P20; LLP 0295; Diary 0093

## Problem

A media URI array satisfied its child validators and then hit the independent
32 KiB aggregate structured-value ceiling. The diagnostic reported an
"expected string, actual string"-shaped mismatch rather than the offending
field, actual encoded bytes, aggregate limit, or relationship to child
`maxBytes` constraints. The author redesigned the representation into scalar
columns by trial and error.

## Requested repair

- Emit a stable code whose details include field path, actual canonical bytes,
  aggregate limit, and whether the failing bound is child, collection, field,
  row, or live-frame related.
- Project the applicable aggregate ceiling into generated reference/JSDoc or
  the version-bound guide page linked by the refusal.
- Add boundary fixtures at limit-1/limit/limit+1 for nested arrays/records.

## Exit

The first failure tells an author exactly which representation bound was
crossed and which supported redesigns preserve the intended value shape.
