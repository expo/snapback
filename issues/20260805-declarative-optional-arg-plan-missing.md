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
