# Make invalid authority/auth combinations unrepresentable in TypeScript

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Authoring API, TypeScript, Code generation, Diagnostics
**Date:** 2026-08-21
**Governing:** LLP 0090 authorization scope; LLP 0178; LLP 0275 P1/P2
**Evidence:** Messtimate published-0.1.24 diary

## Problem

The define API's TypeScript surface permits a query to combine
`authorityIndependent: true` with `auth: 'authenticated'`, although codegen
always rejects that combination. The generate-time refusal is correct: an
authority-independent query must already be public. The authoring type should
make the invalid pair impossible where literal information is available, so a
normal editor catches it before generation.

## Required change

- Model the valid query declaration variants as a discriminated union or
  equivalent generic constraint.
- Keep runtime/codegen validation for JavaScript, widened values, casts, old
  declarations, and package-version skew.
- Preserve useful inference for helper-composed declarations and avoid a type
  design that requires authors to repeat the auth mode.
- Audit adjacent invariant pairs and include only those with the same exact,
  stable implication; do not turn the task into a wholesale type rewrite.

## Acceptance

- A TypeScript fixture rejects the invalid pair at the declaration site and
  accepts public authority-independent and authenticated authority-dependent
  queries.
- JavaScript and casted invalid declarations still receive the stable codegen
  diagnostic.
- Generated manifest/runtime semantics are unchanged.

