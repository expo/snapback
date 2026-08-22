# Guide must not present derived `whereApplicable` as an author option

**Status:** Open
**Opened:** 2026-08-22
**Impact:** 3
**Urgency:** 4
**Ease:** 5
**Confidence:** 5
**Systems:** Guide, Schema authoring, Code generation, Unique indexes,
Diagnostics
**Governing:** LLP 0007 index contract; LLP 0061; LLP 0295 vertical
paved-path coherence invariant
**Evidence:** Clique candidate-0.1.25 Explicit Air lane correction loop M1

## Problem

The served Queries Guide says an index is "declared with
`whereApplicable: true`". A cold builder reasonably passed that field in the
`.index(..., options)` authoring object, and candidate 0.1.25 refused it as an
unknown option. The supported authoring contract is instead to declare a
unique index over one or more optional fields; codegen derives the manifest's
`whereApplicable: true` fact automatically.

The current wording exposes an internal manifest fact as if it were public
schema syntax. The runtime and generated manifest behavior are correct; the
Guide spelling causes a needless first-generation correction loop.

## Required change

- Rewrite the Queries Guide to distinguish public authoring syntax from the
  derived manifest fact.
- Include one CI-executed optional-unique-index snippet showing only
  `{ unique: true }`, followed by the derived `whereApplicable` behavior.
- Add a retrieval-eval case for plausible searches such as "whereApplicable
  index option" and "unique index optional field".
- Improve the unknown-index-option diagnostic for `whereApplicable` to say
  that codegen derives it and show the supported declaration, if the
  diagnostic can identify this exact retired/internal spelling cheaply.
- Regenerate the Guide flats through the normal guide build; do not edit
  generated flat files directly.

## Acceptance

- Every public Guide example typechecks and generates against packed
  candidate packages.
- A unique index containing an optional field emits the derived manifest fact
  and enforces all-components-present semantics without an authored
  `whereApplicable` option.
- Authoring `whereApplicable` either reaches a targeted remediation or the
  first-read Guide prevents the mistake in a cold retrieval probe.

