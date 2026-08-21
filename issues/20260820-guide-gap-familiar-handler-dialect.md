# guide-gap: put the complete Familiar handler dialect on its first-read path

**Status:** Open
**Opened:** 2026-08-20
**Systems:** Guide, Familiar authoring, Handler runtime, Code generation
**Related:** LLP 0237; LLP 0252; LLP 0253; LLP 0259; LLP 0277 P19; LLP 0295;
diaries 0093, 0097, 0099, 0101, 0103

## Problem

The Familiar vocabulary successfully lets agents begin from Convex-shaped
priors, but the first-read page does not consolidate the boundaries that make
it a dialect rather than unrestricted TypeScript. Agents learned by refusal
that dynamic computed access, captured constants, imported helpers, some
result forms, clock-dependent visibility, and sequence surfaces differ.

An older guide fix documents the inline subset elsewhere; the current matrix
shows that it is not routed from the Familiar decision point and therefore
does not prevent repeated correction loops.

## Requested repair

- Add one compact "handler dialect" table to the Familiar page: allowed form,
  refused familiar-looking form, standard rewrite, and when Explicit is the
  better profile.
- Link it from generated refusals and the Familiar template start packet.
- Add retrieval-eval cases for `array[i]`, imported helper, top-level const,
  `Date.now`, mutation document arrays, and sequence allocation.
- Keep the full source/runtime authority in existing LLP/guide pages; this is
  a bounded first-read projection, not a second specification.

## Exit

A cold Familiar agent encounters the supported rewrite before authoring each
of the matrix's replicated dialect violations.
