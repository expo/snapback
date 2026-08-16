# `ConvertJsonToStructured` does not require a Json predecessor and identity-copies every field

**Status:** Closed
**Impact:** 3
**Urgency:** 2
**Ease:** 4
**Confidence:** 4
**Systems:** Schema, Migrations
**Date:** 2026-08-15
**Governing:** LLP 0003 (reject type changes that rewrite stored data),
the ConvertJsonToStructured reviewed-intent path
**Related:** `src/storage.rs:8999-9056` (`reject_field_retypes`)
**Found while:** Whole-codebase security/correctness review (2026-08-15)

## Problem

`ConvertJsonToStructured` planning (`src/migration.rs:1184-1207`) only
checks that the **successor** field is `Structured`. It never checks
that the predecessor field is `Json`. It then builds an identity
`CopyTable` over **every** successor field and writes that map onto the
pinned stage/copy chain.

A hand-authored plan can therefore use this named intent to rewrite
Structured→Structured (or any same-name retype whose successor happens
to be Structured) without `ConvertField`. Row admission still
fail-closes on invalid values, so this is a planner/integrity bypass,
not a silent type smash.

`reject_field_retypes` already tells authors they must declare
`ConvertJsonToStructured` for Json→Structured. The expander should be
as tight as that message.

## Desired outcome

Refuse unless the predecessor field is `Json` and the successor field
is `Structured`. The identity copy should convert only the named field
(or keep the pinned rewriter for that field); do not silently replace
the whole-table field map with unconstrained identity.

## Acceptance

- Json→Structured with the reviewed intent still plans and applies.
- Structured→Structured (or String→Structured) via this intent is
  `plan_invalid`.
- Unrelated successor fields are not rewritten as a side effect of
  naming one Json field.

## Resolution (2026-08-15)

`src/migration.rs` now plans `ConvertJsonToStructured` against both manifests,
requires an exact Json predecessor and Structured successor, and emits only the
named field in the `CopyTable` transform map. `src/storage/migration_executor.rs`
carries omitted same-name successor fields without invoking the transform hook;
the planner call sites were updated to pass the predecessor manifest. LLP 0081
records the tightened reviewed-intent semantics.

Planner tests cover Json→Structured success plus Structured→Structured and
String→Structured `SNAPBACK_MIGRATION_PLAN_INVALID` refusals. The end-to-end
executor test applies the reviewed conversion and proves an unrelated successor
field cannot be rewritten through the named transform. Evidence:

```text
test result: ok. 58 passed; 0 failed; 0 ignored; 0 measured; 2650 filtered out; finished in 1.49s
```
