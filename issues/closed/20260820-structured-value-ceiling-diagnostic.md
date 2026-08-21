# Structured-value ceiling failure should identify the aggregate and field

**Status:** Closed
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

## Resolution (2026-08-21)

Structured-value refusals now distinguish child, collection, field, and row
bounds in stable diagnostic details. Field failures name the schema field and
report actual versus maximum canonical bytes; row failures report the row
total plus a bounded list of per-field contributions. Child-string and
collection validators likewise carry their measured byte or item counts.
Every stored-value refusal points to the version-bound guide and recommends
supported repairs: shorten the value, split it into scalar columns, or move
the repeated data into bounded child rows.

The storage suite now covers nested record/array canonical-byte boundaries at
limit-1, limit, and limit+1 for both field and row ceilings. The generated
diagnostic registry and guide projections were refreshed.

Evidence:

- `cargo test -p snapback-kernel storage::tests::stored_structured_value_tests:: -- --nocapture` — 10 passed.
- `cargo test -p snapback-types args_contract::tests:: -- --nocapture` — 19 passed, 1 benchmark ignored.
- `node scripts/check-guide.mjs` under the repository's Node 24 toolchain — 19 checks passed.
- `./ref-check --verbose` — 296 documents and 6,107 references checked with 0 errors.
