# guide-gap: table field array validator refusal doesn't say to use `v.json()`

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 5
**Confidence:** 4
**Systems:** Guide, Schema authoring, Codegen
**Date:** 2026-08-05
**Related:** LLP 0176; `demos/messaging-snapback`; Diary 0058
(`messaging-snapback`); `guide/getting-started/your-first-backend.md`

## Problem

`v.array(...)` is a valid result-contract validator but is not a legal table
field validator. Declaring a schema field such as
`conversations.memberHandles: v.array(v.string())` fails codegen with:

```text
unsupported validator primitive/field type "array"/"Json"
```

The message correctly names the problem (array is not a storable field
primitive) but not the fix. The supported pattern — store the array as
`v.json()` in the table, and re-validate its shape with `v.array(...)` only in
a result contract — is not connected in
`guide/getting-started/your-first-backend.md`'s validator inventory, which
lists `v.json()` as a field option and `v.array()` as a result option
separately, without stating that the second commonly narrows the first. This
was found while building `demos/messaging-snapback`'s conversation schema and
was worked out only by grepping codegen's assert message source, not the
guide.

## Fix shape

- In the validator inventory (or immediately next to `v.array()`'s
  documentation), state explicitly: "table fields cannot use `v.array()`
  directly; store the array with `v.json()` and narrow it with `v.array()` in
  the result contract of any query/mutation that returns it."
- Consider having the codegen refusal message itself suggest `v.json()` as the
  field-level alternative, since the fix is mechanical and known at the point
  of failure.

## Acceptance

- The guide's validator inventory states the `v.json()` field / `v.array()`
  result-contract pairing for array-shaped data before an author needs to
  grep source to find it.
- The schema-authoring refusal for an array field either links to that
  guidance or names `v.json()` directly.

## Resolution note — guide half (2026-08-05)

`guide/getting-started/your-first-backend.md` now states the immediate pairing:
store array-shaped data as opaque `v.json()` and narrow every exposed function
result with `v.array(...)`. It also states what that workaround does *not*
provide — write-time element validation, indexing, portable structured-field
semantics, or sync-aware array behavior — and links the new honest
`backend.structured-stored-fields` GAP row to LLP 0115 CV-4b.

This ticket remains open for the separate codegen-diagnostic half: the
table-field refusal should itself suggest `v.json()` or link to the guidance.
