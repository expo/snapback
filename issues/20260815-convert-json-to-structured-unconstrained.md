# `ConvertJsonToStructured` does not require a Json predecessor and identity-copies every field

**Status:** Open
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
