# Unique-where-present index semantics for optional fields (Clique G8, second half)

**Status:** Closed
**Severity:** P2 (schema expressiveness; forced meaningless generated defaults in the pilot)
**Systems:** Schema, Storage, Migrations
**Date:** 2026-08-09
**Related:** LLP 0208 (G8 register row — this is the "still needs its
ticket" half), LLP 0007 (unique profile owner), LLP 0004, LLP 0081
(activation scans), LLP 0211 (adjacent but deliberately not absorbing this)

## Problem

Clique P2 pilot, B1 evidence: unique indexes require every key field
non-optional, so the lane made `clientKey`/`dmKey` required with generated
defaults — meaningless values invented purely to satisfy the index
profile. Idempotency keys and natural keys are canonically
present-on-some-rows fields; the workaround defeats their semantics and
cost B1 points against both competitors.

## Ask

A portable "unique where present" profile in LLP 0007's frame:

- multiple absent values permitted; a row participates only when the
  indexed key is present — for compound keys, the participation rule
  (all-present vs any-present) must be decided explicitly, not defaulted;
- SQLite and Postgres adapters implement via pinned partial-index
  semantics;
- activation scans participating rows before publication (LLP 0081's
  existing posture);
- write conflicts map to the existing portable uniqueness diagnostic.

The codex adjudication of 2026-08-09 (LLP 0211 review) ranked this as
plausibly better immediate ROI than the structured-values slice itself:
it is small, separable, and the pilot demand is unambiguous. It should
not be smuggled into CV-4b — file, design in LLP 0007, land on its own.

## Done when

An optional field carries a declared unique-where-present index with
pinned portable semantics and acceptance coverage on the local target;
LLP 0208 G8's second half is annotated closed.

## Resolution

Resolved 2026-08-09. LLP 0007 now defines the automatic
unique-where-present profile for optional unique keys, including the
all-present compound participation rule and pinned SQLite/Postgres partial-index
mapping. Codegen carries the explicit `whereApplicable` fact; SQLite validates
it, creates the partial unique index, and preserves the existing portable
uniqueness refusal for activation and writes. Storage acceptance coverage
proves absent-row multiplicity, present-row conflicts, compound participation,
brownfield activation refusal, and migration over absent values.
