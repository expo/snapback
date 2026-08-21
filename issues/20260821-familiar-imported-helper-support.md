# Implement Familiar imported-helper support promised by LLP 0253 S2

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 2
**Confidence:** 5
**Systems:** Familiar authoring, Code generation, Handler runtime, Diagnostics
**Date:** 2026-08-21
**Governing:** LLP 0253 S2; LLP 0237 D1–D6

## Problem

LLP 0253 S2 admits imported Familiar helper modules through LLP 0237's closed,
bounded handler graph. Current Familiar generation still accepts only reachable
same-file function declarations, so the implementation does not yet satisfy
that contract. The Familiar Guide must describe this as an implementation gap,
not permanent profile semantics.

## Required work

- Resolve literal relative Familiar helper imports through the LLP 0237
  fail-closed resolver, graph bounds, snapshot checks, and identity records.
- Preserve Familiar TypeScript transform custody and source attribution.
- Emit point-of-need diagnostics for forbidden specifiers, graph bounds,
  cycles, unsupported initializers, and target-profile gaps.
- Replace the Guide's interim same-file rewrite with the implemented imported
  helper path once packed-package fixtures prove it.

## Acceptance

- A clean Familiar app imports a helper from a top-level or nested helper
  module and generates, executes, and preserves the helper graph in identity.
- The LLP 0237 negative matrix remains fail-closed before artifact replacement.
- Familiar retrieval and vertical fixtures teach the admitted import path, and
  the Guide no longer labels imported helpers as a current implementation gap.
