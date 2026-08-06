# Declarative plans reject an omitted `v.optional` argument

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Codegen, Mutation runtime, Type generation
**Date:** 2026-08-05

## Problem

A generated declarative mutation may declare an argument with
`v.optional(v.id(...))`, and its generated TypeScript type correctly permits
the caller to omit that property. If the mutation plan inserts
`arg('optionalName')`, however, an omitted property fails at runtime with:

```text
SNAPBACK_ARG_MISSING: handler arg optionalName was not provided
```

Passing JSON `null` succeeds, but the generated caller type does not admit
`null`. This was reproduced in Relay Room's first `sendText` design for an
optional reply pointer. The demo worked around it by defining separate
`sendText` and `sendReply` declarative mutations.

## Update — 2026-08-05

Generate-time authoring validation now front-runs this failure: the LLP 0178
V1 check in `packages/snapback-codegen/index.mjs` rejects a caller-optional
argument consumed by a strict declarative `arg(...)` node with
`SNAPBACK_AUTHORING_OPTIONAL_ARG_CONTRADICTION`, before generated output is
replaced. Its authoring-validation coverage links the rejected `Arg` shape to
the existing data-tier conformance fixture that pins runtime
`SNAPBACK_ARG_MISSING`.

This ticket remains open because Snapback still has no admitted missing-value
algebra for expressing the omission branch; authors must currently make the
argument required or split the operation.

## Acceptance

- Omission has one coherent meaning across validation, generated caller types,
  and declarative plan evaluation.
- If an optional plan arg maps to nullable storage, an omitted property writes
  the documented empty value without a runtime missing-arg refusal.
- If optional args are not legal at a plan site, codegen refuses that plan and
  suggests a supported shape rather than generating a caller that fails.

## Resolution note — 2026-08-06

The missing-value spelling is `argOpt`, which lowers to null-propagating
`Field` access over the `Args` root. That node was already admitted and pinned
by the shared data-tier corpus. This change adds the missing codegen remediation
pointer, guide documentation, an end-to-end Rust witness from an omitted
optional property through `argOpt`'s serialized shape to a present `null` in an
optional storage field, and an args-contract pin proving explicit `null` is
refused for an optional non-null-typed caller field. It also brings LLP 0178's
V1 example current.

No runtime algebra was added. LLP 0176 §Beyond the golden path still names the
full missing-versus-null distinction — declared defaults, `omitWhenMissing`,
and related matching — as future design work. `argOpt` deliberately conflates
an omitted property with JSON `null`, which is exactly the documented empty
value for optional storage. A possible LLP 0178 V-next check is to statically
refuse an `argOpt` null write into a required, non-optional field; that check is
not implemented here.

## Closed

2026-08-06: All three acceptance items hold — omission has one coherent
meaning (caller type `name?: T`, args contract refuses explicit `null`,
`argOpt` observes omission as `null` at plan evaluation), an omitted property
consumed through `argOpt` writes a present `null` to optional storage without
`SNAPBACK_ARG_MISSING` (pinned by a Rust witness), and the codegen refusal now
suggests the supported shape via the `consumeViaArgOpt` remediation alongside
the two policy repairs. Verified on a clean fleet checkout. The full
missing-vs-null algebra (declared defaults, `omitWhenMissing`) remains future
work named by LLP 0176 §Beyond the golden path.
