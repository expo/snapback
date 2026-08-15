# Generated explicit descriptors carry `authoringProfile`; the 0.1.21 Expo admission validator rejects the key

**Filed:** 2026-08-15 · **Source:** clique-0121 exploratory sweep (LA Durand,
`~/clique-0121-20260814`), lane `sol-snapback-explicit` (0.1.21) ·
**Systems:** Codegen, Expo client, Admission

## Problem

On the published 0.1.21 closure, generated explicit descriptors include an
`authoringProfile` field, while the Expo admission validator rejects any
descriptor carrying that extra key. Two same-version first-party packages
disagree about the descriptor schema, so the paved path fails until the app
projects the descriptor down to the six accepted keys at the admission seam
— a workaround no consumer should have to discover.

## Evidence

- `lanes/sol-snapback-explicit/diary.md` M1 and `final-report.md`
  ("Descriptor fallback: project the generated explicit descriptor to the
  six keys accepted by the 0.1.21 Expo admission validator").

## Suggested fix

Make the admission validator tolerant of (or explicitly aware of)
`authoringProfile`, and add a cross-package contract test that admits a
freshly generated descriptor from each authoring profile at the same
version. This is the same class of drift the package-closure work exists to
prevent; worth a gate, not just a fix.

## Resolution

Resolved 2026-08-15. Expo descriptor admission now accepts and validates the
closed `authoringProfile` union emitted by codegen, and the public descriptor
type names the same field. `packages/snapback-expo/app-binding.test.mjs` is the
cross-package drift gate: it verifies matching package versions, freshly
generates explicit and Familiar descriptors, and admits both without
projecting away any descriptor keys.
